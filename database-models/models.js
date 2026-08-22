const campaignModel = {
  id: "",
  campaignName: "",
  client: "",
  brand: "",
  prompt: "",
  objective: "",
  targetAudience: "",
  startDate: "",
  endDate: "",
  budget: 0,
  channel: "",
  status: "Draft"
};

const campaignChannels = [
  "Facebook",
  "Instagram",
  "LinkedIn"
];

const leadModel = {
  id: "",
  name: "",
  email: "",
  phone: null,
  campaignId: "",
  sourcePlatform: "",
  consentStatus: "",
  queueStatus: "Pending",
  createdAt: new Date().toISOString(),
  retrievedAt: null
};

const leadRequiredFields = [
  "name",
  "email",
  "campaignId",
  "sourcePlatform",
  "consentStatus"
];

const leadQueueStatuses = [
  "Pending",
  "Retrieved"
];

const kpiModel = {
  id: "",
  campaignId: "",
  platform: "",
  impressions: 0,
  clicks: 0,
  leads: 0,
  spend: 0
};

module.exports = {
  campaignModel,
  campaignChannels,
  leadModel,
  leadRequiredFields,
  leadQueueStatuses,
  kpiModel
};
