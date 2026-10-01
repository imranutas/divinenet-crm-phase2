const BUSINESS_TIME_ZONE = 'Australia/Sydney';

function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function automaticCampaignStatus(campaign, now = new Date()) {
  const today = businessDate(now);

  // A manually paused campaign must remain paused.
  if (campaign.status === 'Paused') return 'Paused';

  // Do not automatically alter unrelated/final states.
  if (!['Draft', 'Active'].includes(campaign.status)) {
    return campaign.status;
  }

  // End date is inclusive. Complete from the following business day.
  if (campaign.end_date && today > campaign.end_date) {
    return 'Completed';
  }

  // Draft becomes Active when its start date arrives.
  if (
    campaign.status === 'Draft' &&
    campaign.start_date &&
    today >= campaign.start_date
  ) {
    return 'Active';
  }

  return campaign.status;
}

function reconcileCampaignStatuses(db, now = new Date()) {
  const rows = db.prepare(
    "SELECT id,start_date,end_date,status FROM campaigns WHERE status IN ('Draft','Active','Paused')"
  ).all();

  const update = db.prepare(
    'UPDATE campaigns SET status=?, updated_at=? WHERE id=?'
  );

  let changed = 0;

  const transaction = db.transaction(() => {
    for (const campaign of rows) {
      const nextStatus = automaticCampaignStatus(campaign, now);

      if (nextStatus !== campaign.status) {
        update.run(nextStatus, now.toISOString(), campaign.id);
        changed += 1;
      }
    }
  });

  transaction();
  return changed;
}

module.exports = {
  BUSINESS_TIME_ZONE,
  businessDate,
  automaticCampaignStatus,
  reconcileCampaignStatuses
};
