function getLiveIntegrationStatus() {
  return {
    enabled: false,
    message: "Live integration is disabled until approved credentials are provided."
  };
}

module.exports = {
  getLiveIntegrationStatus
};
