# Divinenet CRM — local workspace, 18 September 2026

1. Double-click START-CRM.cmd. Node.js 24 is already installed on this laptop. Nothing is downloaded automatically.
2. Open http://127.0.0.1:3192/ and choose your first administrator username and a password of at least 12 characters. No preset account exists.
3. Create a campaign: name, brief, client/brand, channel, status, budget and editable dates. New dates start today and end seven calendar days later. 10k becomes10000.
4. In that same form, generate a local AI image OR choose a PNG/JPEG and press Use this file as banner. Review and approve it, then Save campaign. Selecting a file alone does not save it. Unsaved drafts expire after30minutes or server restart.
5. View the saved campaign to reopen/download its approved banner. Mark a campaign Active, then select Open lead form. A consented form submission creates a linked Website/New lead automatically. This link works on this computer only, not the Internet.
6. Leads & pipeline lets you edit, advance New → Contacted → Qualified and inspect history. A campaign with linked leads cannot be deleted. Refresh or return to the workspace to see newly submitted responses.
7. Manage access lets an administrator add editors/viewers, change roles, disable accounts and reset other users' passwords. Viewers cannot change records. Keep at least one administrator and remember your password: no recovery-email service exists.

## Data and shutdown

Records, approved banners and accounts live in data/divinenet.sqlite in THIS folder. It starts empty intentionally. Older packages, data and original submissions were preserved, not imported. Use synthetic details until real-data handling is agreed.

STOP-CRM.cmd cleanly stops this package. It does not kill unrelated processes. It stops an AI runtime only if this launcher started it. START-CRM.cmd reopens the same data and account later.

Wait for `Package CRM shutdown confirmed` and a successful exit before restarting. The stop command waits for the package process to exit; a genuine timeout remains an error and must be investigated. Do not change ports or use another checkout to bypass a conflict: another folder has a different database. Use `START-CRM.cmd --no-ai` when demonstrating core features without a verified image runtime.

When editing a campaign, a saved non-default end date is preserved. A seven-day default continues to follow changes to the start date until the end date is manually edited in that form. Historical records do not store whether an end date was originally automatic; a saved seven-day interval is treated as the default.

## Backup and restore

BACKUP-CRM.cmd creates a new validated SQLite snapshot in backups/. Backups contain private records and account hashes; store them securely.

RESTORE-CRM.cmd "C:\full path\backup.sqlite" only validates a selected backup. Stop the CRM, then repeat with --apply to restore it. Earlier files remain under a new backups/before-restore-* folder. Restart and verify restored records. Never run another server against the same database during recovery.

## Local AI

The separately installed pinned runtime/model is reused from SPRINT3/AI_RUNTIME_PILOT_15_SEPTEMBER_2026. No paid account/API is used. It requires the tested Windows/NVIDIA GPU environment; basic CPU-only hardware is not validated. First generation in this build took about106seconds; speed varies. Identical prompts can produce identical images with the fixed seed. Each output requires review, and lettering may be poor.

Use general creative descriptions, not private contact details. The two-minute timeout and uncertain-execution guard prevent overlapping retries. Do not repeatedly click Generate while busy. Uploaded artwork is labelled uploaded, never AI-generated. START-CRM.cmd --no-ai starts the core without the AI runtime.

## Scope and verification

Local campaign/lead/banner/account workflows are implemented. Phase1/customer/appointment integration, direct social publishing and public hosting are not connected. Pipeline stages and operational counts are not an approved customer-conversion/scoring policy. Overlap advice is rule-based, not AI forecasting.

This copy builds on original member work and the separate17September assembly. The18September changes/tests are assistant engineering work, not fictional member commits, independent human QA, client acceptance or production certification. Remote GitHub/Jira were not changed. Fresh results and screenshots are under test-evidence/; original dated evidence is untouched.
