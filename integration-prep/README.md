# Local integration preparation — synthetic only

Assistant-prepared on 18 September 2026, not a member contribution, independent QA or client acceptance. This isolated kit does **not** connect the CRM to Phase 1, change its UI/authentication, import its records or open its database. Existing product test evidence remains separate.

## Run

Use the already installed Node 24 and this CRM copy's existing Express dependency. No install, download, paid service, external public demo API or new dependency is needed. From PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\SOURXV\Desktop\KIT700\SPRINT3\LOCAL_READY_18_SEPTEMBER_2026\Divinenet-CRM\integration-prep'
node --test test/prep.test.cjs
node demo.cjs
```

The demo starts a random **127.0.0.1-only** port, creates fictional lead/customer records, injects an appointment failure, then retries using the same keys. It prints the partial and retried results and always closes its own service. No credential is printed or saved. The test command runs only this kit, not the product regression suite.

Optional standalone health inspection:

```powershell
node simulator.cjs
```

Open only the printed `/api/health` address. Stop with Ctrl+C. Authenticated examples run through `demo.cjs` in their own separate instance; standalone credentials deliberately are not displayed or exported. No background service is installed.

## What is supplied and what is proposed

The user's `C:/Users/SOURXV/Downloads/api list.txt` supplies `GET /api/health` and `POST /api/customers`, `/api/leads`, `/api/appointments`. **All payload fields, response formats, test authentication and retry/appointment rules here are provisional inventions for synthetic testing.** This kit implements no login or conversion endpoint and must not substitute lead validation for conversion.

- `openapi.proposed.json`: proposed request/response documentation and labelled fictional examples. JSON parsing/local reference checks are provided, not a full external OpenAPI validator or proof of the actual Phase 1 contract. Optional Swagger UI is not installed or required.
- `contract.cjs`: small fixture validator and fictional sample data. Only `Fictional ...` names, `fixture-...` source references and `example.invalid` addresses are accepted for person fixtures. These labels reduce accidental misuse; they do not automatically detect all real personal information. Never put real data into this kit.
- `simulator.cjs`: existing Express, runtime-generated token/instance marker and in-memory Maps. No disk writes or SQLite file. No CORS/browser access; authenticated writes require both test headers. Failures are injected only by an in-process method, never a remote control route.
- `client.cjs`: backend-only client accepts only the simulator's opaque active connection object, not a URL/environment override. No external hosts, DNS aliases, redirects or real Phase 1 mode. It validates actual acknowledgements and distinguishes timeout/uncertain writes from success.
- `demo.cjs` and `test/prep.test.cjs`: runnable examples and independent test cases for this kit alone.

## Provisional retry and partial-result behaviour

Each creation requires an `Idempotency-Key`, scoped to that route. An identical payload with the same key replays the original record; a changed payload returns 409. JSON property order is ignored. Timeouts or malformed success responses may mean the server committed: retain the original key and resolve the uncertain result; never silently invent a new key or claim success.

The two-step exercise records a confirmed synthetic customer separately from an unconfirmed/failed appointment. It neither rolls back that customer nor claims both succeeded. It is **not** approved conversion policy, a distributed transaction or a live appointment workflow. Durations, UTC dates and references are fixture choices; there is no availability, staff/service allocation, consent or real conflict policy.

All records, credentials and retry receipts disappear when a simulator instance closes. This kit proves neither persistence/recovery nor exactly-once delivery across restarts. Rate limits, production security, HTTPS, retention, load and full contract conformance are outside this small preparation harness. The credential capability is an accidental-misconfiguration guard, not a security boundary against malicious code in the same Node process.

## Real connection gate

Sourav directs real Phase 1 integration only **after 21 September 2026**: 22 September is the earliest planned start, not guaranteed completion. Continue collecting the actual test URL, authorised access/auth format, real request/response examples, ownership/transfer rules, idempotency/failure semantics and appointment rules through **Ignatius** now. Never contact the Phase 1 team directly without changed permission. Do not enter actual credentials into this kit or remove its guards to make a live connection.

After receipt, Imran can prepare a separately reviewed real transport against the actual contract; Ratna reviews schema/mapping, Biraj confirms business rules, and Sushan independently tests the exact agreed build. Keep the current CRM admin/session/role controls. Mock passes cannot close C16/C23 or establish client acceptance. No new project/source licence or public release is implied; this kit only reuses the already provided local open-source runtime/dependency.

## Customer read preparation added 23 September 2026

The synthetic-only preparation harness now also provides provisional customer read behaviour for frontend/integration development. This does not establish the real Phase 1 response contract and does not enable a genuine Phase 1 connection.

### Provisional customer reads

- `GET /api/customers`
  - Requires the simulator test authentication.
  - Optional `search` filters the synthetic `displayName` and `email`.
  - `page` defaults to 1.
  - `pageSize` defaults to 20 and is limited to 1-100.
  - Returns `dataOrigin: "synthetic-test-data"`, `records`, and pagination metadata.
  - Empty results are valid and are returned as an empty records array.

- `GET /api/customers/:id`
  - Requires the simulator test authentication.
  - Accepts only the synthetic `sim-customer-{number}` identifier format.
  - Invalid identifiers are rejected.
  - Unknown synthetic customers return a not-found response.
  - Successful responses are explicitly labelled `dataOrigin: "synthetic-test-data"`.

These reads expose only records created inside the current in-memory simulator instance. They are not Phase 1 customer records and must never be labelled as verified live data.

### Customer CSV preparation

`customer-csv.cjs` provides a provisional customer CSV serializer for customer records supplied to it. Current permitted columns are:

`ID, Name, Email`

CSV values are quoted and embedded quotes are escaped. Values beginning with spreadsheet-formula characters are prefixed to reduce CSV formula-injection risk.

The helper does not decide UI export scope. The combined frontend must explicitly define whether export means the displayed page or all filtered customer records. It must use customer records returned through the customer contract and must not rename CRM leads as customers. Existing campaign and lead CSV behaviour remains separate and unchanged.

### Verification

The integration-preparation test suite currently covers the original synthetic write/retry/failure behaviour plus customer empty results, search, pagination, detail lookup, unknown customer handling, invalid local pagination, and customer CSV formula protection.

Latest developer run on 23 September 2026:

`21 tests, 21 passed, 0 failed`

This result applies only to the synthetic integration-preparation harness. It is not evidence of a genuine Phase 1 connection or client acceptance.

### Current integration status

**Test data:** available through the local synthetic-only simulator.

**Verified live:** not configured or verified.

A genuine connection remains disabled until the authorised Phase 1 address, authentication/credentials, exact request and response formats, permissions, filtering/pagination behaviour, and failure semantics are supplied and reviewed. A failed genuine request must never silently fall back to synthetic test data.
