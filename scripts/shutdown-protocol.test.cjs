'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { sendStopRequest, waitForProcessExit } = require('./start-crm.cjs');

async function endpoint(t, handler) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { host: '127.0.0.1', port: server.address().port };
}

test('complete acknowledgement settles without waiting for EOF or false timeout', async t => {
  const address = await endpoint(t, socket => socket.once('data', () => socket.write('OK\n')));
  await sendStopRequest(address, 'test-token', 200);
  await delay(250);
});

test('fragmented acknowledgement is accepted', async t => {
  const address = await endpoint(t, socket => socket.once('data', () => {
    socket.write('O'); setTimeout(() => socket.write('K\n'), 20);
  }));
  await sendStopRequest(address, 'test-token', 500);
});

test('denial and missing confirmation are failures', async t => {
  const denied = await endpoint(t, socket => socket.once('data', () => socket.end('DENIED\n')));
  await assert.rejects(sendStopRequest(denied, 'test-token'), /failed/);
  const closed = await endpoint(t, socket => socket.once('data', () => socket.end()));
  await assert.rejects(sendStopRequest(closed, 'test-token'), /without confirmation/);
});

test('unresponsive stop endpoint still times out', async t => {
  const address = await endpoint(t, socket => socket.on('data', () => {}));
  await assert.rejects(sendStopRequest(address, 'test-token', 100), /timed out/);
});

test('process exit wait does not return on acknowledgement alone', async () => {
  let alive = true;
  const timer = setTimeout(() => { alive = false; }, 100);
  try { await waitForProcessExit(123, 1000, () => alive); assert.equal(alive, false); }
  finally { clearTimeout(timer); }
  await assert.rejects(waitForProcessExit(123, 60, () => true), /shutdown timed out/);
});
