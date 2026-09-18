const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { validateLead } = require('../validation');

const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });

function attachIntakeRoutes(app, { db, campaigns, leads, nextId, now = Date.now }) {
  // Tokens are private capabilities, not a public campaign directory. This server remains loopback-only.
  // SET NULL keeps a durable retry tombstone when an operator deletes a captured lead.
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_intake_links (
      token TEXT PRIMARY KEY, campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_intake_receipts (
      token TEXT NOT NULL REFERENCES campaign_intake_links(token) ON DELETE CASCADE,
      request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(token, request_id)
    );
    CREATE TABLE IF NOT EXISTS campaign_intake_limits (
      token TEXT PRIMARY KEY REFERENCES campaign_intake_links(token) ON DELETE CASCADE,
      window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_intake_receipts_time ON campaign_intake_receipts(token, created_at);
  `);
  const lookup = token => TOKEN.test(token) ? db.prepare(`SELECT l.token,l.campaign_id,c.campaign_name,c.status
    FROM campaign_intake_links l JOIN campaigns c ON c.id=l.campaign_id WHERE l.token=?`).get(token) : null;
  const limit = db.transaction(token => {
    const start = Math.floor(now() / 60000) * 60000;
    db.prepare(`INSERT INTO campaign_intake_limits(token,window_start,attempts) VALUES (?,?,1)
      ON CONFLICT(token) DO UPDATE SET window_start=excluded.window_start,
        attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END`).run(token, start);
    return db.prepare('SELECT attempts FROM campaign_intake_limits WHERE token=?').get(token).attempts <= 30;
  });
  const save = db.transaction((link, body) => {
    const payload = { name: body.name.trim(), email: body.email.trim().toLowerCase(), phone: (body.phone || '').trim(), consent: true };
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const requestId = body.clientRequestId.toLowerCase();
    const prior = db.prepare('SELECT * FROM campaign_intake_receipts WHERE token=? AND request_id=?').get(link.token, requestId);
    if (prior) {
      if (prior.payload_hash !== digest) throw problem(409, 'This submission ID was used with different information. Start a new submission.');
      if (!prior.lead_id) throw problem(410, 'This response was removed. It will not be created again by retrying.');
      return { received: true, receiptId: prior.receipt_id, replayed: true };
    }
    // Re-read within the write lock: a second app instance may have paused the campaign since lookup.
    if (campaigns.getById(link.campaign_id)?.status !== 'Active') throw problem(409, 'This campaign is not accepting responses.');
    const since = new Date(now() - 3600000).toISOString();
    if (db.prepare('SELECT COUNT(*) AS n FROM campaign_intake_receipts WHERE token=? AND created_at>=?').get(link.token, since).n >= 100) {
      throw problem(429, 'This local response form has reached its hourly limit. Please try later.');
    }
    const stamp = new Date(now()).toISOString();
    const lead = leads.create({ id: nextId('lead', 'LEAD-'), campaignId: link.campaign_id,
      ...payload, sourcePlatform: 'Website', consentStatus: 'Recorded', stage: 'New', score: null,
      scorePolicyVersion: null, createdAt: stamp, updatedAt: stamp });
    const receiptId = randomUUID();
    db.prepare('INSERT INTO campaign_intake_receipts(token,request_id,payload_hash,receipt_id,lead_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(link.token, requestId, digest, receiptId, lead.id, stamp);
    return { received: true, receiptId, replayed: false };
  });
  const respondError = (res, error) => res.status(error.status || 500).json({ success: false,
    message: error.status ? error.message : 'The response could not be saved. Please try again with the same submission.' });

  app.post('/api/campaigns/:id/intake-link', (req, res) => {
    if (!campaigns.getById(req.params.id)) return res.status(404).json({ success: false, message: 'Campaign not found' });
    // Stable links survive restart. Creating a link does not activate a campaign or submit a lead.
    db.prepare('INSERT OR IGNORE INTO campaign_intake_links(token,campaign_id,created_at) VALUES (?,?,?)')
      .run(randomBytes(32).toString('hex'), req.params.id, new Date(now()).toISOString());
    const link = db.prepare('SELECT token FROM campaign_intake_links WHERE campaign_id=?').get(req.params.id);
    res.json({ success: true, data: { url: '/capture/' + link.token } });
  });
  app.get('/api/capture/:token', (req, res) => {
    const link = lookup(req.params.token);
    if (!link) return res.status(404).json({ success: false, message: 'Response form not found' });
    res.json({ success: true, data: { campaignName: link.campaign_name, status: link.status } });
  });
  app.post('/api/capture/:token', (req, res) => {
    const link = lookup(req.params.token);
    if (!link) return res.status(404).json({ success: false, message: 'Response form not found' });
    if (!limit(link.token)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ success: false, message: 'Too many submissions. Please wait a minute and try again.' });
    }
    try {
      const body = req.body;
      if (Object.keys(body).some(key => !['name', 'email', 'phone', 'consent', 'clientRequestId'].includes(key))) {
        throw problem(400, 'The response contains unsupported fields');
      }
      if (body.consent !== true) throw problem(400, 'Consent is required before submitting a response');
      if (typeof body.clientRequestId !== 'string' || !UUID.test(body.clientRequestId)) throw problem(400, 'clientRequestId must be a UUID');
      const error = validateLead({ ...body, campaignId: link.campaign_id, sourcePlatform: 'Website', consentStatus: 'Recorded' });
      if (error) throw problem(400, error);
      if (body.name.length > 200 || (body.phone || '').length > 50) throw problem(400, 'Name or phone number is too long');
      const result = save.immediate(link, body);
      res.status(result.replayed ? 200 : 201).json({ success: true, data: { received: true, receiptId: result.receiptId } });
    } catch (error) { respondError(res, error); }
  });
}

module.exports = { attachIntakeRoutes };
