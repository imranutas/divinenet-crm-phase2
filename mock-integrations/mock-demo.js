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
  retrievePendingLead
} = require("./phase1-mock");

console.log("AI TEST");
console.log(
  generateCampaignContent("August Testing Campaign")
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

console.log("\nPHASE 1 LEAD RETRIEVAL TEST");
console.log(
  retrievePendingLead()
);
