const testCustomers = [
  {
    id: "CUS-001",
    name: "Test Customer One",
    email: "customer1@test.com",
    company: "Test Business"
  },
  {
    id: "CUS-002",
    name: "Test Customer Two",
    email: "customer2@test.com",
    company: "Test Company"
  }
];

const testStaff = [
  {
    id: "STF-001",
    name: "Test Staff One",
    email: "staff1@test.com",
    role: "Marketing Manager"
  },
  {
    id: "STF-002",
    name: "Test Staff Two",
    email: "staff2@test.com",
    role: "Campaign Manager"
  }
];

const testLeads = [
  {
    id: "LEAD-001",
    name: "Test Lead One",
    email: "lead1@test.com",
    source: "Facebook",
    status: "New",
    score: 75
  },
  {
    id: "LEAD-002",
    name: "Test Lead Two",
    email: "lead2@test.com",
    source: "Instagram",
    status: "Contacted",
    score: 60
  }
];

module.exports = {
  testCustomers,
  testStaff,
  testLeads
};
