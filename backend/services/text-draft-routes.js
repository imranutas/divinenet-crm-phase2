'use strict';

const { createContentWorkflow } = require('./content-workflow');
const { createTextRuntimeGuard } = require('./text-runtime-guard');

function attachTextDraftRoutes(app, { db, provider = null, accessEnabled = false } = {}) {
  const workflow = createContentWorkflow({ provider });
  const guard = createTextRuntimeGuard(db);
  // Route-level fail-closed check also protects legacy no-auth app instances.
  const authorised = (req, res, next) => {
    if (!accessEnabled || !req.localUser) return res.status(401).json({ success: false, message: 'Sign in to use text drafts.' });
    next();
  };
  app.get('/api/text-drafts/status', authorised, (_req, res) => res.json({ success: true, data: {
    configured: Boolean(provider), readiness: provider ? 'Configured, not yet verified' : 'Not configured',
    requiresHumanApproval: true, savesAutomatically: false, publishes: false, runtimeState: guard.state()
  } }));
  app.post('/api/text-drafts', authorised, async (req, res) => {
    if (!['admin', 'editor'].includes(req.localUser.role)) return res.status(403).json({ success: false, message: 'Editor access is required.' });
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['prompt', 'brand', 'channel'].includes(key)) ||
        typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 4000 ||
        (body.brand !== undefined && (typeof body.brand !== 'string' || body.brand.length > 120)) ||
        (body.channel !== undefined && (typeof body.channel !== 'string' || body.channel.length > 40))) {
      return res.status(400).json({ success: false, message: 'Provide a brief (1–4000 characters), optional brand (120) and channel (40).' });
    }
    if (!provider) return res.status(503).json({ success: false, message: 'AI content provider is not configured' });
    const operation = guard.begin();
    if (!operation) return res.status(409).json({ success: false,
      message: 'A draft is running or previous execution is uncertain. Stop the local model and CRM and follow the documented text-runtime recovery before retrying.' });
    try {
      const result = await workflow.generateContent(body);
      if (result.success) guard.complete(operation); else guard.uncertain(operation);
      res.status(result.statusCode).json(result);
    } catch {
      guard.uncertain(operation);
      res.status(502).json({ success: false, message: 'Local text generation could not be confirmed.' });
    }
  });
}

module.exports = { attachTextDraftRoutes };
