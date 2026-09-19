# Backend Storage and SQLite Transaction Boundaries

## Version and scope

This document describes merged commit:
`c5776f39eb884266097422cf028f1780c8ba8422`

Documentation updated: 20 September 2026.

The local CRM uses SQLite through the synchronous `better-sqlite3`
driver. This is an implementation reference, not independent QA
or client acceptance.

## Database locations

All paths below are relative to the repository root.

| Run mode | Database | Local port |
| --- | --- | --- |
| Normal START-CRM.cmd launcher | data/divinenet.sqlite | 3192 |
| Explicit standalone debugging configuration in backend/README.md | backend/db/local-review.sqlite | 3194 |
| Database helper without an explicit path | backend/db/divinenet-crm.sqlite | Not determined by the database helper |

The standalone debugging path and port require the environment
settings documented in backend/README.md. They are not the normal
launcher configuration.

## Core tables

| Table | Primary key | Purpose and important constraints |
| --- | --- | --- |
| campaigns | id TEXT | Campaign brief, dates, channel, status and timestamps. Optional client_id and brand_id reference their directories. Budget is nullable and must be non-negative when supplied. |
| clients | id TEXT | Reusable names; name is unique using COLLATE BINARY. |
| brands | id TEXT | Reusable names; name is unique using COLLATE BINARY. Brand ownership by a client is not inferred. |
| leads | id TEXT | References a campaign. Stores contact details, source, consent, stage and optional score information. Stage defaults to New. |
| lead_stage_history | id TEXT | References a lead and records previous stage, next stage and transition time. |
| campaign_assets | id TEXT | References a campaign. Stores image bytes, prompt, provider, model, MIME type, approval status and timestamps. Status is Draft or Approved. |
| campaign_save_requests | request_id TEXT | Stores the request hash, campaign reference and creation time for campaign-save retries. |

## Local accounts and intake tables

| Table | Primary key | Purpose and important constraints |
| --- | --- | --- |
| local_users | id INTEGER AUTOINCREMENT | Unique case-insensitive username, password hash and salt, role, active flag and creation time. Roles are admin, editor or viewer. |
| local_sessions | token_hash TEXT | Stores a hashed session token, user reference, expiry and creation time. Sessions are deleted if their user is deleted. |
| campaign_intake_links | token TEXT | One stable local response link per campaign; campaign_id is unique. |
| campaign_intake_receipts | (token, request_id) | Stores payload hash, unique receipt ID, lead reference and creation time for duplicate-safe intake retries. |
| campaign_intake_limits | token TEXT | Stores the current rate-limit window and attempt count for a response link. |

Local account tables are created when local access control is enabled.
Intake tables are created when intake routes are attached.

Passwords and raw session tokens must not be included in reports,
screenshots or exported evidence.

## Supporting tables

| Table | Primary key | Purpose |
| --- | --- | --- |
| schema_migrations | version INTEGER | Records applied schema versions and timestamps. |
| app_sequences | name TEXT | Stores counters used for application identifiers. |
| ai_generation_attempts | id TEXT | Records generation-attempt timestamps. |
| ai_runtime_guard | id INTEGER, restricted to 1 | Tracks Ready, Generating or NeedsReset when the runtime guard is instantiated. |

Unsaved banner drafts are held in process memory, not in a
banner-drafts database table. They expire and are not durable across
process restarts. Saved image bytes are stored in campaign_assets.

## Foreign-key behaviour

Normal database connections enable SQLite foreign-key enforcement.

| Relationship | Nullable | On delete |
| --- | --- | --- |
| campaigns.client_id → clients.id | Yes | NO ACTION |
| campaigns.brand_id → brands.id | Yes | NO ACTION |
| leads.campaign_id → campaigns.id | No | NO ACTION |
| lead_stage_history.lead_id → leads.id | No | NO ACTION |
| campaign_assets.campaign_id → campaigns.id | No | NO ACTION |
| campaign_save_requests.campaign_id → campaigns.id | Yes | SET NULL |
| local_sessions.user_id → local_users.id | No | CASCADE |
| campaign_intake_links.campaign_id → campaigns.id | No | CASCADE |
| campaign_intake_receipts.token → campaign_intake_links.token | No | CASCADE |
| campaign_intake_receipts.lead_id → leads.id | Yes | SET NULL |
| campaign_intake_limits.token → campaign_intake_links.token | No | CASCADE |

SET NULL preserves retry receipts after the referenced record is
deleted. These receipts prevent a retry from silently recreating
deleted records.

## Transaction boundaries

### Campaign saves

backend/services/campaign-save.js wraps the following in one
database transaction:

1. Check an optional clientRequestId and any existing receipt.
2. For a new request, execute campaign validation and persistence.
3. Attach the approved banner draft, if supplied.
4. Store the save receipt, if a clientRequestId was supplied.

A database failure rolls back the transaction. The in-memory banner
draft is released only after the transaction succeeds.

An identical successful retry returns the stored campaign without
performing a new save. Reusing the request ID with different content
is rejected. A receipt whose campaign was deleted is also rejected.

Receipt replay is checked before new-save date validation, allowing
an identical successful retry across Sydney midnight.

### Lead stage changes

backend/repositories/leadRepository.js inserts a history entry and
updates the lead stage in one transaction. Those two writes succeed
or roll back together.

The existing stage is read before entering that transaction; this
description does not claim additional concurrency protection.

### Local response intake

backend/services/local-intake.js uses an immediate transaction to:

1. Check the submission receipt.
2. Recheck that the campaign is Active for a new submission.
3. Check the hourly receipt limit.
4. Create the lead and its receipt together.

The per-minute attempt counter is maintained in a separate
transaction. A rejected submission can therefore still count
toward the rate limit.

### Local account changes

First-administrator setup uses an immediate transaction.

Role/active-status changes use an immediate transaction to protect
the last active administrator and invalidate the affected sessions.

Password changes update the password hash and salt and delete
existing sessions together in a transaction. Where a replacement
session is issued, that happens afterward.

### Migrations and identifiers

The normalisation migration rebuilds campaign relationships inside
a transaction and checks foreign-key consistency. Foreign-key
enforcement is temporarily disabled for that rebuild and restored
in a finally block.

Campaign-save receipt schema creation and its migration record are
wrapped together in a transaction. Not every startup schema
statement belongs to one global migration transaction.

Application sequence allocation is transactional. This does not
mean every API request is one database-wide transaction.

### AI runtime state

The runtime guard checks Ready and changes it to Generating inside
a transaction. Successful completion sets Ready; uncertain execution
sets NeedsReset.

External image generation is not part of a SQLite transaction.

Do not manually force the guard to Ready with an unconditional SQL
UPDATE. Follow the reviewed runtime recovery procedure after
confirming the CRM and image runtime have stopped.

## Backup and recovery

Use BACKUP-CRM.cmd for the normal launcher database.

Its backup script:

- Reads data/divinenet.sqlite.
- Creates a new uniquely named snapshot under backups/.
- Checks integrity and foreign-key consistency.
- Leaves the original database unchanged.

This script does not automatically back up a separately configured
debugging database.

Use RESTORE-CRM.cmd and the instructions in START_HERE.md.
Validate first; stop the relevant CRM instance before an applied
restore. Do not overwrite an active database or treat an unvalidated
file copy as a verified recovery snapshot.

## Implementation references

- backend/db/connection.js
- backend/db/migrate.js
- backend/db/normalise.js
- backend/db/migrations/001_initial_schema.sql
- backend/repositories/campaignRepository.js
- backend/repositories/leadRepository.js
- backend/services/campaign-save.js
- backend/services/local-access.js
- backend/services/local-intake.js
- backend/services/image-assets.js
- backend/services/image-runtime-guard.js
- scripts/backup-crm.cjs
- START_HERE.md
- backend/README.md

## Limits

This documents the local implementation at the stated commit.
It does not establish live Phase 1 integration, social publishing,
public deployment, genuine AI generation, independent QA or
client acceptance.
