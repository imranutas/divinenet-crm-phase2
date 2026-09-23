'use strict';
// Assistant-prepared regression checks; isolated records, not independent human QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createApp } = require('../app');

async function environment(t, time) {
  let now = new Date(time);
  const { app, db } = createApp({ databasePath: ':memory:', imageConfig: {}, campaignNow: () => now });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  return {
    db,
    clock: value => { now = new Date(value); },
    async request(method, route, body, expected) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/campaigns' + route, {
        method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
      });
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result.data;
    }
  };
}
const record = (date, extra = {}) => ({ campaignName: 'Synthetic date regression', prompt: 'Isolated verification',
  startDate: date, endDate: date, channel: 'Website', ...extra });

test('API rejects forged historical exceptions without creating records or receipts', async t => {
  const env = await environment(t, '2026-09-19T02:00:00Z');
  await env.request('POST', '', record('2026-09-18', { clientRequestId: randomUUID(),
    existingStartDate: '2026-09-18', now: '2026-09-01T00:00:00Z' }), 400);
  assert.equal((await env.request('GET', '', undefined, 200)).length, 0);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM campaign_save_requests').get().n, 0);
  await env.request('POST', '', record('2026-09-19'), 201);
  await env.request('POST', '', record('2026-09-20'), 201);
});

for (const [label, date, before, after] of [
  ['standard time', '2026-09-19', '2026-09-19T13:59:59Z', '2026-09-19T14:00:00Z'],
  ['daylight saving', '2026-12-01', '2026-12-01T12:59:59Z', '2026-12-01T13:00:00Z']
]) {
  test('API receipt replay survives Sydney midnight in ' + label, async t => {
    const env = await environment(t, before);
    const body = record(date, { clientRequestId: randomUUID() });
    const first = await env.request('POST', '', body, 201);
    env.clock(after);
    const replay = await env.request('POST', '', body, 200);
    assert.equal(replay.id, first.id);
    assert.equal((await env.request('GET', '', undefined, 200)).length, 1);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM campaign_save_requests').get().n, 1);
    await env.request('POST', '', { ...body, campaignName: 'Changed payload' }, 409);
    await env.request('POST', '', { ...body, clientRequestId: randomUUID() }, 400);
    await env.request('DELETE', '/' + first.id, undefined, 200);
    await env.request('POST', '', body, 409);
    assert.equal((await env.request('GET', '', undefined, 200)).length, 0);
  });
}

test('API updates preserve original historical dates but reject a different past date', async t => {
  const env = await environment(t, '2026-09-19T13:59:59Z');
  const saved = await env.request('POST', '', record('2026-09-19', { endDate: '2026-09-30' }), 201);
  const update = { campaignName: 'Updated before midnight', clientRequestId: randomUUID() };
  await env.request('PUT', '/' + saved.id, update, 200);
  env.clock('2026-09-19T14:00:00Z');
  assert.equal((await env.request('PUT', '/' + saved.id, update, 200)).id, saved.id);
  const preserved = await env.request('PUT', '/' + saved.id, { campaignName: 'Historical edit' }, 200);
  assert.equal(preserved.startDate, '2026-09-19');
  await env.request('PUT', '/' + saved.id, { startDate: '2026-09-18', existingStartDate: '2026-09-18' }, 400);
  assert.equal((await env.request('GET', '/' + saved.id, undefined, 200)).startDate, '2026-09-19');
  await env.request('PUT', '/' + saved.id, { startDate: '2026-09-21' }, 200);
});
