'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { startSimulator, getConnection } = require('../simulator.cjs');
const { createPrepClient, exerciseCustomerThenAppointment } = require('../client.cjs');
const { fixtures, validPayload } = require('../contract.cjs');

async function setup(t, options) {
  const sim = await startSimulator();
  t.after(() => sim.close());
  return { sim, client: createPrepClient(sim.connection, options), sample: fixtures() };
}
function raw(sim, path, { body, auth = true, headers = {} } = {}) {
  const details = getConnection(sim.connection);
  return fetch(new URL(path, sim.baseUrl), { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'raw_test_001',
      ...(auth ? { Authorization: `Bearer ${details.token}`, 'X-Integration-Prep-Instance': details.instanceId } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

test('local health identifies synthetic memory-only service; no credential is returned', async t => {
  const { sim, client } = await setup(t);
  const body = await client.health();
  assert.equal(new URL(sim.baseUrl).hostname, '127.0.0.1');
  assert.equal(body.mode, 'synthetic-only');
  assert.equal(body.persistence, 'memory-only');
  assert.deepEqual(Object.keys(body).sort(), ['instanceId', 'mode', 'persistence', 'status']);
});

test('arbitrary external, local CRM, URL and forged connection inputs fail before HTTP', () => {
  for (const candidate of ['https://example.invalid', 'http://127.0.0.1:3192', { baseUrl: 'http://127.0.0.1:3192/', token: 'fake' }, {}]) {
    assert.throws(() => createPrepClient(candidate), /Only an active local simulator/);
  }
});

test('creates a fictional lead and customer without coupling them or assuming conversion', async t => {
  const { sim, client, sample } = await setup(t);
  assert.equal((await client.createLead(sample.lead, 'lead_test_001')).record.id, 'sim-lead-1');
  assert.equal((await client.createCustomer(sample.customer, 'customer_test_001')).record.id, 'sim-customer-1');
  assert.deepEqual(sim.counts(), { customer: 1, lead: 1, appointment: 0 });
});

test('missing and wrong test authentication return 401 without writes', async t => {
  const { sim, sample } = await setup(t);
  for (const options of [{ auth: false }, { headers: { Authorization: 'Bearer deliberately-invalid-test-token' } }]) {
    const response = await raw(sim, '/api/customers', { body: sample.customer, ...options });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'TEST_AUTH_REQUIRED');
  }
  assert.equal(sim.counts().customer, 0);
});

test('browser-origin writes are rejected; this is backend-only preparation', async t => {
  const { sim, sample } = await setup(t);
  assert.equal((await raw(sim, '/api/customers', { body: sample.customer, headers: { Origin: 'http://127.0.0.1:3192' } })).status, 403);
  assert.equal(sim.counts().customer, 0);
});

test('invalid JSON and invalid/nonfictional/extra-field payloads return 400 without writes', async t => {
  const { sim, client, sample } = await setup(t);
  for (const body of ['{broken', { ...sample.customer, synthetic: false }, { ...sample.customer, email: 'somebody@example.com' },
    { ...sample.customer, extra: true }, { ...sample.customer, sourceRef: 'unlabelled' }]) {
    assert.equal((await raw(sim, '/api/customers', { body })).status, 400);
  }
  await assert.rejects(client.createCustomer({}, 'valid_key_001'), { code: 'INVALID_LOCAL_REQUEST' });
  assert.equal(sim.counts().customer, 0);
});

test('oversized JSON, wrong content type and absent retry key are rejected', async t => {
  const { sim, sample } = await setup(t);
  assert.equal((await raw(sim, '/api/customers', { body: { ...sample.customer, displayName: 'Fictional ' + 'x'.repeat(9000) } })).status, 413);
  assert.equal((await raw(sim, '/api/customers', { body: sample.customer, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await raw(sim, '/api/customers', { body: sample.customer, headers: { 'Idempotency-Key': '' } })).status, 400);
  assert.equal(sim.counts().customer, 0);
});

test('same-key equivalent-payload retry returns the same record; changed payload is 409', async t => {
  const { sim, client, sample } = await setup(t);
  const first = await client.createCustomer(sample.customer, 'retry_test_001');
  const reordered = Object.fromEntries(Object.entries(sample.customer).reverse());
  const replay = await client.createCustomer(reordered, 'retry_test_001');
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, first.record.id);
  await assert.rejects(client.createCustomer({ ...sample.customer, displayName: 'Fictional Changed Customer' }, 'retry_test_001'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  assert.equal(sim.counts().customer, 1);
});

test('concurrent identical retries create one customer', async t => {
  const { sim, client, sample } = await setup(t);
  sim.setFaults({ delayMs: 30 });
  const responses = await Promise.all([client.createCustomer(sample.customer, 'concurrent_001'), client.createCustomer(sample.customer, 'concurrent_001')]);
  assert.equal(responses[0].record.id, responses[1].record.id);
  assert.equal(responses.filter(row => row.replayed).length, 1);
  assert.equal(sim.counts().customer, 1);
});

test('unknown synthetic customer is rejected; invalid dates and durations do not pass local validation', async t => {
  const { client, sample } = await setup(t);
  const appointment = { ...sample.appointment, customerId: 'sim-customer-999' };
  await assert.rejects(client.createAppointment(appointment, 'appointment_001'), { code: 'UNKNOWN_SYNTHETIC_CUSTOMER', status: 422 });
  for (const changes of [{ startsAt: '2026-02-30T00:00:00.000Z' }, { durationMinutes: 0 }, { durationMinutes: 121 }, { startsAt: '2026-09-23' }]) {
    assert.equal(validPayload('appointment', { ...appointment, ...changes }), false);
  }
});

test('customer success + appointment failure remains partial; same-key retry does not duplicate customer', async t => {
  const { sim, client, sample } = await setup(t);
  const keys = { customer: 'partial_customer_001', appointment: 'partial_appointment_001' };
  sim.setFaults({ appointmentFailure: true });
  const partial = await exerciseCustomerThenAppointment(client, sample.customer, sample.appointment, keys);
  assert.equal(partial.status, 'customer-confirmed-appointment-unconfirmed');
  assert.equal(partial.customerId, 'sim-customer-1');
  assert.equal(partial.appointmentId, null);
  assert.equal(partial.error.code, 'SIMULATED_APPOINTMENT_UNAVAILABLE');
  assert.deepEqual(sim.counts(), { customer: 1, lead: 0, appointment: 0 });
  sim.setFaults({ appointmentFailure: false });
  const retried = await exerciseCustomerThenAppointment(client, sample.customer, sample.appointment, keys);
  assert.equal(retried.status, 'synthetic-both-confirmed');
  assert.equal(retried.customerId, partial.customerId);
  assert.deepEqual(sim.counts(), { customer: 1, lead: 0, appointment: 1 });
});

test('customer request failure never initiates an appointment', async t => {
  const { sim, client, sample } = await setup(t);
  const result = await exerciseCustomerThenAppointment(client, {}, sample.appointment, { customer: 'invalid_customer_001', appointment: 'invalid_appointment_001' });
  assert.equal(result.status, 'customer-unconfirmed');
  assert.deepEqual(sim.counts(), { customer: 0, lead: 0, appointment: 0 });
});

test('write timeout is uncertain, not success or safe-new-key retry; original key recovers one record', async t => {
  const { sim, client, sample } = await setup(t, { timeoutMs: 20 });
  sim.setFaults({ delayMs: 80 });
  await assert.rejects(client.createCustomer(sample.customer, 'timeout_customer_001'), { code: 'TIMEOUT', uncertain: true });
  const slower = createPrepClient(sim.connection, { timeoutMs: 1000 });
  const recovered = await slower.createCustomer(sample.customer, 'timeout_customer_001');
  assert.equal(recovered.replayed, true);
  assert.equal(sim.counts().customer, 1);
});

test('malformed successful response is not accepted; retry receipt recovers acknowledged record', async t => {
  const { sim, client, sample } = await setup(t);
  sim.setFaults({ malformedSuccess: true });
  await assert.rejects(client.createCustomer(sample.customer, 'malformed_customer_001'), { code: 'INVALID_RESPONSE', uncertain: true });
  assert.equal((await client.createCustomer(sample.customer, 'malformed_customer_001')).replayed, true);
  assert.equal(sim.counts().customer, 1);
});

test('redirect is blocked and never followed', async t => {
  const { sim, client, sample } = await setup(t);
  sim.setFaults({ redirect: true });
  await assert.rejects(client.createCustomer(sample.customer, 'redirect_customer_001'), { code: 'REDIRECT_BLOCKED', status: 307 });
  assert.equal(sim.counts().customer, 0);
});

test('closing simulator revokes its connection; next instance starts empty', async () => {
  const sim = await startSimulator();
  const client = createPrepClient(sim.connection);
  await client.createCustomer(fixtures().customer, 'closed_customer_001');
  await sim.close();
  await assert.rejects(client.health(), /Only an active local simulator/);
  const fresh = await startSimulator();
  try { assert.deepEqual(fresh.counts(), { customer: 0, lead: 0, appointment: 0 }); }
  finally { await fresh.close(); }
});

test('proposed OpenAPI parses, resolves local references and covers only inventory-grounded test paths', () => {
  const spec = JSON.parse(readFileSync(join(__dirname, '..', 'openapi.proposed.json'), 'utf8'));
  assert.deepEqual(Object.keys(spec.paths).sort(), ['/api/appointments', '/api/customers', '/api/health', '/api/leads']);
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'));
      assert.ok(value.$ref.slice(2).split('/').reduce((node, key) => node?.[key], spec));
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(spec);
  assert.ok(spec.info.title.startsWith('SYNTHETIC ONLY'));
  assert.ok(validPayload('customer', spec.components.schemas.PersonInput.example));
  assert.ok(validPayload('appointment', spec.components.schemas.AppointmentInput.example));
});
