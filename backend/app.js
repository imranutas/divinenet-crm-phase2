const express = require('express');
const path = require('node:path');
const { createDatabase } = require('./db/connection');
const { runMigrations } = require('./db/migrate');
const { createCampaignRepository } = require('./repositories/campaignRepository');
const { createLeadRepository } = require('./repositories/leadRepository');
const { createDirectoryRepository } = require('./repositories/directoryRepository');
const { validateStageTransition } = require('./services/lead-pipeline');
const { createAnalyticsService } = require('./services/analytics-service');
const { attachAssetRoutes } = require('./services/image-assets');
const { validateCampaign, validateLead, parseBudget } = require('./validation');

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const data = (res, value, status = 200) => res.status(status).json({ success: true, data: value });
const message = (res, value) => res.status(200).json({ success: true, message: value });
const optionalText = value => value ? String(value).trim() : '';

function toApiCampaign(row) {
  if (!row) return null;
  return {
    id: row.id, campaignName: row.campaign_name, prompt: row.prompt,
    client: row.client, clientId: row.client_id ?? null, brandId: row.brand_id ?? null,
    brand: row.brand, objective: row.objective, targetAudience: row.target_audience,
    startDate: row.start_date, endDate: row.end_date, budget: row.budget,
    channel: row.channel, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function toApiLead(row) {
  if (!row) return null;
  return {
    id: row.id, campaignId: row.campaign_id, name: row.name, email: row.email,
    phone: row.phone, sourcePlatform: row.source_platform, consentStatus: row.consent_status,
    stage: row.stage, score: row.score, scorePolicyVersion: row.score_policy_version,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function createApp(options = {}) {
  const app = express();
  const db = options.db || createDatabase(options.databasePath);
  runMigrations(db);
  const campaigns = createCampaignRepository(db);
  const leads = createLeadRepository(db);
  const directory = createDirectoryRepository(db);
  const analytics = createAnalyticsService(campaigns, leads);

  // This unauthenticated review server remains restricted to localhost.
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) {
      return fail(res, 403, 'This review server only accepts localhost requests');
    }
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin) {
      const allowed = ['http://' + req.get('host'), 'http://localhost:8080', 'http://127.0.0.1:8080'];
      if (!allowed.includes(origin)) return fail(res, 403, 'Origin is not allowed');
      res.set('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return fail(res, 415, 'Content-Type must be application/json');
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) &&
        (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      return fail(res, 400, 'Request body must be a JSON object');
    }
    next();
  });

  for (const [route, list, create] of [
    ['clients', directory.listClients, directory.createClient],
    ['brands', directory.listBrands, directory.createBrand]
  ]) {
    app.get('/api/' + route, (_req, res) => data(res, list()));
    app.post('/api/' + route, (req, res) => data(res, create(req.body.name), 201));
  }

  // Public ID counters survive deletion and server restart.
  for (const [name, rows, prefix] of [
    ['campaign', campaigns.getAll(), 'CAM-'], ['lead', leads.getAll(), 'LEAD-']
  ]) {
    const high = rows.reduce((max, row) => {
      const suffix = String(row.id).startsWith(prefix) ? String(row.id).slice(prefix.length) : '';
      return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
    }, 0);
    db.prepare('INSERT INTO app_sequences(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=MAX(value,excluded.value)').run(name, high);
  }
  const nextId = db.transaction((name, prefix) => {
    const row = db.prepare('UPDATE app_sequences SET value=value+1 WHERE name=? RETURNING value').get(name);
    return prefix + String(row.value).padStart(3, '0');
  });

  app.get('/api/health', (_req, res) => message(res, 'Divinenet CRM API is running'));
  app.get('/api/campaigns', (_req, res) => data(res, campaigns.getAll().map(toApiCampaign)));
  app.get('/api/campaigns/:id', (req, res) => {
    const row = campaigns.getById(req.params.id);
    if (!row) return fail(res, 404, 'Campaign not found');
    data(res, toApiCampaign(row));
  });
  app.post('/api/campaigns', (req, res) => {
    const body = req.body;
    const error = validateCampaign(body);
    if (error) return fail(res, 400, error);
    const now = new Date().toISOString();
    const saved = campaigns.create({
      id: nextId('campaign', 'CAM-'), clientId: body.clientId, brandId: body.brandId,
      campaignName: String(body.campaignName).trim(), prompt: String(body.prompt).trim(),
      client: optionalText(body.client), brand: optionalText(body.brand),
      objective: optionalText(body.objective), targetAudience: optionalText(body.targetAudience),
      startDate: body.startDate, endDate: body.endDate, budget: parseBudget(body.budget),
      channel: body.channel, status: body.status || 'Draft', createdAt: now, updatedAt: now
    });
    data(res, toApiCampaign(saved), 201);
  });
  app.put('/api/campaigns/:id', (req, res) => {
    const existing = campaigns.getById(req.params.id);
    if (!existing) return fail(res, 404, 'Campaign not found');
    const current = toApiCampaign(existing);
    const body = req.body;
    const updated = {
      ...current, ...body, id: current.id, createdAt: current.createdAt,
      clientId: Object.hasOwn(body, 'clientId') ? body.clientId : (Object.hasOwn(body, 'client') ? undefined : current.clientId),
      brandId: Object.hasOwn(body, 'brandId') ? body.brandId : (Object.hasOwn(body, 'brand') ? undefined : current.brandId),
      updatedAt: new Date().toISOString()
    };
    for (const field of ['client', 'brand']) {
      if (Object.hasOwn(body, field + 'Id') && !Object.hasOwn(body, field)) updated[field] = '';
    }
    const error = validateCampaign(updated);
    if (error) return fail(res, 400, error);
    updated.budget = parseBudget(updated.budget);
    for (const field of ['campaignName', 'prompt', 'client', 'brand', 'objective', 'targetAudience']) {
      if (typeof updated[field] === 'string') updated[field] = updated[field].trim();
    }
    data(res, toApiCampaign(campaigns.update(req.params.id, updated)));
  });
  app.delete('/api/campaigns/:id', (req, res) => {
    if (!campaigns.getById(req.params.id)) return fail(res, 404, 'Campaign not found');
    if (leads.countByCampaignId(req.params.id) > 0) {
      return fail(res, 409, 'Campaign cannot be deleted while leads are linked to it');
    }
    campaigns.remove(req.params.id);
    message(res, 'Campaign deleted successfully');
  });

  app.get('/api/leads', (req, res) => {
    if (req.query.campaignId !== undefined && typeof req.query.campaignId !== 'string') {
      return fail(res, 400, 'campaignId must be text');
    }
    data(res, leads.getAll(req.query.campaignId || null).map(toApiLead));
  });
  app.get('/api/leads/:id', (req, res) => {
    const row = leads.getById(req.params.id);
    if (!row) return fail(res, 404, 'Lead not found');
    data(res, toApiLead(row));
  });
  app.post('/api/leads', (req, res) => {
    const body = req.body;
    const error = validateLead(body);
    if (error) return fail(res, 400, error);
    if (!campaigns.getById(body.campaignId)) {
      return fail(res, 400, 'campaignId must reference an existing campaign');
    }
    const now = new Date().toISOString();
    const saved = leads.create({
      id: nextId('lead', 'LEAD-'), campaignId: body.campaignId,
      name: String(body.name).trim(), email: String(body.email).trim().toLowerCase(),
      phone: optionalText(body.phone), sourcePlatform: body.sourcePlatform,
      consentStatus: body.consentStatus, stage: 'New', score: null,
      scorePolicyVersion: null, createdAt: now, updatedAt: now
    });
    data(res, toApiLead(saved), 201);
  });
  app.put('/api/leads/:id', (req, res) => {
    const existing = leads.getById(req.params.id);
    if (!existing) return fail(res, 404, 'Lead not found');
    const current = toApiLead(existing);
    const updated = {
      ...current, ...req.body, id: current.id, createdAt: current.createdAt,
      // These fields remain server-owned even when included in the request.
      stage: current.stage, score: current.score, scorePolicyVersion: current.scorePolicyVersion,
      updatedAt: new Date().toISOString()
    };
    const error = validateLead(updated);
    if (error) return fail(res, 400, error);
    if (!campaigns.getById(updated.campaignId)) {
      return fail(res, 400, 'campaignId must reference an existing campaign');
    }
    updated.name = String(updated.name).trim();
    updated.email = String(updated.email).trim().toLowerCase();
    updated.phone = optionalText(updated.phone);
    data(res, toApiLead(leads.update(req.params.id, updated)));
  });
  app.patch('/api/leads/:id/stage', (req, res) => {
    const existing = leads.getById(req.params.id);
    if (!existing) return fail(res, 404, 'Lead not found');
    const transition = validateStageTransition(existing.stage, req.body.stage);
    if (!transition.allowed) return fail(res, 400, transition.message);
    data(res, toApiLead(leads.updateStage(req.params.id, req.body.stage, new Date().toISOString())));
  });
  app.delete('/api/leads/:id', (req, res) => {
    if (!leads.remove(req.params.id)) return fail(res, 404, 'Lead not found');
    message(res, 'Lead deleted successfully');
  });
  app.get('/api/analytics/summary', (_req, res) => data(res, analytics.getSummary()));
  app.get('/api/leads/:id/history', (req, res) => {
    if (!leads.getById(req.params.id)) return fail(res, 404, 'Lead not found');
    data(res, db.prepare('SELECT * FROM lead_stage_history WHERE lead_id=? ORDER BY changed_at,id').all(req.params.id));
  });
  attachAssetRoutes(app, { db, campaigns, imageProvider: options.imageProvider, imageConfig: options.imageConfig });

  // Expose only the chosen UI files, never the database or backend sources.
  const publicRoot = path.resolve(__dirname, '..');
  const publicFiles = {
    '/': 'index.html', '/index.html': 'index.html', '/apps.js': 'apps.js', '/style.css': 'style.css',
    '/lead-prototype.html': 'lead-prototype.html', '/lead-prototype.js': 'lead-prototype.js',
    '/lead-style.css': 'lead-style.css'
  };
  for (const [route, file] of Object.entries(publicFiles)) {
    app.get(route, (_req, res) => res.sendFile(path.join(publicRoot, file)));
  }
  app.use((_req, res) => fail(res, 404, 'Route not found'));
  app.use((error, _req, res, _next) => {
    let status = 500, text = 'The request could not be completed';
    if (error.type === 'entity.parse.failed') { status = 400; text = 'Malformed JSON request'; }
    else if (error.type === 'entity.too.large') { status = 413; text = 'Request body is too large'; }
    else if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') { status = 409; text = 'Record is linked to other records and cannot be deleted'; }
    else if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') { status = 409; text = 'Record already exists'; }
    else if (error.status === 400 || error.statusCode === 400) { status = 400; text = error.message; }
    fail(res, status, text);
  });
  return { app, db };
}

module.exports = { createApp };
