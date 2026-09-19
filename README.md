# Divinenet CRM

Modern local campaign and lead workspace with SQLite storage, inline reviewed AI/uploaded banners, campaign response forms, accounts and role permissions.

Run START-CRM.cmd, then open **http://127.0.0.1:3192/** and set up your administrator account. See [START_HERE.md](START_HERE.md) for use, backup, recovery and scope.

- Node.js 24 and npm are required.
- For a fresh source checkout, run `npm.cmd ci` and `npm.cmd --prefix backend ci`.
- Browser verification additionally requires `npx.cmd playwright install chromium`.
- STOP-CRM.cmd: safely stop this copy.
- BACKUP-CRM.cmd: new validated database snapshot.
- RESTORE-CRM.cmd "backup path": validate; add --apply after stopping to restore while retaining prior files.
- `npm.cmd run verify`: serial backend, browser, notification, banner, launcher, recovery, workflow, frontend-runtime, campaign-date and access checks. Chromium is the default; select Edge explicitly with `$env:CRM_BROWSER_CHANNEL='msedge'` in PowerShell. Source hashes and results are saved under `test-evidence/`.
- Run `npm.cmd run test:integration-prep` separately for the synthetic integration-contract checks.
- Genuine AI verification is separate: set CRM_TEST_LIVE_AI=true and run node scripts/access-browser-check.cjs with the reviewed runtime running. Do not overlap inference tests.

Working data: `data/divinenet.sqlite`. Local CRM: port 3192; separately configured image runtime: port 1234. The model/runtime is not included or downloaded automatically. Standalone backend debugging uses port 3194 and `backend/db/local-review.sqlite`; see `backend/README.md`.

External Phase 1/customer/appointment services, direct social publishing and public deployment are not connected in this local build; they remain separately gated requirements. Scheduled/Published campaign-library sections are filters, not a scheduler or proof of publication. Independent QA and client acceptance remain separate from engineering verification.

Campaign dates use Australia/Sydney for this demonstration build. New campaigns cannot start in the past; an existing campaign can keep its unchanged historical start date. Successful identical save retries use their stored receipt, including across midnight. The business timezone still requires approval for deployment.
