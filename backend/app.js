const express = require("express");
const cors = require("cors");

const { createDatabase } = require("./db/connection");
const { runMigrations } = require("./db/migrate");

const {
  createCampaignRepository
} = require("./repositories/campaignRepository");

const {
  createLeadRepository
} = require("./repositories/leadRepository");

const {
  validateStageTransition
} = require("./services/lead-pipeline");

const {
  createAnalyticsService
} = require("./services/analytics-service");

function createApp(options = {}) {
  const app = express();

  const db =
    options.db || createDatabase();

  runMigrations(db);

  const campaignRepository =
    createCampaignRepository(db);

  const leadRepository =
    createLeadRepository(db);

  const analyticsService =
    createAnalyticsService(
      campaignRepository,
      leadRepository
    );

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

  function toApiLead(row) {
    if (!row) return null;

    return {
      id: row.id,
      campaignId: row.campaign_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      sourcePlatform: row.source_platform,
      consentStatus: row.consent_status,
      stage: row.stage,
      score: row.score,
      scorePolicyVersion:
        row.score_policy_version,
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

    const startDate =
      new Date(campaign.startDate);

    const endDate =
      new Date(campaign.endDate);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return "Start date and end date must be valid dates";
    }

    if (endDate < startDate) {
      return "End date cannot be before start date";
    }

    if (
      campaign.budget !== undefined &&
      campaign.budget !== null &&
      campaign.budget !== ""
    ) {
      const budget =
        Number(campaign.budget);

      if (
        !Number.isFinite(budget) ||
        budget < 0
      ) {
        return "Budget must be a non-negative number";
      }
    }

    const allowedChannels = [
      "Facebook",
      "Instagram",
      "LinkedIn",
      "Website"
    ];

    if (
      !allowedChannels.includes(
        campaign.channel
      )
    ) {
      return "Channel must be Facebook, Instagram, LinkedIn or Website";
    }

    const allowedStatuses = [
      "Draft",
      "Active",
      "Paused",
      "Completed"
    ];

    if (
      campaign.status &&
      !allowedStatuses.includes(
        campaign.status
      )
    ) {
      return "Status must be Draft, Active, Paused or Completed";
    }

    return null;
  }

  function validateLead(lead) {
    const requiredFields = [
      "campaignId",
      "name",
      "email",
      "sourcePlatform",
      "consentStatus"
    ];

    for (const field of requiredFields) {
      if (
        lead[field] === undefined ||
        lead[field] === null ||
        String(lead[field]).trim() === ""
      ) {
        return `${field} is required`;
      }
    }

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !emailPattern.test(
        String(lead.email).trim()
      )
    ) {
      return "A valid email address is required";
    }

    const allowedPlatforms = [
      "Facebook",
      "Instagram",
      "LinkedIn",
      "Website"
    ];

    if (
      !allowedPlatforms.includes(
        lead.sourcePlatform
      )
    ) {
      return "Source platform must be Facebook, Instagram, LinkedIn or Website";
    }

    const allowedConsentStatuses = [
      "Recorded",
      "Not Recorded",
      "Unknown"
    ];

    if (
      !allowedConsentStatuses.includes(
        lead.consentStatus
      )
    ) {
      return "Consent status must be Recorded, Not Recorded or Unknown";
    }

    return null;
  }

  function generateCampaignId() {
    const campaigns =
      campaignRepository.getAll();

    const numbers = campaigns
      .map((campaign) =>
        Number(
          String(campaign.id).replace(
            "CAM-",
            ""
          )
        )
      )
      .filter((number) =>
        Number.isFinite(number)
      );

    const nextNumber =
      numbers.length > 0
        ? Math.max(...numbers) + 1
        : 1;

    return `CAM-${String(
      nextNumber
    ).padStart(3, "0")}`;
  }

  function generateLeadId() {
    const leads =
      leadRepository.getAll();

    const numbers = leads
      .map((lead) =>
        Number(
          String(lead.id).replace(
            "LEAD-",
            ""
          )
        )
      )
      .filter((number) =>
        Number.isFinite(number)
      );

    const nextNumber =
      numbers.length > 0
        ? Math.max(...numbers) + 1
        : 1;

    return `LEAD-${String(
      nextNumber
    ).padStart(3, "0")}`;
  }

  // HEALTH
  app.get(
    "/api/health",
    (request, response) => {
      response.status(200).json({
        success: true,
        message:
          "Divinenet CRM API is running"
      });
    }
  );

  // GET ALL CAMPAIGNS
  app.get(
    "/api/campaigns",
    (request, response) => {
      const campaigns =
        campaignRepository
          .getAll()
          .map(toApiCampaign);

      response.status(200).json({
        success: true,
        data: campaigns
      });
    }
  );

  // GET CAMPAIGN
  app.get(
    "/api/campaigns/:id",
    (request, response) => {
      const campaign =
        campaignRepository.getById(
          request.params.id
        );

      if (!campaign) {
        return response
          .status(404)
          .json({
            success: false,
            message:
              "Campaign not found"
          });
      }

      response.status(200).json({
        success: true,
        data: toApiCampaign(campaign)
      });
    }
  );

  // CREATE CAMPAIGN
  app.post(
    "/api/campaigns",
    (request, response) => {
      const validationError =
        validateCampaign(request.body);

      if (validationError) {
        return response
          .status(400)
          .json({
            success: false,
            message: validationError
          });
      }

      const now =
        new Date().toISOString();

      const newCampaign = {
        id: generateCampaignId(),

        campaignName:
          String(
            request.body.campaignName
          ).trim(),

        prompt:
          String(
            request.body.prompt
          ).trim(),

        client:
          request.body.client
            ? String(
                request.body.client
              ).trim()
            : "",

        brand:
          request.body.brand
            ? String(
                request.body.brand
              ).trim()
            : "",

        objective:
          request.body.objective
            ? String(
                request.body.objective
              ).trim()
            : "",

        targetAudience:
          request.body.targetAudience
            ? String(
                request.body.targetAudience
              ).trim()
            : "",

        startDate:
          request.body.startDate,

        endDate:
          request.body.endDate,

        budget:
          request.body.budget ===
            undefined ||
          request.body.budget === null ||
          request.body.budget === ""
            ? null
            : Number(
                request.body.budget
              ),

        channel:
          request.body.channel,

        status:
          request.body.status ||
          "Draft",

        createdAt: now,
        updatedAt: now
      };

      const savedCampaign =
        campaignRepository.create(
          newCampaign
        );

      response.status(201).json({
        success: true,
        data:
          toApiCampaign(
            savedCampaign
          )
      });
    }
  );

  // UPDATE CAMPAIGN
  app.put(
    "/api/campaigns/:id",
    (request, response) => {
      const existing =
        campaignRepository.getById(
          request.params.id
        );

      if (!existing) {
        return response
          .status(404)
          .json({
            success: false,
            message:
              "Campaign not found"
          });
      }

      const current =
        toApiCampaign(existing);

      const updatedCampaign = {
        ...current,
        ...request.body,
        id: current.id,
        updatedAt:
          new Date().toISOString()
      };

      const validationError =
        validateCampaign(
          updatedCampaign
        );

      if (validationError) {
        return response
          .status(400)
          .json({
            success: false,
            message: validationError
          });
      }

      if (
        updatedCampaign.budget !==
          null &&
        updatedCampaign.budget !== ""
      ) {
        updatedCampaign.budget =
          Number(
            updatedCampaign.budget
          );
      }

      const savedCampaign =
        campaignRepository.update(
          request.params.id,
          updatedCampaign
        );

      response.status(200).json({
        success: true,
        data:
          toApiCampaign(
            savedCampaign
          )
      });
    }
  );

  // DELETE CAMPAIGN
  app.delete(
    "/api/campaigns/:id",
    (request, response) => {
      const campaign =
        campaignRepository.getById(
          request.params.id
        );

      if (!campaign) {
        return response
          .status(404)
          .json({
            success: false,
            message:
              "Campaign not found"
          });
      }

      const linkedLeadCount =
        leadRepository.countByCampaignId(
          request.params.id
        );

      if (linkedLeadCount > 0) {
        return response
          .status(409)
          .json({
            success: false,
            message:
              "Campaign cannot be deleted while leads are linked to it"
          });
      }

      campaignRepository.remove(
        request.params.id
      );

      response.status(200).json({
        success: true,
        message:
          "Campaign deleted successfully"
      });
    }
  );

  // GET ALL LEADS
  app.get(
    "/api/leads",
    (request, response) => {
      const campaignId =
        request.query.campaignId ||
        null;

      const leads =
        leadRepository
          .getAll(campaignId)
          .map(toApiLead);

      response.status(200).json({
        success: true,
        data: leads
      });
    }
  );

  // GET LEAD
  app.get(
    "/api/leads/:id",
    (request, response) => {
      const lead =
        leadRepository.getById(
          request.params.id
        );

      if (!lead) {
        return response
          .status(404)
          .json({
            success: false,
            message:
              "Lead not found"
          });
      }

      response.status(200).json({
        success: true,
        data: toApiLead(lead)
      });
    }
  );

  // CREATE LEAD
  app.post(
    "/api/leads",
    (request, response) => {
      const validationError =
        validateLead(request.body);

      if (validationError) {
        return response
          .status(400)
          .json({
            success: false,
            message: validationError
          });
      }

      const campaign =
        campaignRepository.getById(
          request.body.campaignId
        );

      if (!campaign) {
        return response
          .status(400)
          .json({
            success: false,
            message:
              "campaignId must reference an existing campaign"
          });
      }

      const now =
        new Date().toISOString();

      const newLead = {
        id: generateLeadId(),

        campaignId:
          request.body.campaignId,

        name:
          String(
            request.body.name
          ).trim(),

        email:
          String(
            request.body.email
          )
            .trim()
            .toLowerCase(),

        phone:
          request.body.phone
            ? String(
                request.body.phone
              ).trim()
            : "",

        sourcePlatform:
          request.body.sourcePlatform,

        consentStatus:
          request.body.consentStatus,

        stage: "New",
        score: null,
        scorePolicyVersion: null,
        createdAt: now,
        updatedAt: now
      };

      const savedLead =
        leadRepository.create(
          newLead
        );

      response.status(201).json({
        success: true,
        data: toApiLead(savedLead)
      });
    }
  );

  // UPDATE LEAD
  app.put(
    "/api/leads/:id",
    (request, response) => {
      const existing =
        leadRepository.getById(
          request.params.id
        );

      if (!existing) {
        return response
          .status(404)
          .json({
            success: false,
            message:
              "Lead not found"
          });
      }

      const current =
        toApiLead(existing);

      const updatedLead = {
        ...current,
        ...request.body,

        id: current.id,

        // Server-owned fields
        stage: current.stage,
        score: current.score,
        scorePolicyVersion:
          current.scorePolicyVersion,

        updatedAt:
          new Date().toISOString()
      };

      const validationError =
        validateLead(updatedLead);

      if (validationError) {
        return response
          .status(400)
          .json({
            success: false,
            message: validationError
          });
      }

      const campaign =
        campaignRepository.getById(
          updatedLead.campaignId
        );

      if (!campaign) {
        return response
          .status(400)
          .json({
            success: false,
            message:
              "campaignId must reference an existing campaign"
          });
      }

      updatedLead.name =
        String(
          updatedLead.name
        ).trim();

      updatedLead.email =
        String(
          updatedLead.email
        )
          .trim()
          .toLowerCase();

      updatedLead.phone =
        updatedLead.phone
          ? String(
              updatedLead.phone
            ).trim()
          : "";

      const savedLead =
        leadRepository.update(
          request.params.id,
          updatedLead
        );

      response.status(200).json({
        success: true,
        data:
          toApiLead(
            savedLead
          )
      });
    }
  );

  // UPDATE LEAD STAGE
  app.patch(
    "/api/leads/:id/stage",
    (request, response) => {
      const existing =
        leadRepository.getById(
          request.params.id
        );

      if (!existing) {
        return response
          .status(404)
          .json({
            success: false,
            message:
              "Lead not found"
          });
      }

      const transition =
        validateStageTransition(
          existing.stage,
          request.body.stage
        );

      if (!transition.allowed) {
        return response
          .status(400)
          .json({
            success: false,
            message:
              transition.message
          });
      }

      const updatedLead =
        leadRepository.updateStage(
          request.params.id,
          request.body.stage,
          new Date().toISOString()
        );

      response.status(200).json({
        success: true,
        data:
          toApiLead(
            updatedLead
          )
      });
    }
  );

  // DELETE LEAD
  app.delete(
    "/api/leads/:id",
    (request, response) => {
      const deleted =
        leadRepository.remove(
          request.params.id
        );

      if (!deleted) {
        return response
          .status(404)
          .json({
            success: false,
            message:
              "Lead not found"
          });
      }

      response.status(200).json({
        success: true,
        message:
          "Lead deleted successfully"
      });
    }
  );

  // ANALYTICS SUMMARY
  app.get(
    "/api/analytics/summary",
    (request, response) => {
      const summary =
        analyticsService.getSummary();

      response.status(200).json({
        success: true,
        data: summary
      });
    }
  );

  // UNKNOWN ROUTE
  app.use(
    (request, response) => {
      response.status(404).json({
        success: false,
        message:
          "Route not found"
      });
    }
  );

  return {
    app,
    db
  };
}

module.exports = {
  createApp
};