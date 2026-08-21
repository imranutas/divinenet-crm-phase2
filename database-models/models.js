const campaignModel = {
  id: "string",
  campaignName: "string",
  client: "string",
  brand: "string",
  objective: "string",
  targetAudience: "string",
  startDate: "date",
  endDate: "date",
  budget: "number",
  channel: "Facebook or Instagram",
  status: "Draft, Active, Paused or Completed",
  createdAt: "date-time",
  updatedAt: "date-time"
};

const leadModel = {
  id: "string",
  campaignId: "string",
  firstName: "string",
  lastName: "string",
  email: "string",
  phone: "string or empty",
  sourcePlatform: "Facebook or Instagram",
  consentStatus: "Recorded, Not Recorded or Unknown",
  leadStatus: "provisional workflow value",
  createdAt: "date-time",
  updatedAt: "date-time"
};

const kpiResultModel = {
  id: "string",
  campaignId: "string",
  reach: "number",
  impressions: "number",
  clicks: "number",
  leads: "number",
  qualifiedLeads: "number",
  conversions: "number",
  reportingPeriodStart: "date",
  reportingPeriodEnd: "date",
  dataStatus: "Test or Confirmed"
};

module.exports = {
  campaignModel,
  leadModel,
  kpiResultModel
};
