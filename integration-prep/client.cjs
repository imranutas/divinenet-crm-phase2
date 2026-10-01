'use strict';

const { getConnection } = require('./simulator.cjs');
const { MODE, ROUTES, isObject, validPayload, validRecord } = require('./contract.cjs');

class PrepError extends Error {
  constructor(code, { status = null, uncertain = false } = {}) {
    super(code); this.name = 'PrepError'; this.code = code;
    this.status = status; this.uncertain = uncertain;
  }
}

function createPrepClient(connection, { timeoutMs = 1000 } = {}) {
  getConnection(connection);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 5000) throw new Error('Invalid local timeout');
  async function request(path, body, key) {
    const { baseUrl, token, instanceId } = getConnection(connection);
    const isWrite = body !== undefined;
    const kind = ROUTES[path];
    if (isWrite && (!validPayload(kind, body) || typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(key))) {
      throw new PrepError('INVALID_LOCAL_REQUEST');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method: isWrite ? 'POST' : 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'X-Integration-Prep-Instance': instanceId,
          ...(isWrite ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}) },
        ...(isWrite ? { body: JSON.stringify(body) } : {})
      });
      if (response.status >= 300 && response.status < 400) throw new PrepError('REDIRECT_BLOCKED', { status: response.status, uncertain: isWrite });
      let data;
      try { data = await response.json(); }
      catch { throw new PrepError('INVALID_RESPONSE', { status: response.status, uncertain: isWrite }); }
      if (!isObject(data) || data.mode !== MODE || data.instanceId !== instanceId) throw new PrepError('INVALID_RESPONSE', { status: response.status, uncertain: isWrite });
      if (!response.ok) {
        const code = isObject(data.error) && /^[A-Z0-9_]{1,80}$/.test(data.error.code) ? data.error.code : 'HTTP_FAILURE';
        throw new PrepError(code, { status: response.status, uncertain: isWrite && response.status >= 500 });
      }
      if (isWrite ? (![200, 201].includes(response.status) || typeof data.replayed !== 'boolean' || !validRecord(kind, data.record, body)) :
          (response.status !== 200 || data.status !== 'ok' || data.persistence !== 'memory-only')) {
        throw new PrepError('INVALID_RESPONSE', { status: response.status, uncertain: isWrite });
      }
      return data;
    } catch (error) {
      if (error instanceof PrepError) throw error;
      throw new PrepError(controller.signal.aborted ? 'TIMEOUT' : 'TRANSPORT_FAILURE', { uncertain: isWrite });
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({
    health: () => request('/api/health'),
    listCustomers: async ({ search = '', page = 1, pageSize = 20 } = {}) => {
      if (typeof search !== 'string' || !Number.isInteger(page) || page < 1 ||
          !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new PrepError('INVALID_LOCAL_REQUEST');
      }
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set('search', search.trim());
      const { baseUrl, token, instanceId } = getConnection(connection);
      const response = await fetch(new URL(`/api/customers?${params}`, baseUrl), {
        headers: { Authorization: `Bearer ${token}`, 'X-Integration-Prep-Instance': instanceId },
        redirect: 'manual'
      });
      const data = await response.json();
      if (!response.ok) throw new PrepError(data?.error?.code || 'HTTP_FAILURE', { status: response.status });
      if (!isObject(data) || data.mode !== MODE || data.instanceId !== instanceId ||
          data.dataOrigin !== 'synthetic-test-data' || !Array.isArray(data.records) ||
          !isObject(data.pagination)) throw new PrepError('INVALID_RESPONSE', { status: response.status });
      return data;
    },
    getCustomer: async id => {
      if (typeof id !== 'string' || !/^sim-customer-[1-9][0-9]*$/.test(id)) {
        throw new PrepError('INVALID_LOCAL_REQUEST');
      }
      const { baseUrl, token, instanceId } = getConnection(connection);
      const response = await fetch(new URL(`/api/customers/${id}`, baseUrl), {
        headers: { Authorization: `Bearer ${token}`, 'X-Integration-Prep-Instance': instanceId },
        redirect: 'manual'
      });
      const data = await response.json();
      if (!response.ok) throw new PrepError(data?.error?.code || 'HTTP_FAILURE', { status: response.status });
      if (!isObject(data) || data.mode !== MODE || data.instanceId !== instanceId ||
          data.dataOrigin !== 'synthetic-test-data' || !validRecord('customer', data.record, {
            synthetic: data.record?.synthetic,
            sourceRef: data.record?.sourceRef,
            displayName: data.record?.displayName,
            email: data.record?.email
          })) throw new PrepError('INVALID_RESPONSE', { status: response.status });
      return data;
    },
    createCustomer: (body, key) => request('/api/customers', body, key),
    createLead: (body, key) => request('/api/leads', body, key),
    createAppointment: (body, key) => request('/api/appointments', body, key)
  });
}

// A synthetic two-step exercise, not a conversion endpoint or business policy.
async function exerciseCustomerThenAppointment(client, customer, appointment, keys) {
  let customerResult;
  try { customerResult = await client.createCustomer(customer, keys.customer); }
  catch (error) {
    return { mode: MODE, status: 'customer-unconfirmed', customerId: null, appointmentId: null,
      error: { code: error.code || 'PREPARATION_ERROR', uncertain: error.uncertain === true } };
  }
  try {
    const booked = await client.createAppointment({ ...appointment, customerId: customerResult.record.id }, keys.appointment);
    return { mode: MODE, status: 'synthetic-both-confirmed', customerId: customerResult.record.id, appointmentId: booked.record.id };
  } catch (error) {
    return { mode: MODE, status: 'customer-confirmed-appointment-unconfirmed', customerId: customerResult.record.id,
      appointmentId: null, error: { code: error.code || 'PREPARATION_ERROR', uncertain: error.uncertain === true } };
  }
}
module.exports = { createPrepClient, exerciseCustomerThenAppointment, PrepError };

