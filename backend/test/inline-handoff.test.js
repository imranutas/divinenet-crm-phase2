const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
const { createDatabase } = require('../db/connection');
const { runMigrations } = require('../db/migrate');

const campaign = (extra = {}) => ({ campaignName: 'Synthetic handoff campaign', prompt: 'Synthetic brief',
  startDate: '2026-09-10', endDate: '2026-09-20', channel: 'Website', budget: '10k', ...extra });
const lead = campaignId => ({ campaignId, name: 'Synthetic lead', email: 'handoff@example.com',
  sourcePlatform: 'Website', consentStatus: 'Recorded' });

async function environment(t, seed, imageProvider) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-inline-test-'));
  const filename = path.join(folder, 'synthetic.sqlite');
  let db, server, base;
  async function close() {
    if (server) { await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); server = null; }
    if (db) { db.close(); db = null; }
  }
  t.after(async () => {
    await close();
    const exact = path.resolve(folder);
    assert.equal(path.dirname(exact), path.resolve(os.tmpdir()));
    assert.ok(path.basename(exact).startsWith('divinenet-inline-test-'));
    fs.rmSync(exact, { recursive: true, force: true });
  });
  async function start() {
    db = createDatabase(filename);
    if (seed) { seed(db); seed = null; }
    const { app } = createApp({ db, imageProvider, imageConfig: {} });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }
  async function json(route, method = 'GET', body, expected = 200) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, method + ' ' + route + ': ' + JSON.stringify(result));
    assert.equal(result.success, expected < 400);
    return result.data;
  }
  await start();
  return { json, get db() { return db; }, get base() { return base; }, restart: async () => { await close(); await start(); } };
}

test('handoff: normalized references and linked records survive database reopen', async t => {
  const e = await environment(t);
  const client = await e.json('/api/clients', 'POST', { name: 'Synthetic shared client' }, 201);
  const brand = await e.json('/api/brands', 'POST', { name: 'Synthetic shared brand' }, 201);
  const first = await e.json('/api/campaigns', 'POST', campaign({ clientId: client.id, brandId: brand.id }), 201);
  const second = await e.json('/api/campaigns', 'POST', campaign({ clientId: client.id, brandId: brand.id }), 201);
  const savedLead = await e.json('/api/leads', 'POST', lead(first.id), 201);
  await e.restart();
  assert.deepEqual(await e.json('/api/campaigns/' + first.id), first);
  assert.deepEqual(await e.json('/api/leads/' + savedLead.id), savedLead);
  assert.equal((await e.json('/api/campaigns/' + second.id)).clientId, client.id);
  assert.deepEqual(await e.json('/api/clients'), [client]);
  assert.deepEqual(await e.json('/api/brands'), [brand]);
  const columns = e.db.prepare('PRAGMA table_info(campaigns)').all().map(row => row.name);
  assert.ok(columns.includes('client_id') && columns.includes('brand_id'));
  assert.ok(!columns.includes('client') && !columns.includes('brand'));
  assert.deepEqual(e.db.pragma('foreign_key_check'), []);
});

test('handoff: legacy normalization preserves IDs, timestamps, links and history', async t => {
  let originalLeads, originalHistory;
  const e = await environment(t, db => {
    db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/001_initial_schema.sql'), 'utf8'));
    const timestamp = '2026-09-08T00:00:00Z';
    for (const id of ['CAM-017', 'CAM-023']) db.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, id, 'Synthetic legacy brief', 'Shared client', 'Shared brand', '', '', '2026-09-10', '2026-09-20', 10000, 'Website', 'Draft', timestamp, timestamp);
    db.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('LEAD-047', 'CAM-017', 'Synthetic legacy lead', 'legacy@example.com', '', 'Website', 'Recorded', 'Contacted', null, null, timestamp, timestamp);
    db.prepare('INSERT INTO lead_stage_history VALUES (?,?,?,?,?)').run('history-1', 'LEAD-047', 'New', 'Contacted', timestamp);
    originalLeads = db.prepare('SELECT * FROM leads').all();
    originalHistory = db.prepare('SELECT * FROM lead_stage_history').all();
    runMigrations(db);
  });
  await e.restart();
  assert.deepEqual(e.db.prepare('SELECT * FROM leads').all(), originalLeads);
  assert.deepEqual(e.db.prepare('SELECT * FROM lead_stage_history').all(), originalHistory);
  const rows = await e.json('/api/campaigns');
  assert.deepEqual(rows.map(row => row.id).sort(), ['CAM-017', 'CAM-023']);
  assert.equal(rows[0].clientId, rows[1].clientId);
  assert.equal(rows[0].brandId, rows[1].brandId);
  assert.ok(rows.every(row => row.createdAt === '2026-09-08T00:00:00Z'));
  assert.deepEqual(e.db.pragma('foreign_key_check'), []);
});

test('handoff: invalid links/transitions return 400 and protected deletions return 409', async t => {
  const e = await environment(t);
  const c = await e.json('/api/campaigns', 'POST', campaign(), 201);
  await e.json('/api/leads', 'POST', lead('CAM-MISSING'), 400);
  const l = await e.json('/api/leads', 'POST', lead(c.id), 201);
  await e.json('/api/leads/' + l.id + '/stage', 'PATCH', { stage: 'Qualified' }, 400);
  assert.deepEqual(await e.json('/api/leads/' + l.id + '/history'), []);
  await e.json('/api/leads/' + l.id + '/stage', 'PATCH', { stage: 'Contacted' });
  await e.json('/api/leads/' + l.id + '/stage', 'PATCH', { stage: 'Converted' }, 400);
  const history = await e.json('/api/leads/' + l.id + '/history');
  assert.equal(history.length, 1);
  assert.equal(history[0].from_stage, 'New');
  assert.equal(history[0].to_stage, 'Contacted');
  await e.json('/api/leads/' + l.id, 'DELETE', undefined, 409);
  await e.json('/api/campaigns/' + c.id, 'DELETE', undefined, 409);
  await e.restart();
  assert.deepEqual(await e.json('/api/leads/' + l.id + '/history'), history);
  assert.equal((await e.json('/api/leads/' + l.id)).stage, 'Contacted');
});

test('handoff: invalid calendar dates never save; leap day and 10k are valid', async t => {
  const e = await environment(t);
  for (const startDate of ['2026-02-29', '2026-04-31', '2026-13-01']) {
    await e.json('/api/campaigns', 'POST', campaign({ startDate }), 400);
  }
  assert.deepEqual(await e.json('/api/campaigns'), []);
  const c = await e.json('/api/campaigns', 'POST', campaign({ startDate: '2028-02-29', endDate: '2028-03-01' }), 201);
  assert.equal(c.budget, 10000);
  await e.json('/api/campaigns/' + c.id, 'PUT', { endDate: '2028-02-28' }, 400);
  assert.deepEqual(await e.json('/api/campaigns/' + c.id), c);
});

test('handoff: deleting the last records stays empty after restart without reusing IDs', async t => {
  const e = await environment(t);
  const c = await e.json('/api/campaigns', 'POST', campaign(), 201);
  const l = await e.json('/api/leads', 'POST', lead(c.id), 201);
  await e.json('/api/leads/' + l.id, 'DELETE');
  await e.json('/api/campaigns/' + c.id, 'DELETE');
  await e.restart();
  assert.deepEqual(await e.json('/api/campaigns'), []);
  assert.deepEqual(await e.json('/api/leads'), []);
  const next = await e.json('/api/campaigns', 'POST', campaign(), 201);
  const nextLead = await e.json('/api/leads', 'POST', lead(next.id), 201);
  assert.equal(next.id, 'CAM-002');
  assert.equal(nextLead.id, 'LEAD-002');
});

test('handoff: missing AI configuration returns 503 without outbound calls or saved assets', async t => {
  const e = await environment(t);
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (new URL(url).origin !== e.base) { outboundCalls++; throw new Error('External calls blocked by handoff test'); }
    return originalFetch(url, options);
  });
  const c = await e.json('/api/campaigns', 'POST', campaign(), 201);
  const status = await e.json('/api/ai/status');
  assert.equal(status.configured, false);
  assert.equal(status.mode, 'unavailable');
  await e.json('/api/campaigns/' + c.id + '/assets/generate', 'POST', { prompt: 'Synthetic image', consentToSend: true }, 503);
  assert.deepEqual(await e.json('/api/campaigns/' + c.id + '/assets'), []);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM ai_generation_attempts').get().n, 0);
  assert.equal(outboundCalls, 0);
});

test('handoff: synthetic image requires review for export; regeneration creates a fresh draft', async t => {
  // The same valid one-pixel RGBA PNG constructed in image-assets.test.js; no provider/network dependency.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQCVjwHwADhAIEWAExyQAAAABJRU5ErkJggg==', 'base64');
  const e = await environment(t, undefined, { provider: 'test-double', model: 'synthetic-fixture', generate: async () => ({ bytes }) });
  const c = await e.json('/api/campaigns', 'POST', campaign(), 201);
  const generate = () => e.json('/api/campaigns/' + c.id + '/assets/generate', 'POST', { prompt: 'Synthetic image', consentToSend: true }, 201);
  assert.equal((await e.json('/api/ai/status')).mode, 'test-double');
  const asset = await generate();
  assert.equal(asset.status, 'Draft');
  assert.equal(asset.provider, 'test-double');
  await e.json(asset.downloadUrl, 'GET', undefined, 409);
  await e.json('/api/assets/' + asset.id + '/approve', 'POST', {}, 400);
  const approved = await e.json('/api/assets/' + asset.id + '/approve', 'POST', { reviewed: true });
  assert.equal(approved.status, 'Approved');
  assert.ok(approved.approvedAt);
  const download = await fetch(e.base + asset.downloadUrl);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const regenerated = await generate();
  assert.notEqual(regenerated.id, asset.id);
  assert.equal(regenerated.status, 'Draft');
  await e.json(regenerated.downloadUrl, 'GET', undefined, 409);
});
