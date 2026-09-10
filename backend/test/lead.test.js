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

function createTestRepositories() {
  const db = createDatabase(":memory:");
  runMigrations(db);

  return {
    db,
    campaignRepository: createCampaignRepository(db),
    leadRepository: createLeadRepository(db)
  };
}

function testingCampaign() {
  const now = new Date().toISOString();

  return {
    id: "CAM-001",
    campaignName: "Sprint 3 Testing Campaign",
    prompt: "Create testing campaign content",
    client: "Testing Client",
    brand: "Divinenet Testing",
    objective: "Test lead persistence",
    targetAudience: "Testing audience",
    startDate: "2026-09-10",
    endDate: "2026-09-20",
    budget: 10000,
    channel: "Website",
    status: "Draft",
    createdAt: now,
    updatedAt: now
  };
}

function testingLead(overrides = {}) {
  const now = new Date().toISOString();

  return {
    id: "LEAD-001",
    campaignId: "CAM-001",
    name: "Testing Lead",
    email: "testing.lead@example.com",
    phone: "0400000000",
    sourcePlatform: "Website",
    consentStatus: "Recorded",
    stage: "New",
    score: null,
    scorePolicyVersion: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

test("lead repository starts empty", () => {
  const { db, leadRepository } =
    createTestRepositories();

  try {
    assert.deepEqual(leadRepository.getAll(), []);
  } finally {
    db.close();
  }
});

test("creates and retrieves a lead linked to a campaign", () => {
  const {
    db,
    campaignRepository,
    leadRepository
  } = createTestRepositories();

  try {
    campaignRepository.create(testingCampaign());

    leadRepository.create(testingLead());

    const savedLead =
      leadRepository.getById("LEAD-001");

    assert.ok(savedLead);
    assert.equal(savedLead.id, "LEAD-001");
    assert.equal(savedLead.campaign_id, "CAM-001");
    assert.equal(savedLead.name, "Testing Lead");
    assert.equal(savedLead.source_platform, "Website");
    assert.equal(savedLead.consent_status, "Recorded");
    assert.equal(savedLead.stage, "New");
  } finally {
    db.close();
  }
});

test("filters leads by campaign id", () => {
  const {
    db,
    campaignRepository,
    leadRepository
  } = createTestRepositories();

  try {
    campaignRepository.create(testingCampaign());

    leadRepository.create(testingLead());

    const leads =
      leadRepository.getAll("CAM-001");

    assert.equal(leads.length, 1);
    assert.equal(leads[0].campaign_id, "CAM-001");
  } finally {
    db.close();
  }
});

test("updates an existing lead", () => {
  const {
    db,
    campaignRepository,
    leadRepository
  } = createTestRepositories();

  try {
    campaignRepository.create(testingCampaign());

    const lead = testingLead();

    leadRepository.create(lead);

    const updatedLead = {
      ...lead,
      name: "Updated Testing Lead",
      phone: "0411111111",
      sourcePlatform: "LinkedIn",
      consentStatus: "Unknown",
      updatedAt: new Date().toISOString()
    };

    const result =
      leadRepository.update(
        "LEAD-001",
        updatedLead
      );

    assert.ok(result);
    assert.equal(
      result.name,
      "Updated Testing Lead"
    );
    assert.equal(result.phone, "0411111111");
    assert.equal(
      result.source_platform,
      "LinkedIn"
    );
    assert.equal(
      result.consent_status,
      "Unknown"
    );
  } finally {
    db.close();
  }
});

test("updates lead stage and records stage history", () => {
  const {
    db,
    campaignRepository,
    leadRepository
  } = createTestRepositories();

  try {
    campaignRepository.create(testingCampaign());

    leadRepository.create(testingLead());

    const updatedAt =
      new Date().toISOString();

    const updatedLead =
      leadRepository.updateStage(
        "LEAD-001",
        "Contacted",
        updatedAt
      );

    assert.equal(
      updatedLead.stage,
      "Contacted"
    );

    const history = db
      .prepare(`
        SELECT *
        FROM lead_stage_history
        WHERE lead_id = ?
      `)
      .all("LEAD-001");

    assert.equal(history.length, 1);
    assert.equal(history[0].from_stage, "New");
    assert.equal(
      history[0].to_stage,
      "Contacted"
    );
  } finally {
    db.close();
  }
});

test("counts leads linked to a campaign", () => {
  const {
    db,
    campaignRepository,
    leadRepository
  } = createTestRepositories();

  try {
    campaignRepository.create(testingCampaign());

    leadRepository.create(testingLead());

    const count =
      leadRepository.countByCampaignId(
        "CAM-001"
      );

    assert.equal(count, 1);
  } finally {
    db.close();
  }
});

test("deletes an existing lead", () => {
  const {
    db,
    campaignRepository,
    leadRepository
  } = createTestRepositories();

  try {
    campaignRepository.create(testingCampaign());

    leadRepository.create(testingLead());

    const deleted =
      leadRepository.remove("LEAD-001");

    assert.equal(deleted, true);

    assert.equal(
      leadRepository.getById("LEAD-001"),
      undefined
    );
  } finally {
    db.close();
  }
});

test("returns false when deleting a lead that does not exist", () => {
  const { db, leadRepository } =
    createTestRepositories();

  try {
    const deleted =
      leadRepository.remove("LEAD-999");

    assert.equal(deleted, false);
  } finally {
    db.close();
  }
});
