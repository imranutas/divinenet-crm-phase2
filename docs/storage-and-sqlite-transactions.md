# Backend Storage Layer & SQLite Transaction Boundaries

This chapter details the backend storage architecture, transaction boundaries, and state management mechanisms for `Divinenet-CRM` as validated in DCRM2-21.

---

## 1. Architectural Overview

`Divinenet-CRM` uses an embedded **SQLite** relational database driven by the synchronous `better-sqlite3` driver inside a Node.js runtime.
Table,Primary Key,Attributes & Constraints,Operational Notes
campaigns,id TEXT,"campaign_name, prompt, client_id?, brand_id?, objective, target_audience, start_date, end_date, budget REAL?, channel, status, created_at, updated_at","objective & target_audience default to """". status defaults to 'Draft'. budget enforces >= 0 when non-null."
leads,id TEXT,"campaign_id, name, email, phone, source_platform, consent_status, stage, score INTEGER?, score_policy_version?, created_at, updated_at","phone defaults to """". stage defaults to 'New'."
lead_stage_history,id TEXT,"lead_id, from_stage?, to_stage, changed_at",Chronological tracking of stage transitions.
clients,id TEXT,name,Name column enforces UNIQUE with COLLATE BINARY.
brands,id TEXT,name,Name column enforces UNIQUE with COLLATE BINARY.
campaign_assets,id TEXT,"campaign_id, prompt, provider, model, image_data BLOB NOT NULL, mime_type, status, created_at, approved_at?",status restricted to 'Draft' or 'Approved'.
campaign_save_requests,request_id TEXT,"request_hash, campaign_id?, created_at",Stores idempotency receipts. FK campaign_id uses ON DELETE SET NULL.
schema_migrations,version INTEGER,applied_at,Migration tracking register.
app_sequences,name TEXT,value INTEGER NOT NULL,Internal sequence generator.
ai_generation_attempts,id TEXT,created_at,Usage logging for background execution.
ai_runtime_guard,id INTEGER,"state, updated_at",Dynamic single-row state table (id=1). state restricted to 'Ready' | 'Generating' | 'NeedsReset'.
Child Column,Parent Column,Nullable,On Delete,On Update
campaigns.client_id,clients.id,Yes,NO ACTION,NO ACTION
campaigns.brand_id,brands.id,Yes,NO ACTION,NO ACTION
leads.campaign_id,campaigns.id,No,NO ACTION,NO ACTION
lead_stage_history.lead_id,leads.id,No,NO ACTION,NO ACTION
campaign_assets.campaign_id,campaigns.id,No,NO ACTION,NO ACTION
campaign_save_requests.campaign_id,campaigns.id,Yes,SET NULL,NO ACTION
node ./scripts/backup-crm.cjs
node -e "const DB=require('./backend/node_modules/better-sqlite3'); const db=new DB('./backups/target.sqlite'); console.log('Integrity check:', db.pragma('quick_check'));"
node -e "const DB=require('./backend/node_modules/better-sqlite3'); const db=new DB('./backend/data/crm.sqlite'); db.prepare(\"UPDATE ai_runtime_guard SET state='Ready', updated_at=datetime('now') WHERE id=1\").run(); console.log('Runtime Guard reset to Ready.');"
