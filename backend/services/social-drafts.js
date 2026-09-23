'use strict';

const { randomUUID, createHash } = require('node:crypto');

const PLATFORMS = Object.freeze(['Facebook', 'Instagram', 'LinkedIn']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (res, status, message) => res.status(status).json({ success: false, message });
const success = (res, data, status = 200) => res.status(status).json({ success: true, data });
const revisionIsValid = value => Number.isSafeInteger(value) && value >= 1;

function socialDraftSchema(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS social_drafts (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('Facebook','Instagram','LinkedIn')),
      content TEXT NOT NULL CHECK(length(content)>0 AND length(content)<=3000),
      status TEXT NOT NULL CHECK(status IN ('Draft','Approved')),
      revision INTEGER NOT NULL CHECK(revision>=1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      CHECK((status='Draft' AND approved_at IS NULL) OR (status='Approved' AND approved_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS social_draft_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id TEXT NOT NULL REFERENCES social_drafts(id),
      action TEXT NOT NULL CHECK(action IN ('Created','Edited','Approved')),
      revision INTEGER NOT NULL,
      actor TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS social_draft_events_draft ON social_draft_events(draft_id,id);`);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (5,?)').run(new Date().toISOString());
  })();
}

function publicDraft(row) {
  return { id: row.id, platform: row.platform, content: row.content, status: row.status,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, approvedAt: row.approved_at };
}

function attachSocialDraftRoutes(app, { db, accessEnabled = false, now = () => new Date() }) {
  const clock = () => new Date(now()).toISOString();
  const find = id => db.prepare('SELECT * FROM social_drafts WHERE id=?').get(id);
  const record = (id, action, revision, actor, timestamp) => db.prepare(
    'INSERT INTO social_draft_events(draft_id,action,revision,actor,occurred_at) VALUES (?,?,?,?,?)'
  ).run(id, action, revision, actor, timestamp);
  const requireRead = (req, res, next) => {
    if (!accessEnabled || !req.localUser) return failure(res, 401, 'Sign in to use social drafts.');
    next();
  };
  const requireWrite = (req, res, next) => {
    if (!['admin', 'editor'].includes(req.localUser.role)) return failure(res, 403, 'Editor access is required.');
    next();
  };
  const validate = (body, allowed) => body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).every(key => allowed.includes(key));
  const validContent = body => PLATFORMS.includes(body.platform) && typeof body.content === 'string' &&
    body.content.trim().length > 0 && body.content.length <= 3000;
  const withDraft = (req, res, next) => {
    if (!uuid(req.params.id)) return failure(res, 404, 'Social draft not found.');
    req.socialDraft = find(req.params.id);
    if (!req.socialDraft) return failure(res, 404, 'Social draft not found.');
    next();
  };
  app.get('/api/social-connections', requireRead, (_req, res) => success(res, PLATFORMS.map(platform => ({
    platform, connected: false, status: 'Not connected', canPublish: false
  }))));
  app.get('/api/social-drafts', requireRead, (_req, res) => success(res,
    db.prepare('SELECT * FROM social_drafts ORDER BY created_at DESC,id').all().map(publicDraft)));

  const create = db.transaction((body, actor) => {
    const hash = digest({ platform: body.platform, content: body.content.trim() });
    const existing = db.prepare('SELECT * FROM social_drafts WHERE request_id=?').get(body.requestId);
    if (existing) return existing.request_hash === hash ? { row: existing, replay: true } : { conflict: true };
    const id = randomUUID(), timestamp = clock();
    db.prepare(`INSERT INTO social_drafts(id,request_id,request_hash,platform,content,status,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,'Draft',1,?,?)`).run(id, body.requestId, hash, body.platform, body.content.trim(), timestamp, timestamp);
    record(id, 'Created', 1, actor, timestamp);
    return { row: find(id) };
  });
  app.post('/api/social-drafts', requireRead, requireWrite, (req, res) => {
    const body = req.body;
    if (!validate(body, ['platform', 'content', 'requestId']) || !validContent(body) || !uuid(body.requestId)) {
      return failure(res, 400, 'Choose a supported platform, text of 1–3000 characters and a UUID requestId.');
    }
    const result = create.immediate(body, req.localUser.username);
    if (result.conflict) return failure(res, 409, 'That requestId was already used for different content. Refresh before retrying.');
    success(res, publicDraft(result.row), result.replay ? 200 : 201);
  });

  const edit = db.transaction((id, body, actor) => {
    const row = find(id);
    if (row.revision !== body.revision) return null;
    if (row.platform === body.platform && row.content === body.content.trim()) return row;
    const timestamp = clock();
    db.prepare(`UPDATE social_drafts SET platform=?,content=?,status='Draft',revision=revision+1,updated_at=?,approved_at=NULL WHERE id=?`)
      .run(body.platform, body.content.trim(), timestamp, id);
    record(id, 'Edited', row.revision + 1, actor, timestamp);
    return find(id);
  });
  app.patch('/api/social-drafts/:id', requireRead, requireWrite, withDraft, (req, res) => {
    const body = req.body;
    if (!validate(body, ['platform', 'content', 'revision']) || !validContent(body) || !revisionIsValid(body.revision)) {
      return failure(res, 400, 'Provide platform, content of 1–3000 characters and the current revision.');
    }
    const row = edit.immediate(req.params.id, body, req.localUser.username);
    if (!row) return failure(res, 409, 'The draft changed. Refresh and review the latest version before saving.');
    success(res, publicDraft(row));
  });

  const approve = db.transaction((id, revision, actor) => {
    const row = find(id);
    if (row.revision !== revision) return null;
    if (row.status === 'Approved') return row;
    const timestamp = clock();
    db.prepare("UPDATE social_drafts SET status='Approved',revision=revision+1,approved_at=?,updated_at=? WHERE id=?")
      .run(timestamp, timestamp, id);
    record(id, 'Approved', revision + 1, actor, timestamp);
    return find(id);
  });
  app.post('/api/social-drafts/:id/approve', requireRead, requireWrite, withDraft, (req, res) => {
    if (!validate(req.body, ['revision']) || !revisionIsValid(req.body.revision)) return failure(res, 400, 'Provide the current revision.');
    const row = approve.immediate(req.params.id, req.body.revision, req.localUser.username);
    if (!row) return failure(res, 409, 'The draft changed. Refresh and review it again before approval.');
    success(res, publicDraft(row));
  });
  app.get('/api/social-drafts/:id/history', requireRead, withDraft, (req, res) => success(res,
    db.prepare('SELECT action,revision,actor,occurred_at AS occurredAt FROM social_draft_events WHERE draft_id=? ORDER BY id').all(req.params.id)));
  app.get('/api/social-drafts/:id/export', requireRead, withDraft, (req, res) => {
    if (!/^[1-9][0-9]*$/.test(String(req.query.revision || '')) || Number(req.query.revision) !== req.socialDraft.revision) {
      return failure(res, 409, 'The export revision is missing or stale. Refresh and review the current draft.');
    }
    if (req.socialDraft.status !== 'Approved') return failure(res, 409, 'Review and approve this draft before exporting.');
    success(res, { format: 'divinenet-social-draft-v1', exportOnly: true, published: false,
      message: 'Approved text export only. No account is connected and nothing was sent to a platform. Media and platform rules must be checked before publication.',
      draft: publicDraft(req.socialDraft) });
  });
  app.post('/api/social-drafts/:id/publish', requireRead, requireWrite, withDraft, (_req, res) =>
    failure(res, 503, 'No publishing connector is enabled. Nothing was submitted to a social platform.'));
}

module.exports = { PLATFORMS, socialDraftSchema, attachSocialDraftRoutes };
