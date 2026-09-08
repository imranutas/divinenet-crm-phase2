const path = require("path");
const Database = require("better-sqlite3");

function createDatabase(databasePath) {
  const dbPath =
    databasePath || path.join(__dirname, "divinenet-crm.sqlite");

  const db = new Database(dbPath);

  // Enforce relationships such as lead -> campaign.
  db.pragma("foreign_keys = ON");

  return db;
}

module.exports = {
  createDatabase
};