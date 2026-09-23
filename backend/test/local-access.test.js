'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const http = require('node:http');
const { attachLocalAccess } = require('../services/local-access');

const PASSWORD = 'Synthetic-test-password-2026';
const SECOND_PASSWORD = 'Changed-synthetic-password-2026';

async function harness(t, options = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  let currentTime = Date.parse('2026-09-18T09:00:00Z');
  const app = options.actual ? require('../app').createApp({ db, accessControl: true, now: () => currentTime }).app : express();
  if (!options.actual) {
  app.use(express.json());
  attachLocalAccess(app, { db, enabled: true, now: () => currentTime, ...options });
  app.get('/api/health', (_req, res) => res.json({ success: true }));
  app.get('/api/campaigns', (_req, res) => res.json({ success: true, data: [] }));
  app.post('/api/campaigns', (_req, res) => res.status(201).json({ success: true }));
  app.delete('/api/campaigns/:id', (_req, res) => res.json({ success: true }));
  app.post('/api/campaigns/:id/intake-link', (_req, res) => res.json({ success: true }));
  app.get('/api/capture/:token', (_req, res) => res.json({ success: true }));
  app.post('/api/capture/:token', (_req, res) => res.json({ success: true }));
  app.get('/capture/:token', (_req, res) => res.type('html').send('<p>Public local form</p>'));
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, message: error.message }));
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const request = async (path, { body, cookie, method, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, data: json?.data, json, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const setup = async () => request('/api/account/setup', { body: { username: 'admin', password: PASSWORD } });
  const login = async (username = 'admin', password = PASSWORD) => request('/api/account/login', { body: { username, password } });
  return { db, base, request, setup, login, advance: milliseconds => { currentTime += milliseconds; } };
}

test('access can be disabled explicitly for isolated legacy tests without creating accounts', async t => {
  const h = await harness(t, { enabled: false });
  assert.equal((await h.request('/api/account/status')).data.enabled, false);
  assert.equal((await h.request('/api/campaigns')).status, 200);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='local_users'").get().count, 0);
});

test('first use requires setup; administrator is created once, secrets are hashed and cookie is protected', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/api/account/status')).data.needsSetup, true);
  assert.equal((await h.request('/api/campaigns')).status, 401);
  const setup = await h.setup();
  assert.equal(setup.status, 201);
  assert.equal(setup.data.role, 'admin');
  assert.ok(!JSON.stringify(setup.data).includes(PASSWORD));
  assert.match(setup.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(setup.headers.get('set-cookie'), /Path=\//);
  assert.match(setup.headers.get('set-cookie'), /Max-Age=43200/);
  const user = h.db.prepare('SELECT * FROM local_users').get();
  assert.notEqual(user.password_hash, PASSWORD);
  assert.equal(user.password_hash.length, 64);
  assert.equal(user.password_salt.length, 32);
  const session = h.db.prepare('SELECT * FROM local_sessions').get();
  assert.notEqual(session.token_hash, setup.cookie.split('=')[1]);
  assert.equal((await h.setup()).status, 409);
  const status = await h.request('/api/account/status', { cookie: setup.cookie });
  assert.equal(status.data.authenticated, true);
  assert.equal(status.data.canWrite, true);
  assert.equal(status.data.needsSetup, false);
});

test('setup validates username and bounded password without creating a partial account', async t => {
  const h = await harness(t);
  for (const body of [
    { username: '<script>', password: PASSWORD },
    { username: 'admin', password: 'short' },
    { username: 'admin', password: 'x'.repeat(129) },
    { username: 'x'.repeat(41), password: PASSWORD }
  ]) assert.equal((await h.request('/api/account/setup', { body })).status, 400);
  assert.equal((await h.request('/api/account/status')).data.needsSetup, true);
});

test('sign-in rejects wrong credentials and rate limits repeated failures', async t => {
  const h = await harness(t);
  await h.setup();
  assert.equal((await h.login('absent', PASSWORD)).status, 401);
  assert.equal((await h.login('admin', 'x'.repeat(129))).status, 400);
  for (let n = 0; n < 4; n++) assert.equal((await h.login('admin', 'wrong-password')).status, 401);
  const limited = await h.login();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  h.advance(15 * 60 * 1000 + 1);
  assert.equal((await h.login('ADMIN')).status, 200);
});

test('logout removes the session and expired sessions cannot read records', async t => {
  const h = await harness(t, { sessionTtlMs: 60000 });
  const first = await h.setup();
  assert.equal((await h.request('/api/campaigns', { cookie: first.cookie })).status, 200);
  const logout = await h.request('/api/account/logout', { cookie: first.cookie, body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await h.request('/api/campaigns', { cookie: first.cookie })).status, 401);
  const second = await h.login();
  h.advance(60001);
  assert.equal((await h.request('/api/campaigns', { cookie: second.cookie })).status, 401);
  assert.equal((await h.request('/api/account/status', { cookie: second.cookie })).data.authenticated, false);
});

test('viewer reads but cannot change CRM records or manage accounts; editor can change records only', async t => {
  const h = await harness(t);
  const admin = await h.setup();
  for (const role of ['viewer', 'editor']) {
    const created = await h.request('/api/account/users', { cookie: admin.cookie, body: { username: role, password: PASSWORD, role } });
    assert.equal(created.status, 201);
    const user = await h.login(role);
    assert.equal((await h.request('/api/campaigns', { cookie: user.cookie })).status, 200);
    const permitted = role === 'editor';
    assert.equal((await h.request('/api/account/status', { cookie: user.cookie })).data.canWrite, permitted);
    assert.equal((await h.request('/api/campaigns', { cookie: user.cookie, body: {} })).status, permitted ? 201 : 403);
    assert.equal((await h.request('/api/campaigns/CAM-001', { cookie: user.cookie, method: 'DELETE' })).status, permitted ? 200 : 403);
    assert.equal((await h.request('/api/campaigns/CAM-001/intake-link', { cookie: user.cookie, body: {} })).status, permitted ? 200 : 403);
    assert.equal((await h.request('/api/account/users', { cookie: user.cookie })).status, 403);
    assert.equal((await h.request('/api/account/users', { cookie: user.cookie, body: { username: 'badadmin', password: PASSWORD, role: 'admin' } })).status, 403);
    assert.equal((await h.request('/api/account/logout', { cookie: user.cookie, body: {} })).status, 200);
  }
});

test('administrator account management validates duplicate usernames, roles and IDs', async t => {
  const h = await harness(t);
  const admin = await h.setup();
  assert.equal((await h.request('/api/account/users', { cookie: admin.cookie, body: { username: 'ADMIN', password: PASSWORD, role: 'viewer' } })).status, 409);
  assert.equal((await h.request('/api/account/users', { cookie: admin.cookie, body: { username: 'person', password: PASSWORD, role: 'owner' } })).status, 400);
  assert.equal((await h.request('/api/account/users/invalid', { cookie: admin.cookie, method: 'PATCH', body: { role: 'editor', active: true } })).status, 400);
  assert.equal((await h.request('/api/account/users/999', { cookie: admin.cookie, method: 'PATCH', body: { role: 'editor', active: true } })).status, 404);
  assert.equal((await h.request('/api/account/users/1', { cookie: admin.cookie, method: 'PATCH', body: { role: 'viewer', active: 'yes' } })).status, 400);
});

test('the last administrator cannot be disabled or demoted', async t => {
  const h = await harness(t);
  const admin = await h.setup();
  for (const body of [{ role: 'viewer', active: true }, { role: 'admin', active: false }]) {
    const result = await h.request('/api/account/users/1', { cookie: admin.cookie, method: 'PATCH', body });
    assert.equal(result.status, 409);
  }
  assert.equal((await h.request('/api/campaigns', { cookie: admin.cookie })).status, 200);
});

test('disabling or changing a role revokes old sessions and disabled users cannot sign in', async t => {
  const h = await harness(t);
  const admin = await h.setup();
  const second = await h.request('/api/account/users', { cookie: admin.cookie, body: { username: 'second-admin', password: PASSWORD, role: 'admin' } });
  const login = await h.login('second-admin');
  assert.equal((await h.request('/api/account/users/' + second.data.id, { cookie: admin.cookie, method: 'PATCH', body: { role: 'editor', active: true } })).status, 200);
  assert.equal((await h.request('/api/campaigns', { cookie: login.cookie })).status, 401);
  const relogin = await h.login('second-admin');
  assert.equal(relogin.data.role, 'editor');
  assert.equal((await h.request('/api/account/users/' + second.data.id, { cookie: admin.cookie, method: 'PATCH', body: { role: 'editor', active: false } })).status, 200);
  assert.equal((await h.request('/api/campaigns', { cookie: relogin.cookie })).status, 401);
  assert.equal((await h.login('second-admin')).status, 401);
});

test('password change verifies current password, replaces all sessions, and permits viewers to change their own password', async t => {
  const h = await harness(t);
  const admin = await h.setup();
  await h.request('/api/account/users', { cookie: admin.cookie, body: { username: 'viewer', password: PASSWORD, role: 'viewer' } });
  const first = await h.login('viewer');
  const second = await h.login('viewer');
  assert.equal((await h.request('/api/account/password', { cookie: first.cookie, body: { currentPassword: 'wrong', newPassword: SECOND_PASSWORD } })).status, 400);
  const changed = await h.request('/api/account/password', { cookie: first.cookie, body: { currentPassword: PASSWORD, newPassword: SECOND_PASSWORD } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.cookie, first.cookie);
  for (const cookie of [first.cookie, second.cookie]) assert.equal((await h.request('/api/campaigns', { cookie })).status, 401);
  assert.equal((await h.request('/api/campaigns', { cookie: changed.cookie })).status, 200);
  assert.equal((await h.login('viewer', PASSWORD)).status, 401);
  assert.equal((await h.login('viewer', SECOND_PASSWORD)).status, 200);
});

test('administrator password reset revokes a target account but cannot bypass own-password confirmation', async t => {
  const h = await harness(t);
  const admin = await h.setup();
  const added = await h.request('/api/account/users', { cookie: admin.cookie, body: { username: 'editor', password: PASSWORD, role: 'editor' } });
  const editor = await h.login('editor');
  assert.equal((await h.request('/api/account/users/1/password', { cookie: admin.cookie, body: { password: SECOND_PASSWORD } })).status, 400);
  assert.equal((await h.request('/api/account/users/' + added.data.id + '/password', { cookie: admin.cookie, body: { password: SECOND_PASSWORD } })).status, 200);
  assert.equal((await h.request('/api/campaigns', { cookie: editor.cookie })).status, 401);
  assert.equal((await h.login('editor', SECOND_PASSWORD)).status, 200);
});

test('anonymous respondent form and health remain public but staff intake link and unknown APIs stay private', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/api/health')).status, 200);
  assert.equal((await h.request('/api/capture/abc_123-test')).status, 200);
  assert.equal((await h.request('/api/capture/abc_123-test', { body: { name: 'Synthetic contact' } })).status, 200);
  assert.equal((await h.request('/capture/abc_123-test')).status, 200);
  assert.equal((await h.request('/api/campaigns/CAM-001/intake-link', { body: {} })).status, 401);
  assert.equal((await h.request('/api/capture/abc_123-test/admin')).status, 401);
  assert.equal((await h.request('/api/anything')).status, 401);
  assert.equal((await h.request('/api/capture/abc_123-test', { method: 'DELETE' })).status, 401);
});

test('cross-site, other-port and foreign Host requests cannot set up or mutate authenticated records', async t => {
  const h = await harness(t);
  const body = { username: 'admin', password: PASSWORD };
  assert.equal((await h.request('/api/account/setup', { body, headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await h.request('/api/account/setup', { body, headers: { Origin: 'null' } })).status, 403);
  assert.equal((await h.request('/api/account/setup', { body, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.request(h.base + '/api/account/setup', { method: 'POST', headers: { Host: 'attacker.example', 'Content-Type': 'application/json' } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
  assert.equal(foreignHostStatus, 403);
  const admin = await h.request('/api/account/setup', { body, headers: { Origin: h.base } });
  assert.equal(admin.status, 201);
  assert.equal((await h.request('/api/campaigns', { body: {}, cookie: admin.cookie, headers: { Origin: 'http://127.0.0.1:8080' } })).status, 403);
  assert.equal((await h.request('/api/campaigns/CAM-001', { method: 'DELETE', cookie: admin.cookie, headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await h.request('/api/campaigns', { body: {}, cookie: admin.cookie, headers: { Origin: h.base } })).status, 201);
});

test('actual combined app protects asset/intake mutations and persistent campaign data with access enabled', async t => {
  const h = await harness(t, { actual: true });
  assert.equal((await h.request('/api/account/status')).data.enabled, true);
  assert.equal((await h.request('/api/campaigns')).status, 401);
  assert.equal((await h.request('/api/banner-drafts/generate', { body: {} })).status, 401);
  assert.equal((await h.request('/api/banner-drafts/upload', { body: {} })).status, 401);
  const admin = await h.setup();
  assert.equal(admin.status, 201);
  assert.equal((await h.request('/api/campaigns', { cookie: admin.cookie })).status, 200);
  await h.request('/api/account/users', { cookie: admin.cookie, body: { username: 'viewer', password: PASSWORD, role: 'viewer' } });
  const viewer = await h.login('viewer');
  assert.equal(viewer.status, 200);
  assert.equal((await h.request('/api/banner-drafts/upload', { cookie: viewer.cookie, body: {} })).status, 403);
  assert.equal((await h.request('/api/campaigns/CAM-001/intake-link', { cookie: viewer.cookie, body: {} })).status, 403);
  assert.equal((await h.request('/api/banner-drafts/generate', { cookie: viewer.cookie, body: {} })).status, 403);
  assert.equal((await h.request('/api/campaigns', { cookie: viewer.cookie })).status, 200);
  assert.equal((await h.request('/api/capture/' + 'a'.repeat(64))).status, 404);
  assert.equal((await h.request('/api/ai/status')).status, 401);
});
