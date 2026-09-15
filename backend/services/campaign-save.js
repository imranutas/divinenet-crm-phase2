const { createHash } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function createCampaignSave(db, campaigns, assets) {
  // A receipt has a real campaign FK. SET NULL retains the retry tombstone after deletion.
  // A replay must not silently recreate a campaign that the user deliberately deleted.
  const write = db.transaction((operation, body, save) => {
    const requestId = body.clientRequestId;
    if (requestId !== undefined && (typeof requestId !== 'string' || !UUID.test(requestId))) {
      throw problem(400, 'clientRequestId must be a UUID');
    }
    const requestHash = createHash('sha256').update(canonical({ operation, body })).digest('hex');
    if (requestId !== undefined) {
      const previous = db.prepare('SELECT * FROM campaign_save_requests WHERE request_id=?').get(requestId);
      if (previous) {
        if (previous.request_hash !== requestHash) throw problem(409, 'This save request ID was already used with different information');
        if (!previous.campaign_id) throw problem(409, 'The campaign from this save request was deleted; start a new campaign to save again');
        return { saved: campaigns.getById(previous.campaign_id), replayed: true };
      }
    }
    const saved = save();
    assets.attachApprovedDraft(body.bannerDraftId, saved.id);
    if (requestId !== undefined) db.prepare('INSERT INTO campaign_save_requests(request_id,request_hash,campaign_id,created_at) VALUES (?,?,?,?)')
      .run(requestId, requestHash, saved.id, new Date().toISOString());
    return { saved, replayed: false };
  });
  return (operation, body, save) => {
    const result = write(operation, body, save);
    assets.releaseSavedDraft(body.bannerDraftId);
    return result;
  };
}

module.exports = { createCampaignSave };
