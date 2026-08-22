const {
  testCustomers,
  testStaff,
  testLeads
} = require("../database-models/test-data");

function getPhase1Customers() {
  return {
    testMode: true,
    source: "Phase 1 CRM",
    liveAccessUsed: false,
    data: testCustomers
  };
}

function getPhase1Staff() {
  return {
    testMode: true,
    source: "Phase 1 CRM",
    liveAccessUsed: false,
    data: testStaff
  };
}

function retrievePendingLeads() {
  const pendingLeads = testLeads.filter(
    (lead) => lead.queueStatus === "Pending"
  );

  const retrievedLeads = pendingLeads.map((lead) => {
    lead.queueStatus = "Retrieved";
    lead.retrievedAt = new Date().toISOString();
    return lead;
  });

  return {
    testMode: true,
    source: "Phase 1 CRM",
    liveAccessUsed: false,
    data: retrievedLeads
  };
}

module.exports = {
  getPhase1Customers,
  getPhase1Staff,
  retrievePendingLeads
};
