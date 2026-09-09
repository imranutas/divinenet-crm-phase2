const { randomUUID } = require('node:crypto');
function normaliseDatabase(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) return;
  // SQLite requires this outside a transaction while the parent table is rebuilt.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE BINARY);
        CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE BINARY);
        CREATE TABLE campaigns_normalised(
          id TEXT PRIMARY KEY,campaign_name TEXT NOT NULL,prompt TEXT NOT NULL,
          client_id TEXT REFERENCES clients(id),brand_id TEXT REFERENCES brands(id),
          objective TEXT NOT NULL DEFAULT '',target_audience TEXT NOT NULL DEFAULT '',
          start_date TEXT NOT NULL,end_date TEXT NOT NULL,budget REAL CHECK(budget IS NULL OR budget>=0),
          channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Draft',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        );`);
      const originals = db.prepare('SELECT * FROM campaigns').all();
      function labelId(table, name) {
        if (!name || !name.trim()) return null;
        const found = db.prepare('SELECT id FROM ' + table + ' WHERE name=?').get(name);
        if (found) return found.id;
        const id = randomUUID();
        db.prepare('INSERT INTO ' + table + '(id,name) VALUES (?,?)').run(id,name);
        return id;
      }
      const insert = db.prepare('INSERT INTO campaigns_normalised VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const c of originals) insert.run(c.id,c.campaign_name,c.prompt,labelId('clients',c.client),labelId('brands',c.brand),c.objective,c.target_audience,c.start_date,c.end_date,c.budget,c.channel,c.status,c.created_at,c.updated_at);
      db.exec('DROP TABLE campaigns; ALTER TABLE campaigns_normalised RENAME TO campaigns; CREATE INDEX idx_leads_campaign ON leads(campaign_id); CREATE INDEX idx_history_lead ON lead_stage_history(lead_id);');
      if (db.pragma('foreign_key_check').length) throw new Error('Existing data has broken relationships; migration rolled back');
      db.prepare('INSERT INTO schema_migrations VALUES (2,?)').run(new Date().toISOString());
    })();
  } finally { db.pragma('foreign_keys = ON'); }
}
function assetSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_sequences(name TEXT PRIMARY KEY,value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS campaign_assets(
      id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      prompt TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,image_data BLOB NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/png',status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Approved')),
      created_at TEXT NOT NULL,approved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_assets_campaign ON campaign_assets(campaign_id);`);
  db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (3,?)').run(new Date().toISOString());
}
module.exports = { normaliseDatabase, assetSchema };
