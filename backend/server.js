const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const campaigns = [
  {
    id: "CAM-001",
    campaignName: "Spring Awareness Demo",
    client: "Fictional Client",
    brand: "Divinenet Demo",
    objective: "Increase fictional brand awareness",
    targetAudience: "Fictional small-business owners",
    startDate: "2026-08-15",
    endDate: "2026-08-31",
    budget: 1000,
    channel: "Facebook",
    status: "Draft"
  }
];
let nextCampaignNumber = campaigns.length + 1;
function validateCampaign(campaign) {
  const requiredFields = [
    "campaignName",
    "client",
    "brand",
    "objective",
    "targetAudience",
    "startDate",
    "endDate",
    "budget",
    "channel",
    "status"
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

  if (Number(campaign.budget) < 0) {
    return "Budget must be zero or greater";
  }

  const allowedChannels = ["Facebook", "Instagram"];
  if (!allowedChannels.includes(campaign.channel)) {
    return "Channel must be Facebook or Instagram";
  }

  const allowedStatuses = ["Draft", "Active", "Paused", "Completed"];
  if (!allowedStatuses.includes(campaign.status)) {
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
    campaignName: request.body.campaignName,
    client: request.body.client,
    brand: request.body.brand,
    objective: request.body.objective,
    targetAudience: request.body.targetAudience,
    startDate: request.body.startDate,
    endDate: request.body.endDate,
    budget: Number(request.body.budget),
    channel: request.body.channel,
    status: request.body.status
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
    client: request.body.client ?? currentCampaign.client,
    brand: request.body.brand ?? currentCampaign.brand,
    objective: request.body.objective ?? currentCampaign.objective,
    targetAudience:
      request.body.targetAudience ?? currentCampaign.targetAudience,
    startDate: request.body.startDate ?? currentCampaign.startDate,
    endDate: request.body.endDate ?? currentCampaign.endDate,
    budget:
      request.body.budget !== undefined
        ? Number(request.body.budget)
        : currentCampaign.budget,
    channel: request.body.channel ?? currentCampaign.channel,
    status: request.body.status ?? currentCampaign.status
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
