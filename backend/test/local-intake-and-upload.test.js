const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../app');
const { createDatabase } = require('../db/connection');
const { DRAFT_TTL_MS, MAX_DRAFTS, MAX_UPLOAD_BYTES } = require('../services/image-assets');

// Synthetic one-pixel PNG fixture: never represented as a live generated banner.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQCVjwHwADhAIEWAExyQAAAABJRU5ErkJggg==', 'base64');
const campaign = extra => ({ campaignName: 'Synthetic response campaign', prompt: 'Private internal creative brief',
  client: 'Private client name', startDate: '2026-09-18', endDate: '2026-09-25', channel: 'Website', status: 'Active', ...extra });
const responseBody = extra => ({ name: 'Synthetic Respondent', email: 'synthetic@example.test', phone: '0000000000',
  consent: true, clientRequestId: randomUUID(), ...extra });

async function environment(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-intake-test-'));
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
  imageConfig: {},
  campaignNow: () => new Date('2026-09-18T02:00:00Z'),
  ...options
});
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }
  t.after(async () => {
    await close();
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('divinenet-intake-test-'));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  async function request(route, method = 'GET', body, status = 200) {
    const result = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await result.json();
    assert.equal(result.status, status, method + ' ' + route + ': ' + JSON.stringify(json));
    assert.equal(json.success, status < 400);
    return json.data;
  }
  await start();
  return { request, get base() { return base; }, get db() { return db; }, restart: async () => { await close(); await start(); } };
}
async function linkFor(e, changes) {
  const c = await e.request('/api/campaigns', 'POST', campaign(changes), 201);
  const link = await e.request('/api/campaigns/' + c.id + '/intake-link', 'POST', {});
  assert.match(link.url, /^\/capture\/[0-9a-f]{64}$/);
  return { c, link, route: '/api' + link.url };
}

test('uploaded PNG needs human approval then saves atomically and survives reopen without AI configuration', async t => {
  const e = await environment(t);
  const draft = await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: png.toString('base64'), prompt: 'Existing brand artwork' }, 201);
  assert.equal(draft.provider, 'uploaded'); assert.equal(draft.model, 'user-file'); assert.equal(draft.status, 'Draft');
  const payload = campaign({ bannerDraftId: draft.id, clientRequestId: randomUUID() });
  await e.request('/api/campaigns', 'POST', payload, 409);
  assert.deepEqual(await e.request('/api/campaigns'), []);
  await e.request('/api/banner-drafts/' + draft.id + '/approve', 'POST', { reviewed: true });
  const saved = await e.request('/api/campaigns', 'POST', payload, 201);
  await e.restart();
  const asset = (await e.request('/api/campaigns/' + saved.id + '/assets'))[0];
  assert.equal(asset.provider, 'uploaded'); assert.equal(asset.status, 'Approved');
  const download = await fetch(e.base + asset.downloadUrl);
  assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ai_generation_attempts').get().n, 0);
  assert.deepEqual(await e.request('/api/campaigns', 'POST', payload), saved);
});

test('upload rejects malformed encoding, corrupted PNG and invalid description without storing assets', async t => {
  const e = await environment(t);
  const corrupt = Buffer.from(png); corrupt[40] ^= 1;
  for (const imageBase64 of ['', 'data:image/png;base64,' + png.toString('base64'), png.toString('base64') + '\n', '====', 'abcd', corrupt.toString('base64')]) {
    await e.request('/api/banner-drafts/upload', 'POST', { imageBase64 }, 400);
  }
  await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: png.toString('base64'), prompt: [] }, 400);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM campaign_assets').get().n, 0);
});

test('upload enforces five MB payload and ordinary API body limits independently', async t => {
  const e = await environment(t);
  await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString('base64') }, 413);
  await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: 'A'.repeat(8 * 1024 * 1024) }, 413);
  await e.request('/api/campaigns', 'POST', campaign({ prompt: 'x'.repeat(110000) }), 413);
  // Larger than the normal 100 KB parser is accepted by upload parser but fails actual PNG format, not envelope size.
  await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: Buffer.alloc(150000).toString('base64') }, 400);
});

test('uploaded drafts share bounded capacity and expiration with generated drafts', async t => {
  let clock = Date.now(); const e = await environment(t, { now: () => clock });
  const first = await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: png.toString('base64') }, 201);
  for (let i = 1; i < MAX_DRAFTS; i++) await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: png.toString('base64') }, 201);
  await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: png.toString('base64') }, 429);
  clock += DRAFT_TTL_MS + 1;
  await e.request('/api/banner-drafts/' + first.id + '/approve', 'POST', { reviewed: true }, 410);
  await e.request('/api/banner-drafts/upload', 'POST', { imageBase64: png.toString('base64') }, 201);
});

test('intake link is stable and reveals only campaign name and status across restart', async t => {
  const e = await environment(t); const { c, link, route } = await linkFor(e);
  assert.deepEqual(await e.request(route), { campaignName: c.campaignName, status: 'Active' });
  assert.deepEqual(await e.request('/api/campaigns/' + c.id + '/intake-link', 'POST', {}), link);
  await e.restart();
  assert.deepEqual(await e.request('/api/campaigns/' + c.id + '/intake-link', 'POST', {}), link);
  await e.request('/api/capture/' + '0'.repeat(64), 'GET', undefined, 404);
  await e.request('/api/campaigns/missing/intake-link', 'POST', {}, 404);
});

test('response creates linked Website/New lead with consent and a durable duplicate-safe receipt', async t => {
  const e = await environment(t); const { c, route } = await linkFor(e); const payload = responseBody();
  const receipt = await e.request(route, 'POST', payload, 201);
  assert.deepEqual(Object.keys(receipt).sort(), ['receiptId', 'received']);
  assert.equal(receipt.received, true);
  assert.deepEqual(await e.request(route, 'POST', payload), receipt);
  const lead = (await e.request('/api/leads'))[0];
  assert.equal(lead.campaignId, c.id); assert.equal(lead.stage, 'New');
  assert.equal(lead.sourcePlatform, 'Website'); assert.equal(lead.consentStatus, 'Recorded'); assert.equal(lead.score, null);
  await e.restart();
  assert.deepEqual(await e.request(route, 'POST', payload), receipt);
  assert.equal((await e.request('/api/leads')).length, 1);
  assert.deepEqual(e.db.pragma('foreign_key_check'), []);
});

test('intake refuses changed retry payload and never recreates a deliberately deleted lead', async t => {
  const e = await environment(t); const { route } = await linkFor(e); const payload = responseBody();
  await e.request(route, 'POST', payload, 201);
  await e.request(route, 'POST', { ...payload, name: 'Different person' }, 409);
  const lead = (await e.request('/api/leads'))[0];
  await e.request('/api/leads/' + lead.id, 'DELETE');
  await e.restart();
  await e.request(route, 'POST', payload, 410);
  assert.deepEqual(await e.request('/api/leads'), []);
});

test('capture validates consent, input lengths, types, request ID and rejects server-owned fields', async t => {
  const e = await environment(t); const { route } = await linkFor(e);
  for (const extra of [{ consent: false }, { consent: 'true' }, { name: '' }, { name: 'x'.repeat(201) }, { phone: [] },
    { phone: '1'.repeat(51) }, { email: 'not-an-email' }, { clientRequestId: '123' }, { sourcePlatform: 'Facebook' }, { stage: 'Qualified' }]) {
    await e.request(route, 'POST', responseBody(extra), 400);
  }
  assert.deepEqual(await e.request('/api/leads'), []);
});

test('inactive campaigns reject new responses but preserve a previous valid retry', async t => {
  const e = await environment(t); const { c, route } = await linkFor(e); const payload = responseBody();
  const receipt = await e.request(route, 'POST', payload, 201);
  for (const status of ['Draft', 'Paused', 'Completed']) {
    await e.request('/api/campaigns/' + c.id, 'PUT', { status });
    await e.request(route, 'POST', responseBody(), 409);
    assert.deepEqual(await e.request(route, 'POST', payload), receipt);
  }
});

test('intake and receipt insertion roll back together on database failure', async t => {
  const e = await environment(t); const { route } = await linkFor(e); const payload = responseBody();
  e.db.exec("CREATE TRIGGER fail_intake_receipt BEFORE INSERT ON campaign_intake_receipts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
  await e.request(route, 'POST', payload, 500);
  assert.deepEqual(await e.request('/api/leads'), []);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM campaign_intake_receipts').get().n, 0);
  e.db.exec('DROP TRIGGER fail_intake_receipt');
  await e.request(route, 'POST', payload, 201);
  assert.equal((await e.request('/api/leads'))[0].id, 'LEAD-001');
});

test('intake minute limit survives restart and resets in the next window', async t => {
  let clock = Date.now(); const e = await environment(t, { now: () => clock }); const { route } = await linkFor(e);
  for (let i = 0; i < 30; i++) await e.request(route, 'POST', responseBody({ consent: false }), 400);
  await e.restart();
  await e.request(route, 'POST', responseBody(), 429);
  clock += 61000;
  await e.request(route, 'POST', responseBody(), 201);
});

test('deleted campaign invalidates its link and concurrent same-ID submissions create one lead', async t => {
  const e = await environment(t); const { c, route } = await linkFor(e); const payload = responseBody();
  const results = await Promise.all(Array.from({ length: 5 }, () => fetch(e.base + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 200, 200, 201]);
  const receipts = await Promise.all(results.map(r => r.json()));
  assert.equal(new Set(receipts.map(r => r.data.receiptId)).size, 1);
  const lead = (await e.request('/api/leads'))[0];
  await e.request('/api/leads/' + lead.id, 'DELETE');
  await e.request('/api/campaigns/' + c.id, 'DELETE');
  await e.request(route, 'GET', undefined, 404);
  await e.request(route, 'POST', responseBody(), 404);
  assert.deepEqual(e.db.pragma('foreign_key_check'), []);
});
