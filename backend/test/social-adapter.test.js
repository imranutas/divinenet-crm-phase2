const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SOCIAL_SERVICE_UNAVAILABLE,
  SUPPORTED_PLATFORMS,
  createSocialAdapter
} = require("../services/social-adapter");

test("supports the approved social platforms", () => {
  assert.deepEqual(SUPPORTED_PLATFORMS, [
    "Facebook",
    "Instagram",
    "LinkedIn"
  ]);
});

test("returns 503 when social integration is not configured", async () => {
  const adapter = createSocialAdapter();

  const result = await adapter.publishContent({
    platform: "Facebook",
    content: "Testing content"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 503);
  assert.equal(
    result.message,
    SOCIAL_SERVICE_UNAVAILABLE
  );
});

test("requires platform when provider is configured", async () => {
  const testingProvider = {
    async publish() {
      return {};
    }
  };

  const adapter = createSocialAdapter({
    provider: testingProvider
  });

  const result = await adapter.publishContent({
    content: "Testing content"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.message, "Platform is required");
});

test("rejects unsupported publishing platform", async () => {
  const testingProvider = {
    async publish() {
      return {};
    }
  };

  const adapter = createSocialAdapter({
    provider: testingProvider
  });

  const result = await adapter.publishContent({
    platform: "Website",
    content: "Testing content"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 400);
  assert.equal(
    result.message,
    "Platform must be Facebook, Instagram or LinkedIn"
  );
});

test("requires content before publishing", async () => {
  const testingProvider = {
    async publish() {
      return {};
    }
  };

  const adapter = createSocialAdapter({
    provider: testingProvider
  });

  const result = await adapter.publishContent({
    platform: "LinkedIn",
    content: ""
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.message, "Content is required");
});

test("uses configured testing provider without claiming live integration", async () => {
  const testingProvider = {
    async publish(request) {
      return {
        referenceId: "TEST-PUBLISH-001",
        integrationMode: "testing",
        receivedContent: request.content
      };
    }
  };

  const adapter = createSocialAdapter({
    provider: testingProvider
  });

  const result = await adapter.publishContent({
    platform: "Instagram",
    content: "Testing campaign post"
  });

  assert.equal(result.success, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.data.platform, "Instagram");
  assert.equal(
    result.data.referenceId,
    "TEST-PUBLISH-001"
  );
  assert.equal(
    result.data.integrationMode,
    "testing"
  );
});

test("returns safe error when publishing provider fails", async () => {
  const failingProvider = {
    async publish() {
      throw new Error(
        "Testing social provider failure"
      );
    }
  };

  const adapter = createSocialAdapter({
    provider: failingProvider
  });

  const result = await adapter.publishContent({
    platform: "LinkedIn",
    content: "Testing content"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 502);
  assert.equal(
    result.message,
    "Social publishing provider request failed"
  );
});