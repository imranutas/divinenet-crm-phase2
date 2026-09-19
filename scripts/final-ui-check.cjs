const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const apps = fs.readFileSync(path.join(root, "apps.js"), "utf8");

const checks = [];

function check(name, test) {
  try {
    test();
    checks.push({ name, result: "Pass" });
    console.log("PASS:", name);
  } catch (error) {
    checks.push({ name, result: "Fail", error: error.message });
    console.error("FAIL:", name, "-", error.message);
  }
}

check("Dashboard uses backend analytics", () => {
  assert.match(apps, /const analytics\s*=\s*state\.analytics/);
  assert.match(apps, /analytics\.totalCampaigns/);
  assert.match(apps, /analytics\.activeCampaigns/);
  assert.match(apps, /analytics\.totalLeads/);
  assert.match(apps, /analytics\.qualifiedLeads/);
  assert.match(apps, /analytics\.leadsByStage/);
});

check("Qualification rate displays two decimals and N/A for null", () => {
  assert.match(apps, /qualificationRate\s*===\s*null/);
  assert.match(apps, /toFixed\(2\)\s*\+\s*"%"/);
  assert.match(apps, /"N\/A"/);
});

check("Campaign filters are retained in application memory", () => {
  assert.match(apps, /state\.filters\.campaignSearch/);
  assert.match(apps, /state\.filters\.campaignStatus/);
});

check("Lead filters are retained in application memory", () => {
  assert.match(apps, /state\.filters\.leadSearch/);
  assert.match(apps, /state\.filters\.leadCampaign/);
});

check("Campaign CSV exports the filtered campaign records", () => {
  assert.match(apps, /filteredCampaigns\.map/);
  assert.match(apps, /download\.disabled\s*=\s*!filteredCampaigns\.length/);
});

check("Lead CSV exports the filtered lead records", () => {
  assert.match(apps, /filteredLeads\.map/);
  assert.match(apps, /download\.disabled\s*=\s*!filteredLeads\.length/);
});

check("Filtered views distinguish no matches from an empty database", () => {
  assert.match(apps, /No matching campaigns\./);
  assert.match(apps, /No matching leads\./);
  assert.match(apps, /No campaigns have been created yet\./);
  assert.match(apps, /No leads have been captured yet\./);
});

check("Copied campaign context refreshes channel overlap check", () => {
  assert.match(
    apps,
    /inputs\.channel\.dispatchEvent\(new Event\("change"\)\)/
  );
});

const failed = checks.filter(item => item.result === "Fail").length;

console.log(JSON.stringify({
  recordedAt: new Date().toISOString(),
  executor: process.env.CRM_TEST_EXECUTOR || "Not specified",
  checks,
  passed: checks.length - failed,
  failed
}, null, 2));

if (failed) process.exit(1);