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

```powershell
$env:CRM_ENABLE_LIVE_AI="false"
$env:NODE_ENV="development"
$env:PORT="3193"
npm.cmd start
```

Open:

`http://127.0.0.1:3193/`

Opening `index.html` directly does not start the connected backend. The CRM must be started using `npm.cmd start`.

## Database

The application uses SQLite for persistent campaign and lead data.

For an isolated development or verification database:

```powershell
$env:CRM_DATABASE_PATH="C:\temp\divinenet-review.sqlite"
```

The database location is controlled by the `CRM_DATABASE_PATH` environment variable.

To restart using the same data, keep the same `CRM_DATABASE_PATH` value and run:

```powershell
npm.cmd start
```

Do not create a new database path when checking persistence across a restart.

## Run Automated Tests

From the repository root:

```powershell
$env:CRM_TEST_EXECUTOR="Mohammed Abdul Imran - developer verification"
npm.cmd test
```

The automated test runner uses its own temporary test database/server and does not require the manual verification database.

## Service Availability

When the backend is running, the CRM should show its connected/available state.

If the backend is stopped or unavailable, connected campaign and lead operations will not work and the interface should indicate that the service is unavailable.

## Configuration

Important environment variables:

- `PORT` – local application port.
- `CRM_DATABASE_PATH` – SQLite database location.
- `CRM_ENABLE_LIVE_AI` – controls whether approved live AI configuration may be used.
- `NODE_ENV` – runtime environment.

Example local development configuration:

```powershell
$env:CRM_DATABASE_PATH="C:\temp\divinenet-review.sqlite"
$env:CRM_ENABLE_LIVE_AI="false"
$env:NODE_ENV="development"
$env:PORT="3193"
npm.cmd start
```

Do not commit API keys, passwords, tokens, provider credentials, or `.env` secrets to the repository.

## Current Integration Limitations

- Live AI is disabled unless approved provider configuration and access are supplied and verified.
- Test doubles do not demonstrate a live AI integration.
- Phase 1 customer/appointment integration is not yet verified against approved live endpoints.
- Direct social publishing is not yet verified.
- Authentication is not currently claimed as completed.
- Deployment is not currently claimed as completed.
- Production security, load testing and client acceptance are not currently claimed as completed.

Development verification uses synthetic/testing data unless explicitly stated otherwise.