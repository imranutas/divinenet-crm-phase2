const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalyticsService } = require('../services/analytics-service');
test('operational counts and qualification rate use real record counts and explicit definitions', () => {
  const campaigns = { getAll: () => [{ status: 'Active' }, { status: 'Draft' }] };
  const leads = { getAll: () => [{ stage: 'Qualified', source_platform: 'Website' }, { stage: 'New', source_platform: 'Website' }, { stage: 'Contacted', source_platform: 'LinkedIn' }] };
  const result = createAnalyticsService(campaigns, leads).getSummary();
  assert.equal(result.activeCampaigns, 1);
  assert.equal(result.qualifiedLeads, 1);
  assert.equal(result.qualificationRate, 33.33);
  assert.match(result.definitions.qualificationRate, /not a customer conversion/);
  assert.match(result.definitions.thresholds, /No business targets/);
});
test('empty dataset has zero counts but no invented qualification percentage', () => {
  const empty = { getAll: () => [] };
  const result = createAnalyticsService(empty, empty).getSummary();
  assert.equal(result.totalCampaigns, 0);
  assert.equal(result.totalLeads, 0);
  assert.equal(result.qualificationRate, null);
});
