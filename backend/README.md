# Divinenet CRM Phase 2 – Combined Build Setup

## Requirements

- Node.js 24
- npm
- Chromium for Playwright browser checks

Run all commands below from the repository root unless stated otherwise.

## Install Dependencies

```powershell
npm.cmd ci
npm.cmd --prefix backend ci
npx.cmd playwright install chromium
```

## Start the CRM

From the repository root:

```powershell
$env:CRM_ENABLE_LIVE_AI="false"
$env:NODE_ENV="development"
$env:PORT="3194"
$env:CRM_DATABASE_PATH=Join-Path (Get-Location) "backend\db\local-review.sqlite"
npm.cmd start
```

Open the CRM in the browser at:

`http://127.0.0.1:3194/`

Port `3194` is the shared local example. The application port is configurable using the `PORT` environment variable.

Keep the server terminal open while using the CRM.

To stop only the running CRM server, press:

`Ctrl+C`

Opening `index.html` directly does not start the connected backend. The connected CRM must be started using `npm.cmd start`.

## Database

The application uses SQLite for persistent campaign and lead data.

The database location is controlled using the `CRM_DATABASE_PATH` environment variable.

The shared local example uses:

```powershell
$env:CRM_DATABASE_PATH=Join-Path (Get-Location) "backend\db\local-review.sqlite"
```

This creates/uses:

`backend\db\local-review.sqlite`

A new empty database can legitimately show zero campaign and lead records.

Do not overwrite an active database when performing verification.

## Restart With the Same Database

To verify persistence, first stop the running CRM server using:

`Ctrl+C`

When restarting in the same terminal, keep the same `CRM_DATABASE_PATH` and run:

```powershell
npm.cmd start
```

If using a new PowerShell terminal, set the environment variables again:

```powershell
$env:CRM_ENABLE_LIVE_AI="false"
$env:NODE_ENV="development"
$env:PORT="3194"
$env:CRM_DATABASE_PATH=Join-Path (Get-Location) "backend\db\local-review.sqlite"
npm.cmd start
```

Then open:

`http://127.0.0.1:3194/`

Using the same database path allows previously saved campaign and lead records to remain available after the server restart.

## Run Automated Tests

Open a separate terminal at the repository root and run:

```powershell
$env:CRM_TEST_EXECUTOR="Mohammed Abdul Imran - developer verification"
npm.cmd test
```

The automated test runner uses its own temporary test database/server and does not require the manual verification database.

Developer verification results must be recorded separately from Sushan's independent QA results.

## Service Availability

When the backend is running, the CRM should show its connected/available state.

If the backend is stopped or unavailable, connected campaign and lead operations will not work and the interface should indicate that the service is unavailable.

Double-clicking or directly opening `index.html` is not the connected startup method.

## Configuration

Important environment variables:

- `PORT` – local application port. Port `3194` is used as the shared example but the port is configurable.
- `CRM_DATABASE_PATH` – SQLite database location.
- `CRM_ENABLE_LIVE_AI` – controls whether approved live AI configuration may be used.
- `NODE_ENV` – runtime environment.
- `CRM_TEST_EXECUTOR` – identifies the developer running the automated verification.

Example local development configuration:

```powershell
$env:CRM_ENABLE_LIVE_AI="false"
$env:NODE_ENV="development"
$env:PORT="3194"
$env:CRM_DATABASE_PATH=Join-Path (Get-Location) "backend\db\local-review.sqlite"
npm.cmd start
```

Do not commit API keys, passwords, tokens, provider credentials, or `.env` secrets to the repository.

Live AI remains disabled unless approved provider configuration and access are supplied and verified.

## Current Integration Limitations

- Live AI is disabled unless approved provider configuration and access are supplied and verified.
- Test doubles do not demonstrate a live AI integration.
- Phase 1 customer/appointment integration is not yet verified against approved live endpoints.
- Direct social publishing is not yet verified.
- Authentication is not currently claimed as completed.
- Deployment is not currently claimed as completed.
- Production security, load testing and client acceptance are not currently claimed as completed.

Development verification uses synthetic/testing data unless explicitly stated otherwise.