'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const express = require('../backend/node_modules/express');
const { MODE, ROUTES, validPayload, fingerprint } = require('./contract.cjs');
const connections = new WeakMap();

// Only this module can create capabilities. URL strings/env overrides are rejected.
function getConnection(handle) {
  const details = handle && connections.get(handle);
  if (!details) throw new Error('Only an active local simulator connection is permitted');
  const url = new URL(details.baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Non-loopback or non-simulator destination blocked');
  }
  return details;
}

function sameSecret(actual, expected) {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function startSimulator() {
  const app = express();
  app.disable('x-powered-by');
  const token = randomBytes(32).toString('hex');
  const instanceId = randomBytes(16).toString('hex');
  const records = { customer: new Map(), lead: new Map(), appointment: new Map() };
  const receipts = new Map();
  const faults = { appointmentFailure: false, delayMs: 0, malformedSuccess: false, redirect: false };
  const envelope = extra => ({ mode: MODE, instanceId, ...extra });
  const fail = (res, status, code) => res.status(status).json(envelope({ error: { code } }));

  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin) return fail(res, 403, 'BROWSER_ORIGIN_BLOCKED');
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) return fail(res, 403, 'HOST_BLOCKED');
    next();
  });
  app.get('/api/health', (_req, res) => res.json(envelope({ status: 'ok', persistence: 'memory-only' })));
  app.use((req, res, next) => {
    if (!sameSecret(req.headers.authorization, `Bearer ${token}`) ||
        !sameSecret(req.headers['x-integration-prep-instance'], instanceId)) return fail(res, 401, 'TEST_AUTH_REQUIRED');
    next();
  });
  app.get('/api/customers', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return fail(res, 400, 'INVALID_PAGINATION');
    }
    let rows = [...records.customer.values()];
    if (search) {
      rows = rows.filter(row =>
        row.displayName.toLowerCase().includes(search) ||
        row.email.toLowerCase().includes(search)
      );
    }
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return res.json(envelope({
      dataOrigin: 'synthetic-test-data',
      records: rows.slice(start, start + pageSize),
      pagination: { page, pageSize, total }
    }));
  });

  app.get('/api/customers/:id', (req, res) => {
    if (!/^sim-customer-[1-9][0-9]*$/.test(req.params.id)) {
      return fail(res, 400, 'INVALID_CUSTOMER_ID');
    }
    const record = records.customer.get(req.params.id);
    if (!record) return fail(res, 404, 'CUSTOMER_NOT_FOUND');
    return res.json(envelope({
      dataOrigin: 'synthetic-test-data',
      record
    }));
  });
  app.use(express.json({ limit: '8kb', strict: true }));
  app.post(Object.keys(ROUTES), async (req, res) => {
    const kind = ROUTES[req.path];
    if (!req.is('application/json')) return fail(res, 415, 'JSON_REQUIRED');
    if (!validPayload(kind, req.body)) return fail(res, 400, 'INVALID_SYNTHETIC_PAYLOAD');
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(key)) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED');
    const receiptKey = `${req.path}:${key}`;
    const bodyPrint = fingerprint(req.body);
    // Delay before receipt lookup: concurrent identical calls still create one record.
    if (faults.delayMs) await new Promise(resolve => setTimeout(resolve, faults.delayMs));
    const previous = receipts.get(receiptKey);
    if (previous) {
      if (previous.bodyPrint !== bodyPrint) return fail(res, 409, 'IDEMPOTENCY_CONFLICT');
      return res.status(200).json(envelope({ replayed: true, record: previous.record }));
    }
    if (faults.redirect) return res.redirect(307, '/blocked-test-redirect');
    if (kind === 'appointment') {
      if (!records.customer.has(req.body.customerId)) return fail(res, 422, 'UNKNOWN_SYNTHETIC_CUSTOMER');
      if (faults.appointmentFailure) return fail(res, 503, 'SIMULATED_APPOINTMENT_UNAVAILABLE');
    }
    const record = { id: `sim-${kind}-${records[kind].size + 1}`, ...req.body };
    records[kind].set(record.id, record);
    receipts.set(receiptKey, { bodyPrint, record });
    if (faults.malformedSuccess) return res.status(201).json(envelope({ replayed: false, record: { id: 'invalid' } }));
    return res.status(201).json(envelope({ replayed: false, record }));
  });
  app.use((_req, res) => fail(res, 404, 'UNSUPPORTED_TEST_ROUTE'));
  app.use((error, _req, res, _next) => {
    fail(res, error.type === 'entity.too.large' ? 413 : 400, 'INVALID_JSON_BODY');
  });

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  server.requestTimeout = 3000;
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const connection = Object.freeze({ mode: MODE });
  connections.set(connection, Object.freeze({ baseUrl, token, instanceId }));
  return Object.freeze({
    baseUrl, connection,
    counts: () => Object.fromEntries(Object.entries(records).map(([kind, rows]) => [kind, rows.size])),
    setFaults(change) {
      for (const key of Object.keys(change)) {
        if (!Object.hasOwn(faults, key)) throw new Error('Unknown synthetic fault');
        if (key === 'delayMs') {
          if (!Number.isInteger(change[key]) || change[key] < 0 || change[key] > 1000) throw new Error('Invalid synthetic delay');
        } else if (typeof change[key] !== 'boolean') throw new Error('Invalid synthetic fault');
      }
      Object.assign(faults, change);
    },
    async close() {
      connections.delete(connection);
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  });
}

module.exports = { startSimulator, getConnection };
if (require.main === module) {
  startSimulator().then(sim => {
    console.log(`SYNTHETIC ONLY: ${sim.baseUrl}api/health (memory-only; no real Phase 1 connection)`);
    console.log('Runtime test credentials are not printed. Use demo.cjs for authenticated requests. Ctrl+C stops this service.');
    process.once('SIGINT', () => sim.close().then(() => process.exit(0)));
    process.once('SIGTERM', () => sim.close().then(() => process.exit(0)));
  }).catch(() => { console.error('Local simulator could not start'); process.exitCode = 1; });
}

