const fs = require("fs");
const path = require("path");
const { createDatabase } = require("./connection");

function runMigrations(db) {
  const migrationPath = path.join(
    __dirname,
    "migrations",
    "001_initial_schema.sql"
  );

  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  db.exec(migrationSql);

  const { normaliseDatabase, assetSchema } = require('./normalise');
  normaliseDatabase(db);
  assetSchema(db);

  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS campaign_save_requests(
      request_id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_save_requests_campaign ON campaign_save_requests(campaign_id);`);
    db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (4,?)').run(new Date().toISOString());
  })();

  require('../services/social-drafts').socialDraftSchema(db);
require('../services/content-plan').contentPlanSchema(db);
  return db;
}

if (require.main === module) {
  const db = createDatabase();

  try {
    runMigrations(db);
    console.log("Database migration completed successfully.");
  } finally {
    db.close();
  }
}

module.exports = {
  runMigrations
};
