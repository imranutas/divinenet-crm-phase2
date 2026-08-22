const {
  campaignModel,
  leadModel,
  kpiModel
} = require("../database-models/models");

const {
  generateCampaignContent
} = require("./claude-mock");

const {
  simulateMetaPublish
} = require("./meta-mock");

const {
  simulateLinkedInPublish
} = require("./linkedin-mock");

const {
  getPhase1Customers,
  getPhase1Staff,
  retrievePendingLeads
} = require("./phase1-mock");

const {
  getLiveIntegrationStatus
} = require("./live-adapter");

console.log("DATABASE MODEL DEFINITIONS");
console.log({
  campaignModel,
  leadModel,
  kpiModel
});

console.log("\nAI TEST");
console.log(
  generateCampaignContent("LinkedIn Testing Campaign")
);

console.log("\nFACEBOOK TEST");
console.log(
  simulateMetaPublish(
    "Facebook",
    "Facebook testing campaign content"
  )
);

console.log("\nINSTAGRAM TEST");
console.log(
  simulateMetaPublish(
    "Instagram",
    "Instagram testing campaign content"
  )
);

console.log("\nLINKEDIN TEST");
console.log(
  simulateLinkedInPublish(
    "LinkedIn testing campaign content"
  )
);

console.log("\nPHASE 1 CUSTOMER TEST");
console.log(getPhase1Customers());

console.log("\nPHASE 1 STAFF TEST");
console.log(getPhase1Staff());

console.log("\nPHASE 1 PENDING LEAD RETRIEVAL TEST");
console.log(retrievePendingLeads());

console.log("\nLIVE INTEGRATION STATUS");
console.log(getLiveIntegrationStatus());
