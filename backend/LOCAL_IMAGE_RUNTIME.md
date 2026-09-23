# Local campaign banner workflow

Prepared 13 September 2026. This describes the new local review implementation, not a live-model success or client acceptance. The existing backend README and Imran's separately submitted setup work should be reviewed together, not overwritten.

## What is implemented

The user can generate and review a temporary banner before saving a campaign. Only the entered/reviewed image prompt is sent to the runtime. Lead names, emails and other stored contact fields are not automatically added. A saved campaign and its approved banner are written in one SQLite transaction. Failed validation/storage leaves neither a partial campaign nor a partial asset. Approved saved images can be reopened and downloaded through the existing campaign assets routes.

Unsaved draft images exist only in CRM process memory: maximum eight drafts, a 32 MiB total reservation limit, and a 30-minute lifetime from generation. They are lost when CRM restarts. The UI must explain this and require regeneration after a missing/expired draft (HTTP 410). Regeneration creates a fresh, unapproved draft; approval of an earlier image does not approve a replacement. Discarding a temporary draft never deletes a saved campaign asset.

## Provider and approval boundary

Only the local `sd-cpp` adapter is selectable in this slice; a hosted OpenAI key is not read and paid-provider configurations remain unavailable. The adapter uses the documented stable-diffusion.cpp compatibility endpoint, not the OpenAI service:

- `POST http://127.0.0.1:1234/v1/images/generations` (operator-selected loopback port allowed).
- Fixed controls: one PNG, `768x512`; response must contain exactly one `b64_json` image.
- Only HTTP origins with literal `127.0.0.1` or `[::1]` are accepted. No remote hosts, embedded credentials, custom paths or redirects.
- Prompt length 1–4000; runtime-control `sd_cpp_extra_args` strings rejected.
- Encoded response size is bounded, PNG checksums/dimensions/pixels validated, maximum stored PNG size 10 MiB.
- One generation at a time, ten attempted generations per rolling 24 hours, 120-second request deadline.
- Format validation does not establish image suitability, rights or safety; human review remains required.

Primary API reference: [stable-diffusion.cpp server API](https://github.com/leejet/stable-diffusion.cpp/blob/master/examples/server/api.md). Record the actual runtime commit/version and licence, selected model source/revision/checksum and licence/usage terms before downloading/running weights. A downloadable model is not automatically free/open-source or approved by the client.

No runtime/model is downloaded or installed by the CRM. The operator must have reviewed resources and start the separate loopback-only image server. The configured model value below records provenance; the compatibility endpoint does not prove that the loaded weights match that label. Verify the actual runtime startup and model checksum separately.

After model/runtime review and a real runtime setup, use the existing project startup instructions with these explicit environment values in the same PowerShell session:

```powershell
$env:CRM_ENABLE_LIVE_AI = "true"
$env:AI_LIVE_APPROVED = "true"
$env:AI_IMAGE_PROVIDER = "sd-cpp"
$env:AI_IMAGE_BASE_URL = "http://127.0.0.1:1234"
$env:AI_IMAGE_MODEL = "REPLACE_WITH_REVIEWED_MODEL_AND_EXACT_REVISION"
```

Do not set approval flags simply to hide the unavailable warning. Keep `CRM_ENABLE_LIVE_AI=false` until prerequisites are met. `/api/ai/status` reports configuration only: `live-configured` does not mean a successful generation or an approved release. Test-injected providers are explicitly reported as `test-double`.

## Timeout and runtime recovery

Closing a synchronous image request does not prove that sd-server stopped generating. On a live-runtime error/timeout, or if CRM stops mid-generation, a persistent `ai_runtime_guard` blocks new generation requests. Restarting CRM alone does not clear this guard. A controlled test provider does not use the live-runtime guard.

To recover, the operator must:

1. Stop both the separate image runtime and CRM. Do not kill an unrelated process.
2. Keep `AI_IMAGE_BASE_URL`, `PORT` and `CRM_DATABASE_PATH` set to those exact local review services/database.
3. From the project root run:

```powershell
node backend/reset-image-runtime.js --confirm-runtime-stopped
```

4. The recovery command verifies that both configured loopback ports refuse connections. It refuses recovery if a service is listening, the check times out, the database does not exist, or no runtime guard exists. It only resets the guard; it does not remove campaign/banner records or change the daily limit.
5. Restart the reviewed image runtime, then CRM. Generate again only after checking the first job has stopped. Previously unsaved draft images require regeneration after CRM restart.

## Browser/API contract

Responses use `{ success: true, data: ... }` or `{ success: false, message: ... }`.

| Action | Endpoint and input | Result |
|---|---|---|
| Generate unsaved banner | `POST /api/banner-drafts/generate` with `{prompt, consentToSend:true}` | 201 draft metadata: id, prompt, Draft status, provider, model, createdAt, approvedAt, expiresAt, imageUrl |
| Preview | `GET /api/banner-drafts/:id/image` | Validated PNG, or 410 missing/expired |
| Approve | `POST /api/banner-drafts/:id/approve` with `{reviewed:true}` | Approved metadata |
| Discard | `DELETE /api/banner-drafts/:id` | Temporary memory cleared; saved assets untouched |
| Create with approved banner | Existing `POST /api/campaigns` fields plus optional `bannerDraftId` and `clientRequestId` UUID | 201 first save, 200 identical retry, same campaign ID |
| Update and attach approved banner | Existing `PUT /api/campaigns/:id` with optional `bannerDraftId` and `clientRequestId` UUID | 200; one attachment for an identical retry |
| List/reopen/export | Existing `/api/campaigns/:id/assets`, `/api/assets/:id/image`, `/api/assets/:id/download` | Persistent metadata/PNG; export requires Approved |

Use one fresh `clientRequestId` per intended save and keep it for a lost-response retry. Reusing it with changed information returns 409 instead of overwriting or duplicating work. `campaign_save_requests` (migration 4) has a campaign foreign key with ON DELETE SET NULL: deleted records leave a retry tombstone, so replay cannot silently recreate them. Request receipt checks and campaign/asset writes are transactional. No idempotency header is needed.

## Verification and remaining evidence

The backend tests cover local adapter request/response validation, unavailable/paid-provider rejection, prompt controls, concurrency/daily/draft limits, draft approval/expiry/restart, campaign-and-banner rollback/retry/reopen, update attachment and the uncertain-runtime recovery guard. Synthetic PNGs and timeout/network doubles are labelled in the tests. They do not establish live image quality or performance.

Still required: approved real model/runtime and resource check, actual generated image review, measured generation latency on target hardware, independent member review/QA of the exact integrated commit, and client acceptance. Authentication, public deployment and production use are not enabled by this change.
