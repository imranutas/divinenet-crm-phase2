const test = require("node:test");
const assert = require("node:assert/strict");

const { createDatabase } = require("../db/connection");
const { runMigrations } = require("../db/migrate");

const {
  createCampaignRepository
} = require("../repositories/campaignRepository");

const {
  createLeadRepository
} = require("../repositories/leadRepository");

const {
  createAnalyticsService
} = require("../services/analytics-service");

function createTestEnvironment() {
  const db = createDatabase(":memory:");
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

  return {
    db,
    campaignRepository,
    leadRepository,
    analyticsService
  };
}

function addCampaign(repository) {
  const now = new Date().toISOString();

  repository.create({
    id: "CAM-001",
    campaignName: "Analytics Testing Campaign",
    prompt: "Testing analytics",
    client: "Testing Client",
    brand: "Divinenet Testing",
    objective: "Test factual analytics",
    targetAudience: "Testing audience",
    startDate: "2026-09-10",
    endDate: "2026-09-20",
    budget: 5000,
    channel: "Website",
    status: "Draft",
    createdAt: now,
    updatedAt: now
  });
}

function addLead(
  repository,
  id,
  sourcePlatform,
  stage
) {
  const now = new Date().toISOString();

  repository.create({
    id,
    campaignId: "CAM-001",
    name: `Testing Lead ${id}`,
    email: `${id.toLowerCase()}@example.com`,
    phone: "",
    sourcePlatform,
    consentStatus: "Recorded",
    stage,
    score: null,
    scorePolicyVersion: null,
    createdAt: now,
    updatedAt: now
  });
}

test("returns zero counts when database is empty", () => {
  const { db, analyticsService } =
    createTestEnvironment();

  try {
    const summary = analyticsService.getSummary();

    assert.equal(summary.totalCampaigns, 0);
    assert.equal(summary.totalLeads, 0);
    assert.equal(summary.leadsByStage.New, 0);
    assert.equal(summary.leadsBySource.Website, 0);
  } finally {
    db.close();
  }
});

test("returns factual campaign and lead totals", () => {
  const {
    db,
    campaignRepository,
    leadRepository,
    analyticsService
  } = createTestEnvironment();

  try {
    addCampaign(campaignRepository);

    addLead(
      leadRepository,
      "LEAD-001",
      "Website",
      "New"
    );

    addLead(
      leadRepository,
      "LEAD-002",
      "LinkedIn",
      "Qualified"
    );

    const summary = analyticsService.getSummary();

    assert.equal(summary.totalCampaigns, 1);
    assert.equal(summary.totalLeads, 2);
  } finally {
    db.close();
  }
});

test("counts leads by stage correctly", () => {
  const {
    db,
    campaignRepository,
    leadRepository,
    analyticsService
  } = createTestEnvironment();

  try {
    addCampaign(campaignRepository);

    addLead(
      leadRepository,
      "LEAD-001",
      "Website",
      "New"
    );

    addLead(
      leadRepository,
      "LEAD-002",
      "LinkedIn",
      "Qualified"
    );

    const summary = analyticsService.getSummary();

    assert.equal(summary.leadsByStage.New, 1);
    assert.equal(summary.leadsByStage.Contacted, 0);
    assert.equal(summary.leadsByStage.Qualified, 1);
  } finally {
    db.close();
  }
});

test("counts leads by source platform correctly", () => {
  const {
    db,
    campaignRepository,
    leadRepository,
    analyticsService
  } = createTestEnvironment();

  try {
    addCampaign(campaignRepository);

    addLead(
      leadRepository,
      "LEAD-001",
      "Website",
      "New"
    );

    addLead(
      leadRepository,
      "LEAD-002",
      "LinkedIn",
      "Qualified"
    );

    const summary = analyticsService.getSummary();

    assert.equal(summary.leadsBySource.Website, 1);
    assert.equal(summary.leadsBySource.LinkedIn, 1);
    assert.equal(summary.leadsBySource.Facebook, 0);
    assert.equal(summary.leadsBySource.Instagram, 0);
  } finally {
    db.close();
  }
});