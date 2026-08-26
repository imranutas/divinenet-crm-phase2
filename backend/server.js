const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const campaigns = [
  {
    id: "CAM-001",
    campaignName: "Spring Awareness Test",
    prompt: "Create a simple awareness campaign for testing",
    startDate: "2026-08-15",
    endDate: "2026-08-31",
    channel: "Facebook",
    status: "Draft",
    client: "Testing Client",
    brand: "Divinenet Demo",
    objective: "Test campaign awareness",
    targetAudience: "Testing audience",
    budget: 1000
  }
];

let nextCampaignNumber = campaigns.length + 1;

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
      campaign[field] === ""
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
    (!Number.isFinite(Number(campaign.budget)) ||
      Number(campaign.budget) < 0)
  ) {
    return "Budget must be a number of zero or greater";
  }

  const allowedChannels = [
    "Facebook",
    "Instagram",
    "LinkedIn"
  ];

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

app.get("/api/health", (request, response) => {
  response.status(200).json({
    success: true,
    message: "Divinenet CRM API is running"
  });
});

app.get("/api/campaigns", (request, response) => {
  response.status(200).json({
    success: true,
    data: campaigns
  });
});

app.get("/api/campaigns/:id", (request, response) => {
  const campaign = campaigns.find(
    (item) => item.id === request.params.id
  );

  if (!campaign) {
    return response.status(404).json({
      success: false,
      message: "Campaign not found"
    });
  }

  response.status(200).json({
    success: true,
    data: campaign
  });
});

app.post("/api/campaigns", (request, response) => {
  const validationError = validateCampaign(request.body);

  if (validationError) {
    return response.status(400).json({
      success: false,
      message: validationError
    });
  }

  const newCampaign = {
    id: `CAM-${String(nextCampaignNumber++).padStart(3, "0")}`,
    campaignName: request.body.campaignName.trim(),
    prompt: request.body.prompt.trim(),
    startDate: request.body.startDate,
    endDate: request.body.endDate,
    channel: request.body.channel,
    status: request.body.status || "Draft",

    client: request.body.client?.trim() || "",
    brand: request.body.brand?.trim() || "",
    objective: request.body.objective?.trim() || "",
    targetAudience: request.body.targetAudience?.trim() || "",

    budget:
      request.body.budget === undefined ||
      request.body.budget === ""
        ? null
        : Number(request.body.budget)
  };

  campaigns.push(newCampaign);

  response.status(201).json({
    success: true,
    data: newCampaign
  });
});

app.put("/api/campaigns/:id", (request, response) => {
  const campaignIndex = campaigns.findIndex(
    (item) => item.id === request.params.id
  );

  if (campaignIndex === -1) {
    return response.status(404).json({
      success: false,
      message: "Campaign not found"
    });
  }

  const currentCampaign = campaigns[campaignIndex];

  const updatedCampaign = {
    id: currentCampaign.id,
    campaignName:
      request.body.campaignName ?? currentCampaign.campaignName,
    prompt:
      request.body.prompt ?? currentCampaign.prompt,
    startDate:
      request.body.startDate ?? currentCampaign.startDate,
    endDate:
      request.body.endDate ?? currentCampaign.endDate,
    channel:
      request.body.channel ?? currentCampaign.channel,
    status:
      request.body.status ?? currentCampaign.status,
    client:
      request.body.client ?? currentCampaign.client,
    brand:
      request.body.brand ?? currentCampaign.brand,
    objective:
      request.body.objective ?? currentCampaign.objective,
    targetAudience:
      request.body.targetAudience ?? currentCampaign.targetAudience,
    budget:
      request.body.budget !== undefined
        ? request.body.budget === ""
          ? null
          : Number(request.body.budget)
        : currentCampaign.budget
  };

  const validationError = validateCampaign(updatedCampaign);

  if (validationError) {
    return response.status(400).json({
      success: false,
      message: validationError
    });
  }

  campaigns[campaignIndex] = updatedCampaign;

  response.status(200).json({
    success: true,
    data: updatedCampaign
  });
});

app.delete("/api/campaigns/:id", (request, response) => {
  const campaignIndex = campaigns.findIndex(
    (item) => item.id === request.params.id
  );

  if (campaignIndex === -1) {
    return response.status(404).json({
      success: false,
      message: "Campaign not found"
    });
  }

  const deletedCampaign = campaigns.splice(campaignIndex, 1)[0];

  response.status(200).json({
    success: true,
    message: "Campaign deleted successfully",
    data: deletedCampaign
  });
});

app.use((request, response) => {
  response.status(404).json({
    success: false,
    message: "Route not found"
  });
});

app.listen(PORT, () => {
  console.log(`Divinenet CRM API running at http://localhost:${PORT}`);
});
