# Divinenet CRM

Modern local campaign and lead workspace with SQLite storage, inline reviewed AI/uploaded banners, campaign response forms, accounts and role permissions.

Run START-CRM.cmd, then open **http://127.0.0.1:3192/** and set up your administrator account. See [START_HERE.md](START_HERE.md) for use, backup, recovery and scope.

- Node.js24; bundled matching Windowsx64 dependencies.
- STOP-CRM.cmd: safely stop this copy.
- BACKUP-CRM.cmd: new validated database snapshot.
- RESTORE-CRM.cmd "backup path": validate; add --apply after stopping to restore while retaining prior files.
- npm run verify: serial backend/browser/notification/banner/startup/recovery/intake/access checks using Edge. Source hashes, logs and results are saved under test-evidence/.
- Genuine AI verification is separate: set CRM_TEST_LIVE_AI=true and run node scripts/access-browser-check.cjs with the reviewed runtime running. Do not overlap inference tests.

Working data: data/divinenet.sqlite. Local CRM3192, local image runtime1234. No automatic model download or paid service.

External Phase1/customer/appointment services, direct social publishing and public deployment are excluded. Independent QA/client acceptance remain separate from engineering verification. Original member submissions are preserved; this local assembly is not a new GitHub commit.
