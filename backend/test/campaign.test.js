const test = require("node:test");
const assert = require("node:assert/strict");

const { createDatabase } = require("../db/connection");
const { runMigrations } = require("../db/migrate");
const {
  createCampaignRepository
} = require("../repositories/campaignRepository");

function createTestRepository() {
  // Use an in-memory SQLite database so tests do not
  // modify the real development database.
  const db = createDatabase(":memory:");
  runMigrations(db);

  return {
    db,
    repository: createCampaignRepository(db)
  };
}

function testingCampaign(overrides = {}) {
  const now = new Date().toISOString();

  return {
    id: "CAM-001",
    campaignName: "Sprint 3 Testing Campaign",
    prompt: "Create testing campaign content",
    client: "Testing Client",
    brand: "Divinenet Testing",
    objective: "Test campaign persistence",
    targetAudience: "Testing audience",
    startDate: "2026-09-10",
    endDate: "2026-09-20",
    budget: 10000,
    channel: "LinkedIn",
    status: "Draft",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

test("campaign repository starts empty", () => {
  const { db, repository } = createTestRepository();

  try {
    const campaigns = repository.getAll();

    assert.deepEqual(campaigns, []);
  } finally {
    db.close();
  }
});

test("creates and retrieves a campaign", () => {
  const { db, repository } = createTestRepository();

  try {
    const campaign = testingCampaign();

    repository.create(campaign);

    const savedCampaign = repository.getById("CAM-001");

    assert.ok(savedCampaign);
    assert.equal(savedCampaign.id, "CAM-001");
    assert.equal(
      savedCampaign.campaign_name,
      "Sprint 3 Testing Campaign"
    );
    assert.equal(savedCampaign.channel, "LinkedIn");
    assert.equal(savedCampaign.budget, 10000);
  } finally {
    db.close();
  }
});

test("lists stored campaigns", () => {
  const { db, repository } = createTestRepository();

  try {
    repository.create(testingCampaign());

    const campaigns = repository.getAll();

    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].id, "CAM-001");
  } finally {
    db.close();
  }
});

test("updates an existing campaign", () => {
  const { db, repository } = createTestRepository();

  try {
    const campaign = testingCampaign();

    repository.create(campaign);

    const updatedCampaign = {
      ...campaign,
      campaignName: "Updated Testing Campaign",
      budget: 15000,
      channel: "Instagram",
      status: "Active",
      updatedAt: new Date().toISOString()
    };

    const result = repository.update(
      "CAM-001",
      updatedCampaign
    );

    assert.ok(result);
    assert.equal(
      result.campaign_name,
      "Updated Testing Campaign"
    );
    assert.equal(result.budget, 15000);
    assert.equal(result.channel, "Instagram");
    assert.equal(result.status, "Active");
  } finally {
    db.close();
  }
});

test("returns undefined for a campaign that does not exist", () => {
  const { db, repository } = createTestRepository();

  try {
    const result = repository.getById("CAM-999");

    assert.equal(result, undefined);
  } finally {
    db.close();
  }
});

test("deletes an existing campaign", () => {
  const { db, repository } = createTestRepository();

  try {
    repository.create(testingCampaign());

    const deleted = repository.remove("CAM-001");

    assert.equal(deleted, true);
    assert.equal(
      repository.getById("CAM-001"),
      undefined
    );
  } finally {
    db.close();
  }
});

test("returns false when deleting a campaign that does not exist", () => {
  const { db, repository } = createTestRepository();

  try {
    const deleted = repository.remove("CAM-999");

    assert.equal(deleted, false);
  } finally {
    db.close();
  }
});
