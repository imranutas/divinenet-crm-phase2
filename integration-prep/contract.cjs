'use strict';

// Invented test fields, not the received Phase 1 schema or accepted business rules.
const MODE = 'synthetic-only';
const ROUTES = Object.freeze({
  '/api/customers': 'customer', '/api/leads': 'lead', '/api/appointments': 'appointment'
});
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 120;
const fixtureId = value => typeof value === 'string' && /^fixture-[a-z0-9-]{1,60}$/.test(value);
function validPayload(kind, body) {
  if (!isObject(body) || body.synthetic !== true || !fixtureId(body.sourceRef)) return false;
  let fields;
  if (kind === 'customer' || kind === 'lead') {
    fields = ['synthetic', 'sourceRef', 'displayName', 'email'];
    if (!text(body.displayName) || !body.displayName.startsWith('Fictional ') ||
        typeof body.email !== 'string' || !/^[a-z0-9._+-]+@example\.invalid$/.test(body.email)) return false;
  } else if (kind === 'appointment') {
    fields = ['synthetic', 'sourceRef', 'customerId', 'startsAt', 'durationMinutes'];
    if (typeof body.customerId !== 'string' || !/^sim-customer-[1-9][0-9]*$/.test(body.customerId) ||
        typeof body.startsAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(body.startsAt) ||
        !Number.isFinite(Date.parse(body.startsAt)) || new Date(body.startsAt).toISOString() !== body.startsAt ||
        !Number.isInteger(body.durationMinutes) || body.durationMinutes < 1 || body.durationMinutes > 120) return false;
  } else return false;
  return Object.keys(body).length === fields.length && fields.every(field => Object.hasOwn(body, field));
}
function fingerprint(body) {
  return JSON.stringify(Object.fromEntries(Object.keys(body).sort().map(key => [key, body[key]])));
}
function validRecord(kind, record, sent) {
  if (!isObject(record) || typeof record.id !== 'string' ||
      !new RegExp(`^sim-${kind}-[1-9][0-9]*$`).test(record.id)) return false;
  const { id, ...payload } = record;
  return validPayload(kind, payload) && fingerprint(payload) === fingerprint(sent);
}
function fixtures() {
  return {
    customer: { synthetic: true, sourceRef: 'fixture-customer-001', displayName: 'Fictional Example Customer', email: 'customer001@example.invalid' },
    lead: { synthetic: true, sourceRef: 'fixture-lead-001', displayName: 'Fictional Example Lead', email: 'lead001@example.invalid' },
    appointment: { synthetic: true, sourceRef: 'fixture-appointment-001', startsAt: '2026-09-23T00:00:00.000Z', durationMinutes: 30 }
  };
}
module.exports = { MODE, ROUTES, isObject, validPayload, validRecord, fingerprint, fixtures };
