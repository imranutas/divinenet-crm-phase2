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
