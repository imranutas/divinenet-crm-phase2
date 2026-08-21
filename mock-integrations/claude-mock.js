function generateCampaignContent(campaignName) {
  return {
    testMode: true,
    provider: "Claude AI",
    campaignName,
    suggestedText:
      "Test promotional content for demonstration purposes only.",
    liveAccessUsed: false
  };
}

module.exports = {
  generateCampaignContent
};
