'use strict';

const { randomUUID, createHash } = require('node:crypto');

const CHANNELS = Object.freeze(['Facebook', 'Instagram', 'LinkedIn', 'Website']);
const STATUSES = Object.freeze(['Planned', 'Cancelled']);

const uuid = value =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const dateOnly = value =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z'));

const digest = value =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const failure = (res, status, message) =>
  res.status(status).json({ success: false, message });

const success = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });

function contentPlanSchema(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_plan (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        channel TEXT NOT NULL CHECK(channel IN ('Facebook','Instagram','LinkedIn','Website')),
        planned_date TEXT NOT NULL,
        social_draft_id TEXT REFERENCES social_drafts(id),
        social_draft_revision INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Planned'
          CHECK(status IN ('Planned','Cancelled')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_plan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_plan_id TEXT NOT NULL REFERENCES content_plan(id),
        action TEXT NOT NULL CHECK(action IN ('Created','Updated','Cancelled')),
        revision INTEGER NOT NULL,
        actor TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_content_plan_campaign
        ON content_plan(campaign_id);

      CREATE INDEX IF NOT EXISTS idx_content_plan_date
        ON content_plan(planned_date);

      CREATE INDEX IF NOT EXISTS idx_content_plan_history_item
        ON content_plan_history(content_plan_id,id);
    `);

    db.prepare(
      'INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (6,?)'
    ).run(new Date().toISOString());
  })();
}

function publicItem(row) {
  if (!row) return null;

  return {
    id: row.id,
    campaignId: row.campaign_id,
    channel: row.channel,
    plannedDate: row.planned_date,
    socialDraftId: row.social_draft_id || null,
    socialDraftRevision: row.social_draft_revision ?? null,
    notes: row.notes,
    status: row.status,
    revision: row.revision,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  };
}

function attachContentPlanRoutes(
  app,
  { db, accessEnabled = false, now = () => new Date() }
) {
  const clock = () => new Date(now()).toISOString();

  const requireRead = (req, res, next) => {
    if (!accessEnabled || !req.localUser) {
      return failure(res, 401, 'Sign in to use the content plan.');
    }
    next();
  };

  const requireWrite = (req, res, next) => {
    if (!['admin', 'editor'].includes(req.localUser.role)) {
      return failure(res, 403, 'Editor access is required.');
    }
    next();
  };

  const validate = (body, allowed) =>
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).every(key => allowed.includes(key));

  const find = id =>
    db.prepare('SELECT * FROM content_plan WHERE id=?').get(id);

  const campaignExists = id =>
    Boolean(db.prepare('SELECT id FROM campaigns WHERE id=?').get(id));

  const socialDraft = id =>
    id ? db.prepare('SELECT * FROM social_drafts WHERE id=?').get(id) : null;

  const record = (id, action, revision, actor, timestamp) =>
    db.prepare(`
      INSERT INTO content_plan_history(
        content_plan_id,action,revision,actor,occurred_at
      ) VALUES (?,?,?,?,?)
    `).run(id, action, revision, actor, timestamp);

  const withItem = (req, res, next) => {
    if (!uuid(req.params.id)) {
      return failure(res, 404, 'Content-plan item not found.');
    }

    req.contentPlanItem = find(req.params.id);

    if (!req.contentPlanItem) {
      return failure(res, 404, 'Content-plan item not found.');
    }

    next();
  };

  const validateDraftLink = body => {
    if (body.socialDraftId == null && body.socialDraftRevision == null) {
      return true;
    }

    if (!uuid(body.socialDraftId) ||
        !Number.isSafeInteger(body.socialDraftRevision) ||
        body.socialDraftRevision < 1) {
      return false;
    }

    const draft = socialDraft(body.socialDraftId);

    return Boolean(
      draft &&
      draft.revision === body.socialDraftRevision &&
      draft.status === 'Approved' &&
      draft.platform === body.channel
    );
  };

  app.get('/api/content-plan', requireRead, (_req, res) => {
    const rows = db.prepare(`
      SELECT * FROM content_plan
      ORDER BY planned_date ASC, created_at ASC, id ASC
    `).all();

    success(res, rows.map(publicItem));
  });

  const createItem = db.transaction((body, actor) => {
    const hash = digest({
      campaignId: body.campaignId,
      channel: body.channel,
      plannedDate: body.plannedDate,
      socialDraftId: body.socialDraftId || null,
      socialDraftRevision: body.socialDraftRevision || null,
      notes: (body.notes || '').trim()
    });

    const existing = db.prepare(
      'SELECT * FROM content_plan WHERE request_id=?'
    ).get(body.requestId);

    if (existing) {
      return existing.request_hash === hash
        ? { row: existing, replay: true }
        : { conflict: true };
    }

    const id = randomUUID();
    const timestamp = clock();

    db.prepare(`
      INSERT INTO content_plan(
        id,request_id,request_hash,campaign_id,channel,planned_date,
        social_draft_id,social_draft_revision,notes,status,revision,
        created_by,created_at,updated_by,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'Planned',1,?,?,?,?)
    `).run(
      id,
      body.requestId,
      hash,
      body.campaignId,
      body.channel,
      body.plannedDate,
      body.socialDraftId || null,
      body.socialDraftRevision || null,
      (body.notes || '').trim(),
      actor,
      timestamp,
      actor,
      timestamp
    );

    record(id, 'Created', 1, actor, timestamp);

    return { row: find(id) };
  });

  app.post('/api/content-plan', requireRead, requireWrite, (req, res) => {
    const body = req.body;

    if (!validate(body, [
      'requestId',
      'campaignId',
      'channel',
      'plannedDate',
      'socialDraftId',
      'socialDraftRevision',
      'notes'
    ])) {
      return failure(res, 400, 'Invalid content-plan fields.');
    }

    if (!uuid(body.requestId) ||
        typeof body.campaignId !== 'string' ||
        !campaignExists(body.campaignId) ||
        !CHANNELS.includes(body.channel) ||
        !dateOnly(body.plannedDate) ||
        (body.notes != null &&
          (typeof body.notes !== 'string' || body.notes.length > 2000))) {
      return failure(
        res,
        400,
        'Provide a valid campaign, channel, planned date, notes and UUID requestId.'
      );
    }

    if (!validateDraftLink(body)) {
      return failure(
        res,
        409,
        'Linked social draft must be the current approved revision for the same channel.'
      );
    }

    const result = createItem.immediate(body, req.localUser.username);

    if (result.conflict) {
      return failure(
        res,
        409,
        'That requestId was already used for different content.'
      );
    }

    success(res, publicItem(result.row), result.replay ? 200 : 201);
  });

  const updateItem = db.transaction((id, body, actor) => {
    const current = find(id);

    if (current.revision !== body.revision) return null;

    const timestamp = clock();
    const status = body.status || current.status;

    db.prepare(`
      UPDATE content_plan
      SET channel=?,
          planned_date=?,
          social_draft_id=?,
          social_draft_revision=?,
          notes=?,
          status=?,
          revision=revision+1,
          updated_by=?,
          updated_at=?
      WHERE id=?
    `).run(
      body.channel,
      body.plannedDate,
      body.socialDraftId || null,
      body.socialDraftRevision || null,
      (body.notes || '').trim(),
      status,
      actor,
      timestamp,
      id
    );

    record(
      id,
      status === 'Cancelled' && current.status !== 'Cancelled'
        ? 'Cancelled'
        : 'Updated',
      current.revision + 1,
      actor,
      timestamp
    );

    return find(id);
  });

  app.patch(
    '/api/content-plan/:id',
    requireRead,
    requireWrite,
    withItem,
    (req, res) => {
      const body = req.body;

      if (!validate(body, [
        'channel',
        'plannedDate',
        'socialDraftId',
        'socialDraftRevision',
        'notes',
        'status',
        'revision'
      ]) ||
          !CHANNELS.includes(body.channel) ||
          !dateOnly(body.plannedDate) ||
          !STATUSES.includes(body.status) ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 1 ||
          (body.notes != null &&
            (typeof body.notes !== 'string' || body.notes.length > 2000))) {
        return failure(
          res,
          400,
          'Provide channel, planned date, status and the current revision.'
        );
      }

      if (!validateDraftLink(body)) {
        return failure(
          res,
          409,
          'Linked social draft must be the current approved revision for the same channel.'
        );
      }

      const row = updateItem.immediate(
        req.params.id,
        body,
        req.localUser.username
      );

      if (!row) {
        return failure(
          res,
          409,
          'The content-plan item changed. Refresh before saving.'
        );
      }

      success(res, publicItem(row));
    }
  );

  app.get(
    '/api/content-plan/:id/history',
    requireRead,
    withItem,
    (req, res) => {
      const history = db.prepare(`
        SELECT action,revision,actor,occurred_at AS occurredAt
        FROM content_plan_history
        WHERE content_plan_id=?
        ORDER BY id ASC
      `).all(req.params.id);

      success(res, history);
    }
  );
}

module.exports = {
  CHANNELS,
  STATUSES,
  contentPlanSchema,
  attachContentPlanRoutes
};