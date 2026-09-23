# Divinenet CRM Phase 2

Local campaign and lead workspace with SQLite storage, reviewed uploaded/AI banners, campaign response forms, accounts and role permissions. This integration brings the tested PR #29 local core to `main`; it is not a claim that the complete project, online delivery or new development features are finished.

## Download and start on Windows

GitHub **Code > Download ZIP** is a source download, not a ready-to-run installer. It does not contain Node.js, installed dependencies, AI models, accounts or workspace data.

1. Extract the ZIP into a new folder. Do not extract over your working demonstration folder or database.
2. Install Node.js 24 with npm separately if it is not already available.
3. Open PowerShell in the extracted folder containing `package.json` and `START-CRM.cmd`. Run these first-time setup commands:

   ```powershell
   npm.cmd ci
   npm.cmd --prefix backend ci
   ```

   Installation needs an Internet connection. If installation fails, resolve the reported error before launching; do not bypass security controls or change ports to hide a conflict.
4. Double-click **START-CRM.cmd**. After readiness succeeds, it opens **http://127.0.0.1:3192/#campaigns** in your browser. Keep the launcher window open.
5. Create the first administrator account on a fresh workspace, or sign in to an existing account when reopening the same folder. No preset password exists.
6. Double-click **STOP-CRM.cmd** when finished and wait for `Package CRM shutdown confirmed` before restarting.

After successful setup, normal use is **START-CRM.cmd > browser opens > sign in**. Opening `index.html` or clicking the local URL without a running server cannot start the connected CRM. A separately built and clean-machine-tested portable Windows ZIP is still required for a no-installation, extract-and-click download.

## Keep your records

Accounts, campaigns, leads and approved banners are stored in this folder's `data/divinenet.sqlite`. Restarting the same folder reuses that database. Extracting another copy creates a separate workspace; copies do not synchronise.

- **BACKUP-CRM.cmd** creates a new validated database snapshot.
- **RESTORE-CRM.cmd "backup path"** validates a selected backup. Stop the CRM before using `--apply`; retain the previous files and verify restored records.
- Do not overwrite or delete your working database, backup or evidence when downloading an update.
- Do not commit API keys, passwords, tokens, provider credentials, local databases, AI model files or other runtime secrets.

See [START_HERE.md](START_HERE.md) for workflows and recovery, and [scripts/LAUNCHER.md](scripts/LAUNCHER.md) for launcher configuration. [backend/README.md](backend/README.md) retains the separate developer/debugging setup and version-labelled schema evidence; its port 3194/database example is not the normal packaged workspace on port 3192.

## Version and verification

The application baseline is merged PR [#29](https://github.com/imranutas/divinenet-crm-phase2/pull/29), commit `f10c38a0de73c584eab43c7ea5c2065041ee0498`. Its discussion records Ratna's review, Sushan's scoped independent retest of `722e96769e8f885b790b63e7baa5caeb3294909a`, and Imran's post-merge verification. These historical results retain their original scope; this integration does not invent new human QA or client acceptance.

For developer verification after dependency installation:

```powershell
npx.cmd playwright install chromium
npm.cmd run verify
npm.cmd run test:integration-prep
```

Verification records source hashes/results under `test-evidence/`. Chromium is the default; Edge can be selected explicitly with `$env:CRM_BROWSER_CHANNEL='msedge'`. Automated synthetic checks do not establish genuine AI generation or live external connections.

## Remaining boundaries

- This is a local Windows-oriented release. `127.0.0.1` works only on the computer running it; merging to `main` does not publish a website or provide an examiner-accessible QR destination.
- Image AI requires the separately configured, reviewed runtime/model and compatible hardware. It is not included or downloaded automatically. `START-CRM.cmd --no-ai` starts the core without that runtime. Genuine AI verification remains separate; do not overlap inference tests.
- Phase 1/customer/appointment services, direct social publishing and public hosting are not connected in this baseline. Scheduled/Published library sections are filters, not a scheduler or proof of publication.
- New Text Draft/Social Draft, Content Calendar and Operational Reports development is not included merely because a local completion message exists; accessible source, integration and review are required.
- Campaign dates use Australia/Sydney. New campaigns cannot start in the past; an existing campaign can keep its unchanged historical start date. Successful identical save retries use the stored receipt. Public deployment configuration and acceptance remain separate.
