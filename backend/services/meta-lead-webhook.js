'use strict';

function attachMetaLeadWebhook(app, { db }) {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
  const campaignId = process.env.META_LEAD_CAMPAIGN_ID || 'CAM-003';

  app.get('/api/meta/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === verifyToken) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.sendStatus(403);
  });

  app.post('/api/meta/webhook', async (req, res) => {
    // Acknowledge Meta immediately.
    res.sendStatus(200);

    try {
      const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];

      for (const entry of entries) {
        for (const change of (entry.changes || [])) {
          if (change.field !== 'leadgen') continue;

          const leadgenId = change.value?.leadgen_id;
          if (!leadgenId || !accessToken) continue;

          const response = await fetch(
            `https://graph.facebook.com/v24.0/${encodeURIComponent(leadgenId)}?fields=id,created_time,field_data&access_token=${encodeURIComponent(accessToken)}`
          );
          const metaLead = await response.json();
          if (!response.ok || !Array.isArray(metaLead.field_data)) {
            console.error('Meta lead fetch failed:', metaLead?.error?.message || response.status);
            continue;
          }

          const fields = {};
          for (const field of metaLead.field_data) {
            fields[field.name] = Array.isArray(field.values) ? field.values[0] : '';
          }

          const email = String(fields.email || '').trim().toLowerCase();
          if (!email) continue;

          // Prevent duplicate imports of the same email/campaign.
          const duplicate = db.prepare(
            'SELECT id FROM leads WHERE campaign_id=? AND lower(email)=lower(?) LIMIT 1'
          ).get(campaignId, email);
          if (duplicate) continue;

          const last = db.prepare(
            "SELECT id FROM leads WHERE id LIKE 'LEAD-%' ORDER BY CAST(substr(id,6) AS INTEGER) DESC LIMIT 1"
          ).get();
          const nextNumber = last ? Number(last.id.slice(5)) + 1 : 1;
          const id = `LEAD-${String(nextNumber).padStart(3,'0')}`;
          const now = new Date().toISOString();

          const name = String(
            fields.full_name ||
            [fields.first_name, fields.last_name].filter(Boolean).join(' ') ||
            'Meta Lead'
          ).trim();

          const phone = String(fields.phone_number || fields.phone || '').trim() || null;

          db.prepare(`
            INSERT INTO leads
            (id,campaign_id,name,email,phone,source_platform,consent_status,stage,score,score_policy_version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            id, campaignId, name, email, phone,
            'Instagram', 'Recorded', 'New',
            null, null, now, now
          );

          console.log(`Meta lead imported: ${id}`);
        }
      }
    } catch (error) {
      console.error('Meta webhook processing failed:', error.message);
    }
  });
}

module.exports = { attachMetaLeadWebhook };
