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
      leadsBySource
    };
  }

  return {
    getSummary
  };
}

module.exports = {
  createAnalyticsService
};
