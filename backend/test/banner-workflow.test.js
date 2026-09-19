const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
const { createDatabase } = require('../db/connection');
const { DRAFT_TTL_MS, MAX_DRAFTS } = require('../services/image-assets');

// Valid one-pixel fixture, not a generated campaign banner or live AI result.
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQCVjwHwADhAIEWAExyQAAAABJRU5ErkJggg==', 'base64');
const provider = () => ({ provider: 'test-double', model: 'synthetic-fixture', generate: async () => ({ bytes }) });
const campaign = extra => ({ campaignName: 'Synthetic banner campaign', prompt: 'Synthetic campaign brief',
  startDate: '2026-09-13', endDate: '2026-09-17', channel: 'Website', budget: '10k', ...extra });
const brief = { prompt: 'Synthetic non-personal image brief', consentToSend: true };

async function environment(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-banner-test-'));
  const filename = path.join(folder, 'synthetic.sqlite');
  let db, server, base;
  async function close() {
    if (server) { await new Promise(resolve => server.close(resolve)); server = null; }
    if (db) { db.close(); db = null; }
  }
  async function start() {
    db = createDatabase(filename);
    const { app } = createApp({   
      db,   
      imageProvider: provider(),   
      imageConfig: {},   
      campaignNow: () => new Date('2026-09-13T02:00:00Z'),   
      ...options 
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }
  t.after(async () => {
    await close();
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('divinenet-banner-test-'));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  async function request(route, method = 'GET', body, status = 200) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json();
    assert.equal(response.status, status, method + ' ' + route + ': ' + JSON.stringify(json));
    assert.equal(json.success, status < 400);
    return json.data;
  }
  await start();
  return { request, get db() { return db; }, get base() { return base; },
    restart: async () => { await close(); await start(); } };
}
async function draft(e, approve = true) {
  const generated = await e.request('/api/banner-drafts/generate', 'POST', brief, 201);
  return approve ? e.request('/api/banner-drafts/' + generated.id + '/approve', 'POST', { reviewed: true }) : generated;
}

test('banner draft generates and previews without prematurely creating a campaign', async t => {
  let sent;
  const e = await environment(t, { imageProvider: { ...provider(), generate: async input => { sent = input; return { bytes }; } } });
  const d = await draft(e, false);
  assert.equal(d.status, 'Draft');
  assert.equal(d.provider, 'test-double');
  assert.ok(d.expiresAt);
  assert.deepEqual(await e.request('/api/campaigns'), []);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM campaign_assets').get().n, 0);
  const preview = await fetch(e.base + d.imageUrl);
  assert.equal(preview.status, 200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
  assert.equal(sent.prompt, brief.prompt);
  assert.deepEqual(Object.keys(sent).sort(), ['prompt', 'signal']);
  await e.request('/api/banner-drafts/' + d.id + '/approve', 'POST', { reviewed: false }, 400);
});

test('banner generation unavailable or unconsented makes no attempt and saves no campaign', async t => {
  const e = await environment(t, { imageProvider: undefined });
  await e.request('/api/banner-drafts/generate', 'POST', brief, 503);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ai_generation_attempts').get().n, 0);
  assert.deepEqual(await e.request('/api/campaigns'), []);
  const configured = await environment(t);
  await configured.request('/api/banner-drafts/generate', 'POST', { prompt: brief.prompt }, 400);
  assert.equal(configured.db.prepare('SELECT COUNT(*) AS n FROM ai_generation_attempts').get().n, 0);
});

test('banner prompts reject empty, oversized and sd-server control inputs before generation', async t => {
  let calls = 0;
  const e = await environment(t, { imageProvider: { ...provider(), generate: async () => { calls++; return { bytes }; } } });
  for (const prompt of ['', ' ', null, 123, 'x'.repeat(4001), '<sd_cpp_extra_args>{"n":100}</sd_cpp_extra_args>', 'SD_CPP_EXTRA_ARGS']) {
    await e.request('/api/banner-drafts/generate', 'POST', { prompt, consentToSend: true }, 400);
  }
  assert.equal(calls, 0);
});

test('unapproved or missing banner rolls campaign, directory creation and ID allocation back', async t => {
  const e = await environment(t);
  const d = await draft(e, false);
  const body = campaign({ bannerDraftId: d.id, clientRequestId: randomUUID(), client: 'Rolled-back synthetic client' });
  await e.request('/api/campaigns', 'POST', body, 409);
  await e.request('/api/campaigns', 'POST', campaign({ bannerDraftId: randomUUID() }), 410);
  await e.request('/api/campaigns', 'POST', campaign({ bannerDraftId: {} }), 400);
  assert.deepEqual(await e.request('/api/campaigns'), []);
  assert.deepEqual(await e.request('/api/clients'), []);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM campaign_save_requests').get().n, 0);
  await e.request('/api/banner-drafts/' + d.id + '/approve', 'POST', { reviewed: true });
  const saved = await e.request('/api/campaigns', 'POST', body, 201);
  assert.equal(saved.id, 'CAM-001');
});

test('approved banner and campaign save atomically, retry once and survive database reopen', async t => {
  const e = await environment(t);
  const d = await draft(e);
  const body = campaign({ bannerDraftId: d.id, clientRequestId: randomUUID() });
  const saved = await e.request('/api/campaigns', 'POST', body, 201);
  assert.equal(saved.budget, 10000);
  assert.deepEqual(await e.request('/api/campaigns', 'POST', body), saved);
  const assets = await e.request('/api/campaigns/' + saved.id + '/assets');
  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, d.id);
  assert.equal(assets[0].campaignId, saved.id);
  assert.equal(assets[0].status, 'Approved');
  await e.restart();
  assert.deepEqual(await e.request('/api/campaigns', 'POST', body), saved);
  assert.deepEqual(await e.request('/api/campaigns/' + saved.id + '/assets'), assets);
  assert.equal((await e.request('/api/campaigns')).length, 1);
  const download = await fetch(e.base + assets[0].downloadUrl);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.deepEqual(e.db.pragma('foreign_key_check'), []);
  assert.deepEqual(e.db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
});

test('same request key with changed data conflicts; another campaign cannot steal a saved banner', async t => {
  const e = await environment(t);
  const d = await draft(e);
  const body = campaign({ bannerDraftId: d.id, clientRequestId: randomUUID() });
  const first = await e.request('/api/campaigns', 'POST', body, 201);
  await e.request('/api/campaigns', 'POST', { ...body, campaignName: 'Changed' }, 409);
  await e.request('/api/campaigns', 'POST', { ...body, clientRequestId: randomUUID() }, 409);
  assert.deepEqual(await e.request('/api/campaigns'), [first]);
});

test('failed database insertion rolls back campaign and retains approved draft for retry', async t => {
  const e = await environment(t);
  const d = await draft(e);
  const body = campaign({ bannerDraftId: d.id, clientRequestId: randomUUID() });
  e.db.exec("CREATE TRIGGER synthetic_asset_failure BEFORE INSERT ON campaign_assets BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
  await e.request('/api/campaigns', 'POST', body, 500);
  assert.deepEqual(await e.request('/api/campaigns'), []);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM campaign_save_requests').get().n, 0);
  assert.equal((await fetch(e.base + d.imageUrl)).status, 200);
  e.db.exec('DROP TRIGGER synthetic_asset_failure');
  const saved = await e.request('/api/campaigns', 'POST', body, 201);
  assert.equal(saved.id, 'CAM-001');
  assert.equal((await e.request('/api/campaigns/' + saved.id + '/assets')).length, 1);
});

test('campaign update attaches approved draft atomically and identical update retry does not duplicate assets', async t => {
  const e = await environment(t);
  const saved = await e.request('/api/campaigns', 'POST', campaign(), 201);
  const d = await draft(e, false);
  const update = { campaignName: 'Changed with banner', bannerDraftId: d.id, clientRequestId: randomUUID() };
  await e.request('/api/campaigns/' + saved.id, 'PUT', update, 409);
  assert.deepEqual(await e.request('/api/campaigns/' + saved.id), saved);
  await e.request('/api/banner-drafts/' + d.id + '/approve', 'POST', { reviewed: true });
  const updated = await e.request('/api/campaigns/' + saved.id, 'PUT', update);
  assert.equal(updated.campaignName, update.campaignName);
  assert.deepEqual(await e.request('/api/campaigns/' + saved.id, 'PUT', update), updated);
  assert.equal((await e.request('/api/campaigns/' + saved.id + '/assets')).length, 1);
  await e.request('/api/campaigns/' + saved.id, 'PUT', { ...update, campaignName: 'Different' }, 409);
});

test('expired, cancelled and restarted unsaved drafts cannot be silently attached', async t => {
  let clock = Date.now();
  const e = await environment(t, { now: () => clock });
  const expired = await draft(e);
  clock += DRAFT_TTL_MS + 1;
  await e.request('/api/campaigns', 'POST', campaign({ bannerDraftId: expired.id }), 410);
  const cancelled = await draft(e);
  await e.request('/api/banner-drafts/' + cancelled.id, 'DELETE');
  await e.request('/api/campaigns', 'POST', campaign({ bannerDraftId: cancelled.id }), 410);
  const restarted = await draft(e);
  await e.restart();
  await e.request('/api/campaigns', 'POST', campaign({ bannerDraftId: restarted.id }), 410);
  assert.deepEqual(await e.request('/api/campaigns'), []);
});

test('each revision is a new unapproved draft and discard never removes an already saved asset', async t => {
  const e = await environment(t);
  const first = await draft(e);
  const second = await draft(e, false);
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, 'Draft');
  const saved = await e.request('/api/campaigns', 'POST', campaign({ bannerDraftId: first.id }), 201);
  await e.request('/api/banner-drafts/' + first.id, 'DELETE');
  assert.equal((await e.request('/api/campaigns/' + saved.id + '/assets')).length, 1);
});

test('temporary draft count is bounded and discarding makes room', async t => {
  const e = await environment(t);
  const generated = [];
  for (let i = 0; i < MAX_DRAFTS; i++) generated.push(await draft(e, false));
  await e.request('/api/banner-drafts/generate', 'POST', brief, 429);
  await e.request('/api/banner-drafts/' + generated[0].id, 'DELETE');
  await draft(e, false);
});

test('provider failures and invalid image responses leave no campaign or asset; retries stay possible', async t => {
  let call = 0;
  const e = await environment(t, { imageProvider: { ...provider(), generate: async () => {
    call++;
    if (call === 1) throw new Error('Synthetic provider rejection');
    if (call === 2) return { bytes: Buffer.from('not a PNG') };
    return { bytes };
  } } });
  await e.request('/api/banner-drafts/generate', 'POST', brief, 502);
  await e.request('/api/banner-drafts/generate', 'POST', brief, 502);
  assert.deepEqual(await e.request('/api/campaigns'), []);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM campaign_assets').get().n, 0);
  await draft(e);
});

test('generation concurrency guard is shared across draft and existing-campaign routes', async t => {
  let release, started;
  const begun = new Promise(resolve => { started = resolve; });
  const e = await environment(t, { imageProvider: { ...provider(), generate: () => {
    started(); return new Promise(resolve => { release = () => resolve({ bytes }); });
  } } });
  const c = await e.request('/api/campaigns', 'POST', campaign(), 201);
  const pending = e.request('/api/banner-drafts/generate', 'POST', brief, 201);
  await begun;
  try { await e.request('/api/campaigns/' + c.id + '/assets/generate', 'POST', brief, 429); }
  finally { release(); }
  await pending;
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ai_generation_attempts').get().n, 1);
});

test('daily attempt cap persists across restart and counts failed attempts', async t => {
  const e = await environment(t, { imageProvider: { ...provider(), generate: async () => { throw new Error('Synthetic failure'); } } });
  for (let i = 0; i < 10; i++) await e.request('/api/banner-drafts/generate', 'POST', brief, 502);
  await e.restart();
  await e.request('/api/banner-drafts/generate', 'POST', brief, 429);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ai_generation_attempts').get().n, 10);
});

test('ordinary campaign request IDs preserve retry receipts without blocking deletion or recreating deleted records', async t => {
  const e = await environment(t);
  await e.request('/api/campaigns', 'POST', campaign({ clientRequestId: 'not-a-uuid' }), 400);
  const body = campaign({ clientRequestId: randomUUID() });
  const saved = await e.request('/api/campaigns', 'POST', body, 201);
  await e.request('/api/campaigns/' + saved.id, 'DELETE');
  await e.request('/api/campaigns', 'POST', body, 409);
  assert.deepEqual(await e.request('/api/campaigns'), []);
  assert.equal(e.db.prepare('SELECT campaign_id FROM campaign_save_requests').get().campaign_id, null);
  assert.deepEqual(e.db.pragma('foreign_key_check'), []);
});
