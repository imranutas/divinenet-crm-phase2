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

function retrievePendingLead() {
  const pendingLead = testLeads.find(
    (lead) => lead.queueStatus === "Pending"
  );

  if (!pendingLead) {
    return {
      testMode: true,
      success: false,
      message: "No pending leads available"
    };
  }

  pendingLead.queueStatus = "Retrieved";
  pendingLead.retrievedAt = new Date().toISOString();

  return {
    testMode: true,
    success: true,
    source: "Phase 1 CRM",
    liveAccessUsed: false,
    data: pendingLead
  };
}

module.exports = {
  getPhase1Customers,
  getPhase1Staff,
  retrievePendingLead
};
