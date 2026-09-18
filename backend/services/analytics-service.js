function createAnalyticsService(
  campaignRepository,
  leadRepository
) {
  function getSummary() {
    const campaigns = campaignRepository.getAll();
    const leads = leadRepository.getAll();

    const leadsByStage = {
      New: 0,
      Contacted: 0,
      Qualified: 0
    };

    const leadsBySource = {
      Facebook: 0,
      Instagram: 0,
      LinkedIn: 0,
      Website: 0
    };

    for (const lead of leads) {
      if (
        Object.prototype.hasOwnProperty.call(
          leadsByStage,
          lead.stage
        )
      ) {
        leadsByStage[lead.stage] += 1;
      }

      if (
        Object.prototype.hasOwnProperty.call(
          leadsBySource,
          lead.source_platform
        )
      ) {
        leadsBySource[lead.source_platform] += 1;
      }
    }

    return {
      totalCampaigns: campaigns.length,
      totalLeads: leads.length,
      leadsByStage,
      leadsBySource,
      activeCampaigns: campaigns.filter(campaign => campaign.status === 'Active').length,
      qualifiedLeads: leadsByStage.Qualified,
      qualificationRate: leads.length ? Math.round(leadsByStage.Qualified / leads.length * 10000) / 100 : null,
      definitions: {
        totalCampaigns: 'Count of stored campaign records, including all statuses.',
        activeCampaigns: 'Count of stored campaigns explicitly marked Active; dates do not automatically change status.',
        totalLeads: 'Count of stored lead records, not distinct customers or people.',
        qualifiedLeads: 'Count of lead records currently at the Qualified pipeline stage.',
        qualificationRate: 'Qualified lead records / all stored lead records x 100; null when there are no leads. This is not a customer conversion rate.',
        period: 'All currently stored records. No historical time-window or commercial performance claim.',
        thresholds: 'No business targets have been configured or approved.'
      }
    };
  }

  return {
    getSummary
  };
}

module.exports = {
  createAnalyticsService
};
