'use strict';

const crypto = require('node:crypto');
const { createContentWorkflow } = require('./content-workflow');
const { createTextRuntimeGuard } = require('./text-runtime-guard');

const failure = (res, status, message) =>
  res.status(status).json({ success: false, message });

const success = (res, data, status = 200) =>
  res.status(status).json({ success: true, data }, status);

function percentage(part, total) {
  if (!total) return null;
  return Number(((part / total) * 100).toFixed(2));
}

function buildReport(db, now) {
  const campaigns = db.prepare(`
    SELECT
      c.id,
      c.campaign_name,
      c.status,
      c.channel,
      COUNT(l.id) AS lead_count,
      SUM(CASE WHEN l.stage = 'Qualified' THEN 1 ELSE 0 END) AS qualified_count
    FROM campaigns c
    LEFT JOIN leads l ON l.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at ASC, c.id ASC
  `).all();

  const stageRows = db.prepare(`
    SELECT stage, COUNT(*) AS count
    FROM leads
    GROUP BY stage
    ORDER BY stage ASC
  `).all();

  const sourceRows = db.prepare(`
    SELECT source_platform AS source, COUNT(*) AS count
    FROM leads
    GROUP BY source_platform
    ORDER BY source_platform ASC
  `).all();

  const totalLeads =
    db.prepare('SELECT COUNT(*) AS count FROM leads').get().count;

  const qualifiedLeads =
    db.prepare("SELECT COUNT(*) AS count FROM leads WHERE stage='Qualified'").get().count;

  const report = {
    scope: 'Current stored records',
    generatedAt: new Date(now()).toISOString(),
    timezone: 'Australia/Sydney',
    definitions: {
      leads: 'Current lead records stored in this CRM.',
      qualified:
        "Current lead records whose present pipeline stage is 'Qualified'.",
      qualificationRate:
        'Qualified current lead records divided by current lead records. Null means there are no leads in the scope.',
      historicalPerformance:
        'Not available from this snapshot. Current stored records are not historical performance data.'
    },
    totals: {
      campaigns: campaigns.length,
      leads: totalLeads,
      qualified: qualifiedLeads,
      qualificationRate: percentage(qualifiedLeads, totalLeads)
    },
    byStage: stageRows.map(row => ({
      stage: row.stage,
      count: row.count
    })),
    bySource: sourceRows.map(row => ({
      source: row.source,
      count: row.count
    })),
    byCampaign: campaigns.map(row => ({
      campaignId: row.id,
      campaignName: row.campaign_name,
      status: row.status,
      channel: row.channel,
      leads: row.lead_count,
      qualified: row.qualified_count,
      qualificationRate: percentage(row.qualified_count, row.lead_count)
    })),
    unavailableMetrics: [
      'spend',
      'revenue',
      'ROI',
      'impressions',
      'clicks',
      'historical trend'
    ]
  };

  const snapshotFacts = {
    scope: report.scope,
    totals: report.totals,
    byStage: report.byStage,
    bySource: report.bySource,
    byCampaign: report.byCampaign,
    unavailableMetrics: report.unavailableMetrics
  };

  report.snapshotId = crypto
    .createHash('sha256')
    .update(JSON.stringify(snapshotFacts))
    .digest('hex');

  return report;
}

function attachOperationsReportRoutes(
  app,
  {
    db,
    accessEnabled = false,
    now = () => new Date(),
    provider = null
  } = {}
) {
  const workflow = createContentWorkflow({ provider });
  const guard = createTextRuntimeGuard(db);

  const requireRead = (req, res, next) => {
    if (!accessEnabled || !req.localUser) {
      return failure(res, 401, 'Sign in to view operational reports.');
    }
    next();
  };

  app.get('/api/reports/operations', requireRead, (_req, res) => {
    success(res, buildReport(db, now));
  });

  app.post('/api/reports/narrative', requireRead, async (req, res) => {
    if (!['admin', 'editor'].includes(req.localUser.role)) {
      return failure(res, 403, 'Editor access is required.');
    }

    const body = req.body;

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.confirmed !== 'boolean' ||
      body.confirmed !== true ||
      typeof body.snapshotId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.snapshotId)
    ) {
      return failure(
        res,
        400,
        'Explicit confirmation and a valid report snapshot are required.'
      );
    }

    if (!provider) {
      return failure(res, 503, 'AI content provider is not configured');
    }

    const report = buildReport(db, now);

    if (body.snapshotId !== report.snapshotId) {
      return failure(
        res,
        409,
        'The report snapshot is stale. Refresh the operational report before generating a narrative.'
      );
    }

    const aggregateFacts = {
      scope: report.scope,
      timezone: report.timezone,
      totals: report.totals,
      byStage: report.byStage,
      bySource: report.bySource,
      byCampaign: report.byCampaign,
      unavailableMetrics: report.unavailableMetrics
    };

    const prompt = [
      'Write a concise operational CRM report narrative using only the aggregate facts supplied below.',
      'Do not invent or estimate missing information.',
      'Do not claim historical performance, spend, revenue, ROI, impressions or clicks when those metrics are unavailable.',
      'Clearly describe the information as current stored CRM records.',
      'Return a draft for human review. Do not claim it has been approved, saved, published or emailed.',
      '',
      JSON.stringify(aggregateFacts)
    ].join('\n');

    const operation = guard.begin();

    if (!operation) {
      return failure(
        res,
        409,
        'A text generation is running or previous execution is uncertain. Follow the documented text-runtime recovery before retrying.'
      );
    }

    try {
      const result = await workflow.generateContent({
        prompt,
        brand: '',
        channel: 'Operational report'
      });

      if (!result.success) {
        guard.uncertain(operation);
        return res.status(result.statusCode).json(result);
      }

      guard.complete(operation);

      return success(res, {
        narrative: result.data.content,
        provider: result.data.provider,
        status: 'Draft',
        requiresHumanApproval: true,
        savedAutomatically: false,
        published: false,
        emailed: false,
        scope: report.scope,
        snapshotId: report.snapshotId
      });
    } catch {
      guard.uncertain(operation);
      return failure(
        res,
        502,
        'Local report narrative generation could not be confirmed.'
      );
    }
  });
}

module.exports = {
  attachOperationsReportRoutes
};