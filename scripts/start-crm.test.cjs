'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { configFor, aiDirectory, parseListeners, recordedIdentityMatches, capabilitiesMatch, runtimeArgs, assertPortFree } = require('./start-crm.cjs');

test('listener parsing finds exact port and preserves owner/public binding', () => {
  const sample = '  TCP  127.0.0.1:1234  0.0.0.0:0 LISTENING 28796\r\n  TCP  0.0.0.0:1234  0.0.0.0:0 LISTENING 44\r\n  TCP  127.0.0.1:31234  0.0.0.0:0 LISTENING 99\r\n  TCP  127.0.0.1:1234  127.0.0.1:10001 ESTABLISHED 28796';
  assert.deepEqual(parseListeners(sample, 1234), [{ address: '127.0.0.1', pid: 28796 }, { address: '0.0.0.0', pid: 44 }]);
});
test('runtime identity rejects PID reuse, wrong path and old start time', () => {
  const exe = path.resolve('runtime', 'sd-server.exe');
  const actual = { processId: 123, executable: exe, started: '2026-09-17T01:02:03Z' };
  assert.equal(recordedIdentityMatches({ ...actual }, actual, exe), true);
  assert.equal(recordedIdentityMatches({ ...actual, processId: 456 }, actual, exe), false);
  assert.equal(recordedIdentityMatches({ ...actual, executable: path.resolve('another.exe') }, actual, exe), false);
  assert.equal(recordedIdentityMatches({ ...actual, started: '2026-09-15T01:02:03Z' }, actual, exe), false);
  assert.equal(recordedIdentityMatches({ ...actual, started: 'invalid' }, actual, exe), false);
});
test('capabilities require exact model and reviewed default settings', () => {
  const value = { current_mode: 'img_gen', model: { name: 'z_image_turbo-Q3_K.gguf' }, defaults: { width: 768, height: 512, seed: 42, batch_count: 1, output_format: 'png', sample_params: { sample_steps: 8, sample_method: 'euler', guidance: { txt_cfg: 1 } } } };
  assert.equal(capabilitiesMatch(value), true);
  for (const [key, replacement] of [['seed', -1], ['width', 1024], ['batch_count', 2], ['output_format', 'jpeg']]) {
    assert.equal(capabilitiesMatch({ ...value, defaults: { ...value.defaults, [key]: replacement } }), false);
  }
  assert.equal(capabilitiesMatch({ ...value, model: { name: 'other-model' } }), false);
  assert.equal(capabilitiesMatch(null), false);
});
test('runtime launch arguments stay loopback-only with reviewed deterministic seed', () => {
  const args = runtimeArgs();
  assert.equal(args[args.indexOf('--listen-ip') + 1], '127.0.0.1');
  assert.equal(args[args.indexOf('--listen-port') + 1], '1234');
  assert.equal(args[args.indexOf('--seed') + 1], '42');
  assert.equal(args[args.indexOf('--backend') + 1], 'Vulkan1');
});
test('optional config validates unknown settings and absent AI remains absent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-launcher-check-'));
  t.after(() => {
    const resolved = path.resolve(root);
    const allowedParent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(), allowedParent.toLowerCase());
    assert.ok(path.basename(resolved).startsWith('divinenet-launcher-check-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  assert.deepEqual(configFor(root), { enableAI: true, openBrowser: true });
  assert.equal(aiDirectory({}, root), undefined);
  const configPath = path.join(root, 'launcher.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ enableAI: false, aiDirectory: 'optional-ai', openBrowser: false }));
  assert.equal(configFor(root).enableAI, false);
  assert.equal(aiDirectory(configFor(root), root), path.join(root, 'optional-ai'));
  fs.writeFileSync(configPath, JSON.stringify({ port: 3186 }));
  assert.throws(() => configFor(root), /Unknown launcher setting/);
  fs.writeFileSync(configPath, JSON.stringify({ enableAI: 'false' }));
  assert.throws(() => configFor(root), /must be true or false/);
});
test('occupied port is refused without closing its owner', async t => {
  const server = net.createServer(socket => socket.end('original listener'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  await assert.rejects(assertPortFree(port), /occupied or unavailable/);
  assert.equal(server.listening, true);
});
