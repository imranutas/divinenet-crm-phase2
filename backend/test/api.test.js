const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../app");
const { createDatabase } = require("../db/connection");

async function createTestServer() {
  const db = createDatabase(":memory:");
  const { app } = createApp({ db });

  const server = app.listen(0);

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function close() {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    db.close();
  }

  return {
    baseUrl,
    close
  };
}

async function requestJson(
  baseUrl,
  path,
  options = {}
) {
  const response = await fetch(
    `${baseUrl}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const body = await response.json();

  return {
    status: response.status,
    body
  };
}

function validCampaign(overrides = {}) {
  return {
    campaignName: "API Testing Campaign",
    prompt: "Create testing campaign content",
    client: "Testing Client",
    brand: "Divinenet Testing",
    objective: "Test campaign API",
    targetAudience: "Testing audience",
    startDate: "2026-09-10",
    endDate: "2026-09-20",
    budget: 10000,
    channel: "Website",
    status: "Draft",
    ...overrides
  };
}

async function createCampaign(baseUrl, overrides = {}) {
  return requestJson(
    baseUrl,
    "/api/campaigns",
    {
      method: "POST",
      body: JSON.stringify(
        validCampaign(overrides)
      )
    }
  );
}

test("health endpoint returns 200", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await requestJson(
      environment.baseUrl,
      "/api/health"
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
  } finally {
    await environment.close();
  }
});

test("campaign list starts empty", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await requestJson(
      environment.baseUrl,
      "/api/campaigns"
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.deepEqual(result.body.data, []);
  } finally {
    await environment.close();
  }
});

test("creates and retrieves a campaign through HTTP API", async () => {
  const environment =
    await createTestServer();

  try {
    const created = await createCampaign(
      environment.baseUrl
    );

    assert.equal(created.status, 201);
    assert.equal(created.body.success, true);
    assert.equal(
      created.body.data.id,
      "CAM-001"
    );
    assert.equal(
      created.body.data.channel,
      "Website"
    );
    assert.equal(
      created.body.data.budget,
      10000
    );

    const retrieved = await requestJson(
      environment.baseUrl,
      "/api/campaigns/CAM-001"
    );

    assert.equal(retrieved.status, 200);
    assert.equal(
      retrieved.body.data.id,
      "CAM-001"
    );
  } finally {
    await environment.close();
  }
});

test("rejects campaign with missing required field", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await createCampaign(
      environment.baseUrl,
      {
        campaignName: ""
      }
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(
      result.body.message,
      "campaignName is required"
    );
  } finally {
    await environment.close();
  }
});

test("rejects negative campaign budget", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await createCampaign(
      environment.baseUrl,
      {
        budget: -100
      }
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(
      result.body.message,
      "Budget must be a non-negative number"
    );
  } finally {
    await environment.close();
  }
});

test("rejects campaign when end date is before start date", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await createCampaign(
      environment.baseUrl,
      {
        startDate: "2026-09-20",
        endDate: "2026-09-10"
      }
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
  } finally {
    await environment.close();
  }
});

test("returns 404 for missing campaign", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await requestJson(
      environment.baseUrl,
      "/api/campaigns/CAM-999"
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.success, false);
  } finally {
    await environment.close();
  }
});

test("creates a lead linked to an existing campaign", async () => {
  const environment =
    await createTestServer();

  try {
    await createCampaign(
      environment.baseUrl
    );

    const result = await requestJson(
      environment.baseUrl,
      "/api/leads",
      {
        method: "POST",
        body: JSON.stringify({
          campaignId: "CAM-001",
          name: "API Testing Lead",
          email: "api.lead@example.com",
          phone: "0400000000",
          sourcePlatform: "Website",
          consentStatus: "Recorded"
        })
      }
    );

    assert.equal(result.status, 201);
    assert.equal(result.body.success, true);
    assert.equal(
      result.body.data.id,
      "LEAD-001"
    );
    assert.equal(
      result.body.data.campaignId,
      "CAM-001"
    );
    assert.equal(
      result.body.data.stage,
      "New"
    );

    // Score remains server-owned and is not
    // automatically represented as AI/ML.
    assert.equal(
      result.body.data.score,
      null
    );
  } finally {
    await environment.close();
  }
});

test("rejects lead linked to a missing campaign", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await requestJson(
      environment.baseUrl,
      "/api/leads",
      {
        method: "POST",
        body: JSON.stringify({
          campaignId: "CAM-999",
          name: "Testing Lead",
          email: "testing@example.com",
          sourcePlatform: "Website",
          consentStatus: "Recorded"
        })
      }
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(
      result.body.message,
      "campaignId must reference an existing campaign"
    );
  } finally {
    await environment.close();
  }
});

test("rejects lead with invalid email", async () => {
  const environment =
    await createTestServer();

  try {
    await createCampaign(
      environment.baseUrl
    );

    const result = await requestJson(
      environment.baseUrl,
      "/api/leads",
      {
        method: "POST",
        body: JSON.stringify({
          campaignId: "CAM-001",
          name: "Testing Lead",
          email: "invalid-email",
          sourcePlatform: "Website",
          consentStatus: "Recorded"
        })
      }
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(
      result.body.message,
      "A valid email address is required"
    );
  } finally {
    await environment.close();
  }
});

test("prevents deleting campaign with linked leads", async () => {
  const environment =
    await createTestServer();

  try {
    await createCampaign(
      environment.baseUrl
    );

    await requestJson(
      environment.baseUrl,
      "/api/leads",
      {
        method: "POST",
        body: JSON.stringify({
          campaignId: "CAM-001",
          name: "Testing Lead",
          email: "testing@example.com",
          sourcePlatform: "Website",
          consentStatus: "Recorded"
        })
      }
    );

    const result = await requestJson(
      environment.baseUrl,
      "/api/campaigns/CAM-001",
      {
        method: "DELETE"
      }
    );

    assert.equal(result.status, 409);
    assert.equal(result.body.success, false);
    assert.equal(
      result.body.message,
      "Campaign cannot be deleted while leads are linked to it"
    );
  } finally {
    await environment.close();
  }
});

test("returns 404 for unknown API route", async () => {
  const environment =
    await createTestServer();

  try {
    const result = await requestJson(
      environment.baseUrl,
      "/api/unknown"
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.success, false);
    assert.equal(
      result.body.message,
      "Route not found"
    );
  } finally {
    await environment.close();
  }
});