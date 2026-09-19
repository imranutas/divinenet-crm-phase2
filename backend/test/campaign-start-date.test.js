const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCampaign } = require('../validation');

const NOW = new Date('2026-09-19T02:00:00Z');
const PAST_DATE_ERROR = 'Start date cannot be before today.';

function campaign(changes = {}) {
  return {
    campaignName: 'Date validation test',
    prompt: 'Synthetic campaign for automated testing',
    startDate: '2026-09-19',
    endDate: '2026-09-25',
    channel: 'Website',
    status: 'Draft',
    budget: 100,
    ...changes
  };
}

function validate(changes = {}, options = {}) {
  return validateCampaign(campaign(changes), {
    now: NOW,
    ...options
  });
}

test('new campaign rejects yesterday', () => {
  assert.equal(
    validate({ startDate: '2026-09-18' }),
    PAST_DATE_ERROR
  );
});

test('new campaign accepts today', () => {
  assert.equal(validate(), null);
});

test('new campaign accepts a future start date', () => {
  assert.equal(
    validate({ startDate: '2026-09-20' }),
    null
  );
});

test('end date cannot precede start date', () => {
  assert.equal(
    validate({ endDate: '2026-09-18' }),
    'End date cannot be before start date'
  );
});

test('invalid calendar date is rejected', () => {
  assert.equal(
    validate({ startDate: '2026-02-30' }),
    'Start date and end date must be valid dates'
  );
});

test('missing start date is rejected', () => {
  assert.equal(
    validate({ startDate: '' }),
    'startDate is required'
  );
});

test('existing campaign may retain its historical dates', () => {
  assert.equal(
    validate(
      {
        campaignName: 'Updated campaign name',
        startDate: '2026-09-01',
        endDate: '2026-09-10'
      },
      { existingStartDate: '2026-09-01' }
    ),
    null
  );
});

test('existing campaign cannot change to a different past date', () => {
  assert.equal(
    validate(
      { startDate: '2026-09-02' },
      { existingStartDate: '2026-09-01' }
    ),
    PAST_DATE_ERROR
  );
});

test('request data cannot grant a historical-date exemption', () => {
  assert.equal(
    validate({
      startDate: '2026-09-01',
      existingStartDate: '2026-09-01'
    }),
    PAST_DATE_ERROR
  );
});

test('Sydney midnight changes the allowed business date', () => {
  const record = campaign({ startDate: '2026-09-19' });

  assert.equal(
    validateCampaign(record, {
      now: new Date('2026-09-19T13:59:59Z')
    }),
    null
  );

  assert.equal(
    validateCampaign(record, {
      now: new Date('2026-09-19T14:00:00Z')
    }),
    PAST_DATE_ERROR
  );
});

test('Sydney daylight-saving offset is respected', () => {
  const record = campaign({
    startDate: '2026-12-01',
    endDate: '2026-12-10'
  });

  assert.equal(
    validateCampaign(record, {
      now: new Date('2026-12-01T12:59:59Z')
    }),
    null
  );

  assert.equal(
    validateCampaign(record, {
      now: new Date('2026-12-01T13:00:00Z')
    }),
    PAST_DATE_ERROR
  );
});
