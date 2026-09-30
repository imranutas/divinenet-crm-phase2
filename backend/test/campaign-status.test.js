const test = require('node:test');
const assert = require('node:assert/strict');
const { automaticCampaignStatus } = require('../services/campaign-status');

function campaign(changes = {}) {
  return {
    status: 'Draft',
    start_date: '2026-09-26',
    end_date: '2026-09-30',
    ...changes
  };
}

test('Draft stays Draft before start date', () => {
  assert.equal(
    automaticCampaignStatus(campaign(), new Date('2026-09-25T02:00:00Z')),
    'Draft'
  );
});

test('Draft becomes Active on start date', () => {
  assert.equal(
    automaticCampaignStatus(campaign(), new Date('2026-09-26T02:00:00Z')),
    'Active'
  );
});

test('Active remains Active on inclusive end date', () => {
  assert.equal(
    automaticCampaignStatus(
      campaign({ status: 'Active' }),
      new Date('2026-09-30T02:00:00Z')
    ),
    'Active'
  );
});

test('Active becomes Completed after end date', () => {
  assert.equal(
    automaticCampaignStatus(
      campaign({ status: 'Active' }),
      new Date('2026-10-01T02:00:00Z')
    ),
    'Completed'
  );
});

test('Paused campaign remains Paused', () => {
  assert.equal(
    automaticCampaignStatus(
      campaign({ status: 'Paused' }),
      new Date('2026-10-01T02:00:00Z')
    ),
    'Paused'
  );
});
