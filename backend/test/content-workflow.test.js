const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTENT_SERVICE_UNAVAILABLE,
  createContentWorkflow
} = require("../services/content-workflow");

test("returns 503 when no AI provider is configured", async () => {
  const workflow = createContentWorkflow();

  const result = await workflow.generateContent({
    prompt: "Create testing campaign content",
    brand: "Divinenet Testing",
    channel: "Website"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 503);
  assert.equal(
    result.message,
    CONTENT_SERVICE_UNAVAILABLE
  );
});

test("does not call an unconfigured provider", async () => {
  const workflow = createContentWorkflow();

  const result = await workflow.generateContent({
    prompt: "Testing prompt"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 503);
});

test("requires a prompt when a provider is configured", async () => {
  const testingProvider = {
    async generate() {
      return {
        content: "Testing content",
        provider: "testing-provider"
      };
    }
  };

  const workflow = createContentWorkflow({
    provider: testingProvider
  });

  const result = await workflow.generateContent({
    prompt: ""
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.message, "Prompt is required");
});

test("uses a configured test provider without claiming live AI", async () => {
  const testingProvider = {
    async generate(request) {
      return {
        content: `Testing draft for ${request.brand}`,
        provider: "testing-provider"
      };
    }
  };

  const workflow = createContentWorkflow({
    provider: testingProvider
  });

  const result = await workflow.generateContent({
    prompt: "Create a testing post",
    brand: "Divinenet Testing",
    channel: "LinkedIn"
  });

  assert.equal(result.success, true);
  assert.equal(result.statusCode, 200);
  assert.equal(
    result.data.content,
    "Testing draft for Divinenet Testing"
  );
  assert.equal(
    result.data.provider,
    "testing-provider"
  );
  assert.equal(result.data.status, "Draft");
  assert.equal(
    result.data.requiresHumanApproval,
    true
  );
});

test("returns a safe error when provider request fails", async () => {
  const failingProvider = {
    async generate() {
      throw new Error("Testing provider failure");
    }
  };

  const workflow = createContentWorkflow({
    provider: failingProvider
  });

  const result = await workflow.generateContent({
    prompt: "Testing prompt"
  });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 502);
  assert.equal(
    result.message,
    "AI content provider request failed"
  );
});
