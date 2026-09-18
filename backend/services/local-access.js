'use strict';

const crypto = require('node:crypto');

const COOKIE = 'divinenet_session';
const ROLES = new Set(['admin', 'editor', 'viewer']);
const SESSION_TTL = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const ok = (res, value, status = 200) => res.status(status).json({ success: true, data: value });

function passwordError(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || Buffer.byteLength(password) > 512) {
    return 'Use a password with 12 to 128 characters.';
  }
  return null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex') };
}

function publicUser(row) {
  return row ? { id: row.id, username: row.username, role: row.role, active: Boolean(row.active), createdAt: row.created_at } : null;
}

function attachLocalAccess(app, { db, enabled = false, now = Date.now, sessionTtlMs = SESSION_TTL } = {}) {
  const clock = () => Number(new Date(now()));
  if (!enabled) {
    app.get('/api/account/status', (_req, res) => ok(res, { enabled: false, needsSetup: false, authenticated: false, user: null, canWrite: true }));
    return { enabled: false };
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_sessions_expiry ON local_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS local_sessions_user ON local_sessions(user_id);
  `);

  const attempts = new Map();
  const countUsers = () => db.prepare('SELECT COUNT(*) AS count FROM local_users').get().count;
  const cookieToken = req => {
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)divinenet_session=([a-f0-9]{64})(?:;|$)/);
    return match ? match[1] : null;
  };
  const setCookie = (res, token) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionTtlMs / 1000)}`);
  const clearCookie = res => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  const issueSession = (res, userId) => {
    const time = clock();
    db.prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(time);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO local_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(digest(token), userId, time + sessionTtlMs, time);
    setCookie(res, token);
  };
  const requireAdmin = (req, res, next) => req.localUser?.role === 'admin' ? next() : fail(res, 403, 'An administrator account is required.');
  const checkPassword = (password, row) => {
    // A fixed dummy salt keeps an unknown username on the same password-check path.
    const computed = hashPassword(password, row?.password_salt || 'a69d2e6e4e85f8b9b21d68398f3c5dfa').hash;
    const expected = row?.password_hash || '0'.repeat(64);
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(expected, 'hex')) && Boolean(row);
  };
  const normalUsername = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const credentialsError = body => {
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalUsername(body?.username))) return 'Use a username with 3 to 40 letters, numbers, dots, underscores or hyphens.';
    return passwordError(body?.password);
  };
  const newUser = (body, role) => {
    const password = hashPassword(body.password);
    const result = db.prepare('INSERT INTO local_users(username,password_hash,password_salt,role,created_at) VALUES (?,?,?,?,?)')
      .run(normalUsername(body.username), password.hash, password.salt, role, new Date(clock()).toISOString());
    return db.prepare('SELECT * FROM local_users WHERE id=?').get(result.lastInsertRowid);
  };

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-store');
    // This is a local-only release. Refuse Host-header rebinding and cross-origin writes,
    // including other localhost ports which may run unrelated applications.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return fail(res, 403, 'Local access only.');
    if (!READ_METHODS.has(req.method)) {
      const origin = req.get('origin');
      const expectedOrigin = `${req.protocol}://${req.get('host')}`;
      if ((origin && origin !== expectedOrigin) || req.get('sec-fetch-site') === 'cross-site') return fail(res, 403, 'Cross-origin changes are not allowed.');
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) return fail(res, 415, 'Content-Type must be application/json.');
    }
    const token = cookieToken(req);
    if (token) {
      req.localUser = db.prepare(`SELECT u.* FROM local_users u JOIN local_sessions s ON s.user_id=u.id
        WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(digest(token), clock()) || null;
      req.localSessionHash = digest(token);
    }
    const publicAccount = ['/api/account/status', '/api/account/setup', '/api/account/login'].includes(req.path);
    const publicCapture = /^\/api\/capture\/[A-Za-z0-9_-]+\/?$/.test(req.path) && ['GET', 'POST'].includes(req.method);
    if (req.path === '/api/health' || publicAccount || publicCapture) return next();
    if (!req.localUser) return fail(res, 401, 'Sign in to continue.');
    if (req.localUser.role === 'viewer' && !READ_METHODS.has(req.method) && !['/api/account/logout', '/api/account/password'].includes(req.path)) {
      return fail(res, 403, 'This account is read-only. Ask an administrator for editor access.');
    }
    next();
  });

  app.get('/api/account/status', (req, res) => ok(res, {
    enabled: true, needsSetup: countUsers() === 0, authenticated: Boolean(req.localUser),
    user: publicUser(req.localUser), canWrite: Boolean(req.localUser && req.localUser.role !== 'viewer')
  }));

  const setup = db.transaction(body => {
    if (countUsers() !== 0) return null;
    return newUser(body, 'admin');
  });
  app.post('/api/account/setup', (req, res) => {
    const error = credentialsError(req.body);
    if (error) return fail(res, 400, error);
    // IMMEDIATE acquires the write reservation before checking for the first user.
    const user = setup.immediate(req.body);
    if (!user) return fail(res, 409, 'Setup is already complete. Sign in with an existing account.');
    issueSession(res, user.id);
    return ok(res, publicUser(user), 201);
  });

  app.post('/api/account/login', (req, res) => {
    const time = clock();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    const ipKey = `ip:${req.socket.remoteAddress || 'local'}`;
    const username = normalUsername(req.body?.username).slice(0, 40);
    const userKey = `name:${username}`;
    const ip = attempts.get(ipKey);
    const named = attempts.get(userKey);
    if ((ip && ip.count >= 20) || (named && named.count >= 5)) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((Math.max(ip?.until || 0, named?.until || 0) - time) / 1000))));
      return fail(res, 429, 'Too many sign-in attempts. Try again in 15 minutes.');
    }
    const addAttempt = key => {
      const previous = attempts.get(key);
      if (!previous && attempts.size >= 1000) attempts.delete(attempts.keys().next().value);
      attempts.set(key, { count: (previous?.count || 0) + 1, until: previous?.until || time + LOGIN_WINDOW });
    };
    addAttempt(ipKey);
    addAttempt(userKey);
    if (typeof req.body?.password !== 'string' || req.body.password.length > 128 || Buffer.byteLength(req.body.password) > 512) return fail(res, 400, 'Invalid sign-in details.');
    const user = db.prepare('SELECT * FROM local_users WHERE username=?').get(username);
    if (!checkPassword(req.body.password, user) || !user?.active) return fail(res, 401, 'Username or password is incorrect.');
    attempts.delete(userKey);
    // Keep the aggregate IP budget even after success to bound password-check work.
    issueSession(res, user.id);
    return ok(res, publicUser(user));
  });

  app.post('/api/account/logout', (req, res) => {
    if (req.localSessionHash) db.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(req.localSessionHash);
    clearCookie(res);
    ok(res, { signedOut: true });
  });

  app.post('/api/account/password', (req, res) => {
    const error = passwordError(req.body?.newPassword);
    if (error) return fail(res, 400, error);
    if (typeof req.body.currentPassword !== 'string' || req.body.currentPassword.length > 128 || !checkPassword(req.body.currentPassword, req.localUser)) {
      return fail(res, 400, 'Your current password is incorrect.');
    }
    const password = hashPassword(req.body.newPassword);
    db.transaction(() => {
      db.prepare('UPDATE local_users SET password_hash=?,password_salt=? WHERE id=?').run(password.hash, password.salt, req.localUser.id);
      db.prepare('DELETE FROM local_sessions WHERE user_id=?').run(req.localUser.id);
    })();
    issueSession(res, req.localUser.id);
    ok(res, { changed: true, message: 'Password changed. Other sessions have been signed out.' });
  });

  app.get('/api/account/users', requireAdmin, (_req, res) => ok(res, db.prepare('SELECT * FROM local_users ORDER BY username').all().map(publicUser)));
  app.post('/api/account/users', requireAdmin, (req, res) => {
    const error = credentialsError(req.body);
    if (error) return fail(res, 400, error);
    if (!ROLES.has(req.body.role)) return fail(res, 400, 'Choose admin, editor or viewer.');
    try { return ok(res, publicUser(newUser(req.body, req.body.role)), 201); }
    catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return fail(res, 409, 'That username is already in use.');
      throw error;
    }
  });

  app.patch('/api/account/users/:id', requireAdmin, (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return fail(res, 400, 'Invalid account ID.');
    if (!ROLES.has(req.body?.role) || typeof req.body.active !== 'boolean') return fail(res, 400, 'Provide a valid role and active setting.');
    const result = db.transaction(() => {
      const user = db.prepare('SELECT * FROM local_users WHERE id=?').get(req.params.id);
      if (!user) return { error: 'Account not found.', status: 404 };
      const removingAdmin = user.active && user.role === 'admin' && (!req.body.active || req.body.role !== 'admin');
      if (removingAdmin && db.prepare("SELECT COUNT(*) AS count FROM local_users WHERE active=1 AND role='admin'").get().count <= 1) {
        return { error: 'Keep at least one active administrator.', status: 409 };
      }
      db.prepare('UPDATE local_users SET role=?,active=? WHERE id=?').run(req.body.role, req.body.active ? 1 : 0, user.id);
      db.prepare('DELETE FROM local_sessions WHERE user_id=?').run(user.id);
      return { user: db.prepare('SELECT * FROM local_users WHERE id=?').get(user.id) };
    }).immediate();
    if (result.error) return fail(res, result.status, result.error);
    if (result.user.id === req.localUser.id) clearCookie(res);
    ok(res, publicUser(result.user));
  });

  app.post('/api/account/users/:id/password', requireAdmin, (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return fail(res, 400, 'Invalid account ID.');
    const error = passwordError(req.body?.password);
    if (error) return fail(res, 400, error);
    const user = db.prepare('SELECT * FROM local_users WHERE id=?').get(req.params.id);
    if (!user) return fail(res, 404, 'Account not found.');
    if (user.id === req.localUser.id) return fail(res, 400, 'Use Change password for your own account.');
    const password = hashPassword(req.body.password);
    db.transaction(() => {
      db.prepare('UPDATE local_users SET password_hash=?,password_salt=? WHERE id=?').run(password.hash, password.salt, user.id);
      db.prepare('DELETE FROM local_sessions WHERE user_id=?').run(user.id);
    })();
    ok(res, { changed: true });
  });

  return { enabled: true };
}

module.exports = { attachLocalAccess };
