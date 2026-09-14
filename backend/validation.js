const CHANNELS = ['Facebook', 'Instagram', 'LinkedIn', 'Website'];
const STATUSES = ['Draft', 'Active', 'Paused', 'Completed'];
const CONSENT = ['Recorded', 'Not Recorded', 'Unknown'];
function parseBudget(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  if (!text) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?[kK]?$/.test(text)) return NaN;
  const amount = Number(text.replace(/,/g, '').replace(/[kK]$/, '')) * (/[kK]$/.test(text) ? 1000 : 1);
  return Number.isFinite(amount) && amount <= 1e12 ? Math.round(amount * 100) / 100 : NaN;
}
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function textFields(value, required, optional) {
  for (const field of required) {
    if (value[field] === undefined || value[field] === null || value[field] === '') return field + ' is required';
    if (typeof value[field] !== 'string') return field + ' must be text';
    if (!value[field].trim()) return field + ' is required';
    if (value[field].length > 4000) return field + ' is too long';
  }
  for (const field of optional) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string') return field + ' must be text';
    if (typeof value[field] === 'string' && value[field].length > 4000) return field + ' is too long';
  }
  return null;
}
function validateCampaign(value) {
  const error = textFields(value, ['campaignName', 'prompt', 'startDate', 'endDate', 'channel'], ['client', 'brand', 'clientId', 'brandId', 'objective', 'targetAudience', 'status']);
  if (error) return error;
  if (!isoDate(value.startDate) || !isoDate(value.endDate)) return 'Start date and end date must be valid dates';
  if (value.endDate < value.startDate) return 'End date cannot be before start date';
  if (Number.isNaN(parseBudget(value.budget))) return 'Budget must be a non-negative number';
  if (!CHANNELS.includes(value.channel)) return 'Channel must be Facebook, Instagram, LinkedIn or Website';
  if (value.status !== undefined && !STATUSES.includes(value.status)) return 'Status must be Draft, Active, Paused or Completed';
  return null;
}
function validateLead(value) {
  const error = textFields(value, ['campaignId', 'name', 'email', 'sourcePlatform', 'consentStatus'], ['phone']);
  if (error) return error;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) || value.email.length > 254) return 'A valid email address is required';
  if (!CHANNELS.includes(value.sourcePlatform)) return 'Source platform must be Facebook, Instagram, LinkedIn or Website';
  if (!CONSENT.includes(value.consentStatus)) return 'Consent status must be Recorded, Not Recorded or Unknown';
  return null;
}
module.exports = { CHANNELS, STATUSES, CONSENT, parseBudget, isoDate, validateCampaign, validateLead };
