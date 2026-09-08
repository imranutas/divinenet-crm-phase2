CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  campaign_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  target_audience TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  budget REAL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  source_platform TEXT NOT NULL,
  consent_status TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'New',
  score INTEGER,
  score_policy_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE TABLE IF NOT EXISTS lead_stage_history (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);