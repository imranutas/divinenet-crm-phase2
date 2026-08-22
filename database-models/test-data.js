const testCustomers = [
  {
    customerId: "CUS-001",
    customerName: "Testing Customer",
    brandName: "Testing Brand",
    dataStatus: "Testing"
  }
];

const testStaff = [
  {
    staffId: "STF-001",
    staffName: "Testing Marketing User",
    role: "Marketing Coordinator",
    dataStatus: "Testing"
  }
];

const testLeads = [
  {
    id: "LEAD-001",
    name: "Facebook Testing Lead",
    email: "facebook.testing@example.com",
    phone: null,
    campaignId: "CAM-001",
    sourcePlatform: "Facebook",
    consentStatus: "Recorded",
    queueStatus: "Pending",
    createdAt: new Date().toISOString(),
    retrievedAt: null
  },
  {
    id: "LEAD-002",
    name: "Instagram Testing Lead",
    email: "instagram.testing@example.com",
    phone: null,
    campaignId: "CAM-001",
    sourcePlatform: "Instagram",
    consentStatus: "Recorded",
    queueStatus: "Pending",
    createdAt: new Date().toISOString(),
    retrievedAt: null
  },
  {
    id: "LEAD-003",
    name: "LinkedIn Testing Lead",
    email: "linkedin.testing@example.com",
    phone: null,
    campaignId: "CAM-001",
    sourcePlatform: "LinkedIn",
    consentStatus: "Recorded",
    queueStatus: "Pending",
    createdAt: new Date().toISOString(),
    retrievedAt: null
  }
];

module.exports = {
  testCustomers,
  testStaff,
  testLeads
};
