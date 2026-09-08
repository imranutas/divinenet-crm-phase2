const express = require("express");
const cors = require("cors");

const { createDatabase } = require("./db/connection");
const { runMigrations } = require("./db/migrate");
const {
  createCampaignRepository
} = require("./repositories/campaignRepository");

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const db = createDatabase();
runMigrations(db);

const campaignRepository = createCampaignRepository(db);

app.use(cors());
app.use(express.json());

function toApiCampaign(row) {
  if (!row) return null;

  return {
    id: row.id,
    campaignName: row.campaign_name,
    prompt: row.prompt,
    client: row.client,
    brand: row.brand,
    objective: row.objective,
    targetAudience: row.target_audience,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: row.budget,
    channel: row.channel,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateCampaign(campaign) {
  const requiredFields = [
    "campaignName",
    "prompt",
    "startDate",
    "endDate",
    "channel"
  ];

  for (const field of requiredFields) {
    if (
      campaign[field] === undefined ||
      campaign[field] === null ||
      String(campaign[field]).trim() === ""
    ) {
      return `${field} is required`;
    }
  }

  if (new Date(campaign.endDate) < new Date(campaign.startDate)) {
    return "End date cannot be before start date";
  }

  if (
    campaign.budget !== undefined &&
    campaign.budget !== null &&
    campaign.budget !== "" &&
    Number(campaign.budget) < 0
  ) {
    return "Budget must be zero or greater";
  }

  const allowedChannels = ["Facebook", "Instagram", "LinkedIn"];

  if (!allowedChannels.includes(campaign.channel)) {
    return "Channel must be Facebook, Instagram or LinkedIn";
  }

  const allowedStatuses = [
    "Draft",
    "Active",
    "Paused",
    "Completed"
  ];

  if (
    campaign.status &&
    !allowedStatuses.includes(campaign.status)
  ) {
    return "Status must be Draft, Active, Paused or Completed";
  }

  return null;
}

function generateCampaignId() {
  const campaigns = campaignRepository.getAll();

  const numbers = campaigns
    .map((campaign) =>
      Number(String(campaign.id).replace("CAM-", ""))
    )
    .filter((number) => Number.isFinite(number));

  const nextNumber =
    numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

  return `CAM-${String(nextNumber).padStart(3, "0")}`;
}

// Health
app.get("/api/health", (request, response) => {
  response.status(200).json({
    success: true,
    message: "Divinenet CRM API is running"
  });
});

// Get all campaigns
app.get("/api/campaigns", (request, response) => {
  const campaigns = campaignRepository
    .getAll()
    .map(toApiCampaign);

  response.status(200).json({
    success: true,
    data: campaigns
  });
});

// Get one campaign
app.get("/api/campaigns/:id", (request, response) => {
  const campaign = campaignRepository.getById(
    request.params.id
  );

  if (!campaign) {
    return response.status(404).json({
      success: false,
      message: "Campaign not found"
    });
  }

  response.status(200).json({
    success: true,
    data: toApiCampaign(campaign)
  });
});

// Create campaign
app.post("/api/campaigns", (request, response) => {
  const validationError = validateCampaign(request.body);

  if (validationError) {
    return response.status(400).json({
      success: false,
      message: validationError
    });
  }

  const now = new Date().toISOString();

  const newCampaign = {
    id: generateCampaignId(),
    campaignName: request.body.campaignName,
    prompt: request.body.prompt,
    client: request.body.client || "",
    brand: request.body.brand || "",
    objective: request.body.objective || "",
    targetAudience: request.body.targetAudience || "",
    startDate: request.body.startDate,
    endDate: request.body.endDate,
    budget:
      request.body.budget === undefined ||
      request.body.budget === ""
        ? null
        : Number(request.body.budget),
    channel: request.body.channel,
    status: request.body.status || "Draft",
    createdAt: now,
    updatedAt: now
  };

  const savedCampaign =
    campaignRepository.create(newCampaign);

  response.status(201).json({
    success: true,
    data: toApiCampaign(savedCampaign)
  });
});

// Update campaign
app.put("/api/campaigns/:id", (request, response) => {
  const existing = campaignRepository.getById(
    request.params.id
  );

  if (!existing) {
    return response.status(404).json({
      success: false,
      message: "Campaign not found"
    });
  }

  const current = toApiCampaign(existing);

  const updatedCampaign = {
    ...current,
    ...request.body,
    id: current.id,
    updatedAt: new Date().toISOString()
  };

  const validationError =
    validateCampaign(updatedCampaign);

  if (validationError) {
    return response.status(400).json({
      success: false,
      message: validationError
    });
  }

  if (
    updatedCampaign.budget !== null &&
    updatedCampaign.budget !== ""
  ) {
    updatedCampaign.budget =
      Number(updatedCampaign.budget);
  }

  const savedCampaign = campaignRepository.update(
    request.params.id,
    updatedCampaign
  );

  response.status(200).json({
    success: true,
    data: toApiCampaign(savedCampaign)
  });
});

// Delete campaign
app.delete("/api/campaigns/:id", (request, response) => {
  const deleted = campaignRepository.remove(
    request.params.id
  );

  if (!deleted) {
    return response.status(404).json({
      success: false,
      message: "Campaign not found"
    });
  }

  response.status(200).json({
    success: true,
    message: "Campaign deleted successfully"
  });
});

// Unknown route
app.use((request, response) => {
  response.status(404).json({
    success: false,
    message: "Route not found"
  });
});

app.listen(PORT, () => {
  console.log(
    `Divinenet CRM API running at http://localhost:${PORT}`
  );
});