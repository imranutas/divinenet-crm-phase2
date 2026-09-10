const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PIPELINE_VERSION,
  validateStageTransition
} = require("../services/lead-pipeline");

test("uses the development pipeline version", () => {
  assert.equal(
    PIPELINE_VERSION,
    "development-pipeline-v1"
  );
});

test("allows New to Contacted", () => {
  const result =
    validateStageTransition(
      "New",
      "Contacted"
    );

  assert.equal(result.allowed, true);
  assert.equal(
    result.pipelineVersion,
    "development-pipeline-v1"
  );
});

test("allows Contacted to Qualified", () => {
  const result =
    validateStageTransition(
      "Contacted",
      "Qualified"
    );

  assert.equal(result.allowed, true);
});

test("prevents New from skipping directly to Qualified", () => {
  const result =
    validateStageTransition(
      "New",
      "Qualified"
    );

  assert.equal(result.allowed, false);
  assert.equal(
    result.message,
    "Invalid stage transition from New to Qualified"
  );
});

test("prevents backwards transition", () => {
  const result =
    validateStageTransition(
      "Qualified",
      "Contacted"
    );

  assert.equal(result.allowed, false);
});

test("prevents changing to the same stage", () => {
  const result =
    validateStageTransition(
      "New",
      "New"
    );

  assert.equal(result.allowed, false);
  assert.equal(
    result.message,
    "Lead is already in the requested stage"
  );
});

test("rejects unsupported stage", () => {
  const result =
    validateStageTransition(
      "Qualified",
      "Converted"
    );

  assert.equal(result.allowed, false);
  assert.equal(
    result.message,
    "Requested lead stage is not supported"
  );
});
