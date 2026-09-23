const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalImageProvider, localImageEndpoint, decodeImageResponse, MAX_RESPONSE_BYTES } = require('../services/local-image-provider');
const { readImageConfig } = require('../services/image-assets');
const { createApp } = require('../app');
const { createDatabase } = require('../db/connection');
const { createImageRuntimeGuard } = require('../services/image-runtime-guard');
const { requireClosedPort } = require('../reset-image-runtime');
const net = require('node:net');
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQCVjwHwADhAIEWAExyQAAAABJRU5ErkJggg==', 'base64');

test('local image configuration does not read or require a hosted provider API key', () => {
  const c = readImageConfig({ AI_IMAGE_PROVIDER: 'sd-cpp', AI_IMAGE_MODEL: 'reviewed-test-model@revision',
    AI_LIVE_APPROVED: 'true', OPENAI_API_KEY: 'must-not-be-read' });
  assert.equal(c.baseUrl, 'http://127.0.0.1:1234');
  assert.equal(c.approved, true);
  assert.ok(!Object.hasOwn(c, 'apiKey'));
  assert.equal(readImageConfig({}).approved, false);
});

test('local provider accepts only loopback IP HTTP origins and a fixed generation path', () => {
  assert.equal(localImageEndpoint(), 'http://127.0.0.1:1234/v1/images/generations');
  assert.equal(localImageEndpoint('http://[::1]:1234'), 'http://[::1]:1234/v1/images/generations');
  for (const url of ['https://127.0.0.1:1234', 'http://example.com', 'http://localhost:1234', 'http://192.168.1.2:1234',
    'http://127.0.0.1:1234/proxy', 'http://user:password@127.0.0.1:1234', 'http://127.0.0.1:1234?x=1', 'file:///tmp/model']) {
    assert.throws(() => localImageEndpoint(url));
  }
  assert.throws(() => createLocalImageProvider({ model: '' }));
});

test('sd-cpp adapter sends only the reviewed prompt and fixed bounded image controls', async () => {
  let observed;
  const provider = createLocalImageProvider({ baseUrl: 'http://127.0.0.1:1234', model: 'reviewed-model@sha256' }, async (url, init) => {
    observed = { url, init };
    return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  const result = await provider.generate({ prompt: '  Synthetic landscape banner  ', customerEmail: 'not-sent@example.com' });
  assert.equal(observed.url, 'http://127.0.0.1:1234/v1/images/generations');
  assert.deepEqual(JSON.parse(observed.init.body), { prompt: 'Synthetic landscape banner', n: 1, size: '768x512', output_format: 'png' });
  assert.equal(observed.init.redirect, 'error');
  assert.deepEqual(observed.init.headers, { 'Content-Type': 'application/json' });
  assert.ok(observed.init.signal instanceof AbortSignal);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.provider, 'sd-cpp');
  assert.equal(result.model, 'reviewed-model@sha256');
});

test('sd-cpp adapter rejects control tags without making a runtime request', async () => {
  let calls = 0;
  const provider = createLocalImageProvider({ model: 'test' }, async () => { calls++; throw new Error('must not run'); });
  await assert.rejects(() => provider.generate({ prompt: '<sd_cpp_extra_args>{}</sd_cpp_extra_args>' }), /control tags/);
  assert.equal(calls, 0);
});

test('provider response validates size, one encoded PNG and bytes rather than trusting remote URLs', async () => {
  for (const json of [{ data: [{ url: 'http://evil.invalid/image.png' }] }, { data: [] },
    { data: [{ b64_json: '!!!!' }] }, { data: [{ b64_json: Buffer.from('not PNG').toString('base64') }] },
    { data: [{ b64_json: bytes.toString('base64') }, { b64_json: bytes.toString('base64') }] }]) {
    await assert.rejects(() => decodeImageResponse(new Response(JSON.stringify(json))));
  }
  await assert.rejects(() => decodeImageResponse(new Response('{}', { status: 500 })));
  await assert.rejects(() => decodeImageResponse(new Response('{}', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } })), /too large/);
  const oversized = { ok: true, headers: new Headers(), body: (async function* () { yield Buffer.alloc(MAX_RESPONSE_BYTES + 1); })() };
  await assert.rejects(() => decodeImageResponse(oversized), /too large/);
});

test('invalid or paid-provider configuration stays unavailable instead of silently selecting a hosted API', async t => {
  for (const config of [{ provider: 'openai', approved: true, apiKey: 'not-used', model: 'image-model' },
    { provider: 'sd-cpp', approved: false, model: 'test' },
    { provider: 'sd-cpp', approved: true, model: 'test', baseUrl: 'http://example.com' }]) {
    const db = createDatabase(':memory:');
    const { app } = createApp({ db, imageConfig: config });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/ai/status');
      const status = (await response.json()).data;
      assert.equal(status.configured, false);
      assert.equal(status.mode, 'unavailable');
    } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
  }
});

test('runtime guard is shared across app instances and refuses a retry after an uncertain operation', () => {
  const db = createDatabase(':memory:');
  try {
    const first = createImageRuntimeGuard(db);
    first.begin();
    const second = createImageRuntimeGuard(db);
    assert.equal(second.state(), 'Generating');
    assert.throws(() => second.begin(), /runtime may still be working/);
    first.uncertain();
    assert.equal(second.state(), 'NeedsReset');
    assert.throws(() => second.begin(), /runtime may still be working/);
    first.complete();
    second.begin();
    second.complete();
    assert.equal(first.state(), 'Ready');
  } finally { db.close(); }
});

test('controlled runtime timeout blocks further HTTP generation even after CRM app restart', async t => {
  const originalFetch = globalThis.fetch;
  let runtimeCalls = 0;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url) === 'http://127.0.0.1:1234/v1/images/generations') {
      runtimeCalls++;
      return Promise.reject(Object.assign(new Error('Synthetic timeout: no real model used'), { name: 'TimeoutError' }));
    }
    return originalFetch(url, options);
  });
  const db = createDatabase(':memory:');
  let server;
  const start = async () => {
    const { app } = createApp({ db, imageConfig: { provider: 'sd-cpp', model: 'controlled-timeout-fixture', approved: true } });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    return 'http://127.0.0.1:' + server.address().port;
  };
  const close = async () => { if (server) { await new Promise(resolve => server.close(resolve)); server = null; } };
  t.after(async () => { await close(); db.close(); });
  let base = await start();
  const generate = () => fetch(base + '/api/banner-drafts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Synthetic timeout check', consentToSend: true }) });
  assert.equal((await generate()).status, 504);
  assert.equal((await generate()).status, 503);
  assert.equal((await (await fetch(base + '/api/ai/status')).json()).data.generationBlocked, true);
  await close();
  base = await start();
  assert.equal((await generate()).status, 503);
  assert.equal(runtimeCalls, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM campaign_assets').get().n, 0);
});

test('operator reset port check refuses a running service and accepts only a refused connection', async () => {
  const server = net.createServer(socket => socket.end());
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try { await assert.rejects(() => requireClosedPort('127.0.0.1', port), /still running/); }
  finally { await new Promise(resolve => server.close(resolve)); }
  await requireClosedPort('127.0.0.1', port);
});
