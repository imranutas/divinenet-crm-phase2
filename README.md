# Divinenet CRM

Modern local campaign and lead workspace with SQLite storage, inline reviewed AI/uploaded banners, campaign response forms, accounts and role permissions.

Run START-CRM.cmd, then open **http://127.0.0.1:3192/** and set up your administrator account. See [START_HERE.md](START_HERE.md) for use, backup, recovery and scope.

- Node.js 24 and npm are required.
- For a fresh source checkout, run `npm.cmd ci` and `npm.cmd --prefix backend ci` before starting the CRM.
- Browser verification additionally requires `npx.cmd playwright install chromium`.
- STOP-CRM.cmd: safely stop this copy.
- BACKUP-CRM.cmd: new validated database snapshot.
- RESTORE-CRM.cmd "backup path": validate; add --apply after stopping to restore while retaining prior files.
- `npm run verify` depends on the pending PR22 backend corrections and must be verified against the eventual accepted combined version. Browser checks use Chromium by default; Edge is used only when explicitly selected. Source hashes, logs and results are saved under `test-evidence/`.
- Genuine AI verification is separate: set CRM_TEST_LIVE_AI=true and run `node scripts/access-browser-check.cjs` with the reviewed runtime running. Do not overlap inference tests.

Final launcher: `http://127.0.0.1:3192/` using `data/divinenet.sqlite`.

Standalone backend debugging is separate: `http://127.0.0.1:3194/` using `backend\db\local-review.sqlite`. See `backend\README.md` for its environment and startup commands.

The AI model/runtime is not included in the source package and is not downloaded automatically.

External Phase1/customer/appointment services, direct social publishing and public deployment are excluded. Independent QA/client acceptance remain separate from engineering verification. Original member submissions are preserved; this local assembly is not a new GitHub commit.
