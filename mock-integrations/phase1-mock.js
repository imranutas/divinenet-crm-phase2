const {
  testCustomers,
  testStaff
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

module.exports = {
  getPhase1Customers,
  getPhase1Staff
};
