const {
  campaignModel,
  leadModel,
  kpiResultModel
} = require("../database-models/models");

const {
  generateCampaignContent
} = require("./claude-mock");

const {
  simulateMetaPublish
} = require("./meta-mock");

const {
  getPhase1Customers,
  getPhase1Staff
} = require("./phase1-mock");

console.log("DATABASE MODEL DEFINITIONS");
console.log({
  campaignModel,
  leadModel,
  kpiResultModel
});

console.log("\nCLAUDE TEST");
console.log(
  generateCampaignContent("Autumn Lead Test Campaign")
);

console.log("\nMETA TEST");
console.log(
  simulateMetaPublish(
    "Facebook",
    "Test campaign content"
  )
);

console.log("\nPHASE 1 CUSTOMER TEST");
console.log(getPhase1Customers());

console.log("\nPHASE 1 STAFF TEST");
console.log(getPhase1Staff());
