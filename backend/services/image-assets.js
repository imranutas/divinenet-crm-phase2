const { randomUUID } = require('node:crypto');
const { validatePng } = require('./png-validation');
const { createLocalImageProvider, validateImagePrompt, MAX_IMAGE_BYTES, GENERATION_TIMEOUT_MS } = require('./local-image-provider');
const { createImageRuntimeGuard } = require('./image-runtime-guard');

const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_DRAFTS = 8;
const MAX_DRAFT_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });

function readImageConfig(env = process.env) {
  return { provider: env.AI_IMAGE_PROVIDER || '', model: env.AI_IMAGE_MODEL || '',
    baseUrl: env.AI_IMAGE_BASE_URL || 'http://127.0.0.1:1234', approved: env.AI_LIVE_APPROVED === 'true' };
}

function attachAssetRoutes(app, { db, campaigns, imageProvider, imageConfig, now = Date.now }) {
  const config = imageConfig || readImageConfig();
  let provider = imageProvider && typeof imageProvider.generate === 'function' ? imageProvider : null;
  let configurationError = '';
  if (!provider && config.approved && config.provider === 'sd-cpp') {
    try { provider = createLocalImageProvider(config); }
    catch { configurationError = 'The local image runtime URL or model label is invalid.'; }
  }
  // Hosted/paid providers are deliberately not selected by this local-only release slice.
  const configured = !!provider;
  const mode = imageProvider && provider ? 'test-double' : (configured ? 'live-configured' : 'unavailable');
  const providerName = mode === 'test-double' ? 'test-double' : 'sd-cpp';
  const runtimeGuard = mode === 'live-configured' ? createImageRuntimeGuard(db) : null;
  db.exec('CREATE TABLE IF NOT EXISTS ai_generation_attempts(id TEXT PRIMARY KEY,created_at TEXT NOT NULL)');
  const fail = (res, status, message) => res.status(status).json({ success: false, message });
  const get = id => db.prepare('SELECT * FROM campaign_assets WHERE id=?').get(id);
  const metadata = row => ({ id: row.id, campaignId: row.campaign_id, prompt: row.prompt,
    provider: row.provider, model: row.model, status: row.status, createdAt: row.created_at,
    approvedAt: row.approved_at, imageUrl: '/api/assets/' + row.id + '/image', downloadUrl: '/api/assets/' + row.id + '/download' });
  const drafts = new Map();
  function prune() {
    for (const [id, draft] of drafts) if (draft.expires <= now()) drafts.delete(id);
  }
  function draftBytes() { return [...drafts.values()].reduce((sum, draft) => sum + draft.bytes.length, 0); }
  function requireDraft(id) {
    prune();
    const draft = drafts.get(id);
    if (!draft) throw problem(410, 'Banner draft expired or is no longer available. Generate and review a new banner.');
    return draft;
  }
  const draftMetadata = draft => ({ id: draft.id, prompt: draft.prompt, provider: draft.provider,
    model: draft.model, status: draft.status, createdAt: draft.createdAt, approvedAt: draft.approvedAt,
    expiresAt: new Date(draft.expires).toISOString(), imageUrl: '/api/banner-drafts/' + draft.id + '/image' });

  app.get('/api/ai/status', (_req, res) => res.json({ success: true, data: {
    configured, mode, provider: configured ? providerName : null, model: provider?.model || null,
    generationBlocked: !!runtimeGuard && runtimeGuard.state() !== 'Ready',
    draftLifetimeMinutes: 30, generationTimeoutSeconds: GENERATION_TIMEOUT_MS / 1000,
    message: mode === 'test-double' ? 'A controlled test provider is configured. This is not live AI.' :
      (runtimeGuard && runtimeGuard.state() !== 'Ready' ? 'The local image runtime is busy or needs an operator reset; do not submit another generation.' :
        configured ? 'Local image generation is configured. Runtime availability and image quality still need verification.' :
        configurationError || 'Local AI is unavailable until an approved local runtime and reviewed model are configured.')
  } }));
  app.get('/api/campaigns/:id/assets', (req, res) => {
    if (!campaigns.getById(req.params.id)) return fail(res, 404, 'Campaign not found');
    res.json({ success: true, data: db.prepare('SELECT * FROM campaign_assets WHERE campaign_id=? ORDER BY created_at DESC,id').all(req.params.id).map(metadata) });
  });

  let generating = false;
  async function generate(body) {
    const promptError = validateImagePrompt(body.prompt);
    if (promptError) throw problem(400, promptError);
    if (!configured) throw problem(503, 'AI image provider is not configured or approved');
    if (body.consentToSend !== true) throw problem(400, 'Confirm that the prompt may be sent to the configured provider');
    if (generating) throw problem(429, 'Another image is generating. Please wait.');
    const since = new Date(now() - 86400000).toISOString();
    const attempts = db.prepare('SELECT COUNT(*) AS total FROM ai_generation_attempts WHERE created_at>=?').get(since).total;
    if (attempts >= 10) throw problem(429, 'Local review limit of 10 image attempts per 24 hours reached');
    runtimeGuard?.begin();
    db.prepare('INSERT INTO ai_generation_attempts VALUES (?,?)').run(randomUUID(), new Date(now()).toISOString());
    generating = true;
    const controller = new AbortController();
    let timer;
    try {
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = Object.assign(new Error('Image generation timed out'), { name: 'TimeoutError' });
          controller.abort(error); reject(error);
        }, GENERATION_TIMEOUT_MS);
        timer.unref();
      });
      // No saved client/lead/contact fields are added to the reviewed prompt.
      const result = await Promise.race([provider.generate({ prompt: body.prompt.trim(), signal: controller.signal }), expired]);
      validatePng(result.bytes);
      runtimeGuard?.complete();
      return { bytes: result.bytes, provider: providerName, model: provider.model || 'synthetic-fixture', prompt: body.prompt.trim() };
    } catch (error) {
      // Closing the synchronous HTTP request does not prove sd-server cancelled its job.
      // Keep a persistent latch: even a CRM restart must not allow overlapping retries.
      runtimeGuard?.uncertain();
      throw problem(error.name === 'TimeoutError' ? 504 : 502, 'Image generation failed. No approved asset was created.');
    } finally { clearTimeout(timer); generating = false; }
  }
  function sendError(res, error) {
    return fail(res, error.status || 500, error.status ? error.message : 'The request could not be completed');
  }
  app.post('/api/banner-drafts/generate', async (req, res) => {
    try {
      prune();
      if (drafts.size >= MAX_DRAFTS || draftBytes() + MAX_IMAGE_BYTES > MAX_DRAFT_BYTES) {
        throw problem(429, 'Too many unsaved banners. Save or discard an existing banner before generating another.');
      }
      const result = await generate(req.body);
      const draft = { ...result, id: randomUUID(), status: 'Draft', createdAt: new Date(now()).toISOString(),
        approvedAt: null, expires: now() + DRAFT_TTL_MS };
      drafts.set(draft.id, draft);
      res.status(201).json({ success: true, data: draftMetadata(draft) });
    } catch (error) { sendError(res, error); }
  });
  app.get('/api/banner-drafts/:id/image', (req, res) => {
    try { res.type('png').send(requireDraft(req.params.id).bytes); }
    catch (error) { sendError(res, error); }
  });
  app.post('/api/banner-drafts/:id/approve', (req, res) => {
    try {
      const draft = requireDraft(req.params.id);
      if (req.body.reviewed !== true) throw problem(400, 'Confirm that you reviewed the image before approval');
      draft.status = 'Approved';
      draft.approvedAt ||= new Date(now()).toISOString();
      res.json({ success: true, data: draftMetadata(draft) });
    } catch (error) { sendError(res, error); }
  });
  app.delete('/api/banner-drafts/:id', (req, res) => {
    // This only discards temporary memory. It never deletes a saved campaign asset.
    drafts.delete(req.params.id);
    res.json({ success: true, message: 'Unsaved banner discarded' });
  });

  app.post('/api/campaigns/:id/assets/generate', async (req, res) => {
    if (!campaigns.getById(req.params.id)) return fail(res, 404, 'Campaign not found');
    try {
      const result = await generate(req.body);
      // The campaign may have been deleted while asynchronous generation was running.
      if (!campaigns.getById(req.params.id)) throw problem(409, 'Campaign no longer exists. No image was saved.');
      const id = randomUUID();
      db.prepare("INSERT INTO campaign_assets(id,campaign_id,prompt,provider,model,image_data,mime_type,status,created_at,approved_at) VALUES (?,?,?,?,?,?,?,'Draft',?,NULL)")
        .run(id, req.params.id, result.prompt, result.provider, result.model, result.bytes, 'image/png', new Date(now()).toISOString());
      res.status(201).json({ success: true, data: metadata(get(id)) });
    } catch (error) { sendError(res, error); }
  });
  app.post('/api/assets/:id/approve', (req, res) => {
    const asset = get(req.params.id);
    if (!asset) return fail(res, 404, 'Asset not found');
    if (req.body.reviewed !== true) return fail(res, 400, 'Confirm that you reviewed the image before approval');
    db.prepare("UPDATE campaign_assets SET status='Approved',approved_at=COALESCE(approved_at,?) WHERE id=?").run(new Date(now()).toISOString(), asset.id);
    res.json({ success: true, data: metadata(get(asset.id)) });
  });
  app.get('/api/assets/:id/image', (req, res) => {
    const asset = get(req.params.id);
    if (!asset) return fail(res, 404, 'Asset not found');
    res.type('png').send(asset.image_data);
  });
  app.get('/api/assets/:id/download', (req, res) => {
    const asset = get(req.params.id);
    if (!asset) return fail(res, 404, 'Asset not found');
    if (asset.status !== 'Approved') return fail(res, 409, 'Review and approve this image before export');
    res.type('png').attachment('campaign-' + asset.id + '.png').send(asset.image_data);
  });

  return {
    // Run inside the campaign write transaction. Clear memory only after commit.
    attachApprovedDraft(id, campaignId) {
      if (id === undefined) return;
      if (typeof id !== 'string' || !UUID.test(id)) throw problem(400, 'bannerDraftId must be a UUID');
      const existing = get(id);
      if (existing) {
        if (existing.campaign_id !== campaignId) throw problem(409, 'This banner is already saved against another campaign');
        if (existing.status !== 'Approved') throw problem(409, 'Review and approve the banner before saving');
        return;
      }
      const draft = requireDraft(id);
      if (draft.status !== 'Approved') throw problem(409, 'Review and approve the banner before saving');
      db.prepare('INSERT INTO campaign_assets(id,campaign_id,prompt,provider,model,image_data,mime_type,status,created_at,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, campaignId, draft.prompt, draft.provider, draft.model, draft.bytes, 'image/png', draft.status, draft.createdAt, draft.approvedAt);
    },
    releaseSavedDraft(id) { if (id !== undefined) drafts.delete(id); }
  };
}

module.exports = { readImageConfig, attachAssetRoutes, DRAFT_TTL_MS, MAX_DRAFTS, MAX_DRAFT_BYTES };
