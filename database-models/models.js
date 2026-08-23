const campaignModel = {
  id: "",
  campaignName: "",
  prompt: "",
  startDate: "",
  endDate: "",
  channel: "",
  status: "Draft",
  client: "",
  brand: "",
  objective: "",
  targetAudience: "",
  budget: null
};

const leadModel = {
  id: "",
  name: "",
  email: "",
  phone: "",
  campaignId: "",
  sourcePlatform: "",
  consentStatus: "",
  queueStatus: "Pending",
  createdAt: new Date().toISOString(),
  retrievedAt: null
};

const kpiModel = {
  id: "",
  campaignId: "",
  platform: "",
  impressions: 0,
  clicks: 0,
  conversions: 0
};

const platformOptions = [
  "Facebook",
  "Instagram",
  "LinkedIn"
];

const leadQueueStatuses = [
  "Pending",
  "Retrieved"
];

module.exports = {
  campaignModel,
  leadModel,
  kpiModel,
  platformOptions,
  leadQueueStatuses
};
