const SCORE_POLICY_VERSION = "development-policy-v1";

function calculateLeadScore(lead) {
  let score = 0;

  // Development-only deterministic scoring rules.
  // This must not be described as AI or machine learning.

  if (lead.consentStatus === "Recorded") {
    score += 40;
  }

  if (
    lead.email &&
    String(lead.email).trim() !== ""
  ) {
    score += 20;
  }

  if (
    lead.phone &&
    String(lead.phone).trim() !== ""
  ) {
    score += 20;
  }

  const approvedSources = [
    "Facebook",
    "Instagram",
    "LinkedIn",
    "Website"
  ];

  if (approvedSources.includes(lead.sourcePlatform)) {
    score += 20;
  }

  return {
    score: Math.min(score, 100),
    scorePolicyVersion: SCORE_POLICY_VERSION
  };
}

module.exports = {
  SCORE_POLICY_VERSION,
  calculateLeadScore
};
