const testCustomers = [
  {
    customerId: "CUS-001",
    customerName: "Harbour Cafe Test",
    brandName: "Harbour Test",
    dataStatus: "Test"
  }
];

const testStaff = [
  {
    staffId: "STF-001",
    staffName: "Test Marketing User",
    role: "Marketing Coordinator",
    dataStatus: "Test"
  }
];

const testLeads = [
  {
    leadId: "LEAD-001",
    campaignId: "CAM-001",
    firstName: "Test",
    lastName: "Customer",
    email: "test@example.invalid",
    phone: "",
    sourcePlatform: "Facebook",
    consentStatus: "Recorded",
    leadStatus: "New",
    dataStatus: "Test"
  }
];

module.exports = {
  testCustomers,
  testStaff,
  testLeads
};
