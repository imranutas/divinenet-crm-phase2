const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SCORE_POLICY_VERSION,
  calculateLeadScore
} = require("../services/lead-scoring");

test("uses the development scoring policy version", () => {
  assert.equal(
    SCORE_POLICY_VERSION,
    "development-policy-v1"
  );
});

test("returns 100 for a complete lead with recorded consent", () => {
  const result = calculateLeadScore({
    email: "testing@example.com",
    phone: "0400000000",
    sourcePlatform: "Website",
    consentStatus: "Recorded"
  });

  assert.equal(result.score, 100);
  assert.equal(
    result.scorePolicyVersion,
    "development-policy-v1"
  );
});

test("does not award consent points when consent is unknown", () => {
  const result = calculateLeadScore({
    email: "testing@example.com",
    phone: "0400000000",
    sourcePlatform: "LinkedIn",
    consentStatus: "Unknown"
  });

  assert.equal(result.score, 60);
});

test("does not award phone points when phone is missing", () => {
  const result = calculateLeadScore({
    email: "testing@example.com",
    phone: "",
    sourcePlatform: "Website",
    consentStatus: "Recorded"
  });

  assert.equal(result.score, 80);
});

test("score never exceeds 100", () => {
  const result = calculateLeadScore({
    email: "testing@example.com",
    phone: "0400000000",
    sourcePlatform: "Facebook",
    consentStatus: "Recorded"
  });

  assert.equal(result.score, 100);
});
