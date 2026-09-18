# Divinenet CRM source handoff for Imran

This ZIP contains source and tests for review in the existing `imranutas/divinenet-crm-phase2` repository. It contains no installed dependencies, working database, runtime logs, credentials, private launcher configuration, AI model binaries or historical test-result directories.

## Begin

1. Extract the ZIP into a separate folder, not over the existing repository.
2. Fetch the existing repository and preserve unpublished member changes.
3. Continue `sprint3/final-local-product` if it already exists. Otherwise create the review branch from the current appropriate Praveen/combined history. The inspected frontend reference is `f0cf5808bf69426c1a262554320aaf476da7a466`; fetch and compare newer work before importing.
4. Compare the source with that branch. Import intended changes without deleting unrelated files or rewriting commit history. Keep existing historical diagrams/submissions. Review the workflow rather than blindly replacing a newer one.
5. Add private/runtime exclusions to `.gitignore` before staging: `/logs/`, `/data/`, `/backups/`, `/ai/`, `/runtime/`, `/launcher.config.json`, `/.codex/`, `/.agents/`, `*.gguf`, `*.safetensors`. Keep existing dependency/environment/database exclusions. Keep `backend/db/` source tracked.
6. Push the shared candidate early so Praveen can work in parallel. Open a Draft PR into `sprint3/combined-modern-review`.

## Finishing corrections required

- In `scripts/start-crm.cjs`, keep the local dependency-resolution checks but replace the direct native prebuild-path require with a real in-memory `better-sqlite3` open/query/close. Add readiness coverage; clarify that `--check` opens no user/persistent database.
- In `scripts/access-browser-check.cjs` and `scripts/local-workflows-check.cjs`, use Chromium by default; select `CRM_BROWSER_CHANNEL` only when explicitly supplied. Agree file ownership with Praveen to avoid duplicate edits.
- In those two runners and `scripts/verify-local.cjs`, let each new result record `process.env.CRM_TEST_EXECUTOR || 'Unspecified executor'`. Preserve original historical evidence. Remove the verification wrapper's forced Edge fallback; keep full-suite real AI disabled.
- Exclude private launcher configuration and private/runtime folders from the verification wrapper's source manifest.
- Add a separately named `test:integration-prep` script for `node --test integration-prep/test/prep.test.cjs` and an explicit CI step. These tests are synthetic preparation, not live Phase 1.
- Update README/setup instructions for fresh source installation; this source ZIP does not include bundled dependencies or model files. Original included README/START_HERE describe the local assembly and must be reconciled for the review branch.

## Install and verify after corrections

Run from the repository root with Node.js 24:

```powershell
npm.cmd ci
npm.cmd ci --prefix backend
npx.cmd playwright install chromium
$env:CRM_TEST_EXECUTOR = 'Imran - developer verification'
npm.cmd run verify
npm.cmd run test:integration-prep
node scripts/start-crm.cjs --no-ai --no-open --check
node scripts/start-crm.cjs --no-ai --no-open
```

The local address is `http://127.0.0.1:3192/`. Stop only a known existing CRM using that copy's own STOP launcher if the port is occupied. Do not expose the server publicly or bypass the local safeguards.

The real AI runtime must be configured separately on a suitable machine. On Sourav's existing laptop it is under `C:/Users/SOURXV/Desktop/KIT700/SPRINT3/AI_RUNTIME_PILOT_15_SEPTEMBER_2026`. Keep machine-specific `launcher.config.json` uncommitted. Once the reviewed runtime is ready and no other generation is running, `CRM_TEST_LIVE_AI=true` enables the separate `node scripts/access-browser-check.cjs` genuine-model check. Do not enable this mode for the whole suite/CI or run overlapping inference.

## Required outcomes and handoff

Verify campaign/banner atomic saving, persistent uploads, linked/consented lead capture and retries, pipeline history, backend role/session controls, restart persistence, safe exports and isolated backup/restore. Provide actual results, full source SHA, clean/dirty state and known limitations. Ratna reviews the submitted changes. After accepted combined inclusion, Imran verifies that exact combined SHA and supplies setup/test evidence to Sushan for independent QA. Sourav retains the final release/merge decision; do not merge into main autonomously.

Update `DCRM2-22` with backend/setup/developer evidence and link `DCRM2-18` for source/release coordination. Do not represent a prepared ZIP, developer checks, or a synthetic simulator as independent QA or client acceptance.

## Scope and timing

Final team delivery cutoff:20September2026,21:00 Sydney/Melbourne AEST. Developer submission target:19September14:00; exact combined QA handoff target:19September20:00. Report blockers promptly rather than skip required checks. Real Phase1 connection remains after21September and requires the actual approved contract/access. Public deployment/domain and direct social publishing are not established by this source handoff.

The source builds on the existing team repository and assistant-prepared local improvements. Existing attribution and notices remain intact. Human review, corrections and new executions should be attributed to their actual contributors. This archive is a source-review input, not a merged or accepted release.
