const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PHASE1_UNAVAILABLE,
  createPhase1Adapter
} = require("../services/phase1-adapter");

test("returns 503 when Phase 1 is not configured", async () => {
  const adapter = createPhase1Adapter();

  const result = await adapter.getCustomer("CUS-001");

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.message, PHASE1_UNAVAILABLE);
});

test("requires customerId when client is configured", async () => {
  const testingClient = {
    async getCustomer() {
      return null;
    }
  };

  const adapter = createPhase1Adapter({
    client: testingClient
  });

  const result = await adapter.getCustomer("");

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.message, "customerId is required");
});

test("retrieves customer through configured test client", async () => {
  const testingClient = {
    async getCustomer(customerId) {
      return {
        id: customerId,
        name: "Testing Customer"
      };
    }
  };

  const adapter = createPhase1Adapter({
    client: testingClient
  });

  const result = await adapter.getCustomer("CUS-001");

  assert.equal(result.success, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.data.id, "CUS-001");
  assert.equal(result.data.name, "Testing Customer");
});

test("returns 404 when test client cannot find customer", async () => {
  const testingClient = {
    async getCustomer() {
      return null;
    }
  };

  const adapter = createPhase1Adapter({
    client: testingClient
  });

  const result = await adapter.getCustomer("CUS-999");

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 404);
  assert.equal(result.message, "Customer not found");
});

test("does not convert lead when Phase 1 is unconfigured", async () => {
  const adapter = createPhase1Adapter();

  const result = await adapter.convertLead({
    id: "LEAD-001"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.message, PHASE1_UNAVAILABLE);
});

test("converts lead through configured test client", async () => {
  const testingClient = {
    async convertLead(lead) {
      return {
        customerId: "CUS-001",
        sourceLeadId: lead.id,
        integrationMode: "testing"
      };
    }
  };

  const adapter = createPhase1Adapter({
    client: testingClient
  });

  const result = await adapter.convertLead({
    id: "LEAD-001",
    name: "Testing Lead"
  });

  assert.equal(result.success, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.data.customerId, "CUS-001");
  assert.equal(result.data.sourceLeadId, "LEAD-001");
  assert.equal(result.data.integrationMode, "testing");
});

test("returns safe error when Phase 1 request fails", async () => {
  const testingClient = {
    async getCustomer() {
      throw new Error("Testing connection failure");
    }
  };

  const adapter = createPhase1Adapter({
    client: testingClient
  });

  const result = await adapter.getCustomer("CUS-001");

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 502);
  assert.equal(
    result.message,
    "Phase 1 service request failed"
  );
});
