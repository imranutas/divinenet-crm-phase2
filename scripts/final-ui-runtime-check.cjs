'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createApp } = require('../backend/app');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-final-ui-'));
  const output = path.join(
    root,
    'test-evidence',
    'final-ui-' + new Date().toISOString().replace(/[:.]/g, '-')
  );

  fs.mkdirSync(output, { recursive: true });

  function git(...args) {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {
      return 'not available';
    }
  }

  const report = {
    recordedAt: new Date().toISOString(),
    executor: process.env.CRM_TEST_EXECUTOR ||
      (process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'Operator not recorded'),
    commit: git('rev-parse', 'HEAD'),
    workingTree: git('status', '--short'),
    node: process.version,
    expectedChecks: 5,
    checks: [],
    limitations: [
      'Isolated test data only',
      'No live AI, Phase 1, publishing or production acceptance tested'
    ]
  };

  let db, server, browser, page, base;

  async function check(name, fn) {
    try {
      await fn();
      report.checks.push({ name, result: 'Pass' });
    } catch (error) {
      report.checks.push({ name, result: 'Fail', message: error.message });
      if (page) {
        await page.screenshot({
          path: path.join(output, 'failure-' + report.checks.length + '.png'),
          fullPage: true
        }).catch(() => {});
      }
      throw error;
    }
  }

  async function api(pathname, options = {}) {
    const response = await fetch(base + '/api' + pathname, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: options.body === undefined
        ? undefined
        : JSON.stringify(options.body)
    });

    const body = await response.json();
    assert.equal(body.success, true, body.message || pathname);
    return body.data;
  }
  async function createCampaign(overrides = {}) {
    return api('/campaigns', {
      method: 'POST',
      body: {
        campaignName: 'Runtime campaign',
        prompt: 'Runtime verification brief',
        startDate: '2026-09-19',
        endDate: '2026-09-26',
        channel: 'Website',
        status: 'Active',
        budget: 10000,
        ...overrides
      }
    });
  }

  async function createLead(campaignId, overrides = {}) {
    return api('/leads', {
      method: 'POST',
      body: {
        campaignId,
        name: 'Runtime lead',
        email: 'runtime@example.com',
        sourcePlatform: 'Website',
        consentStatus: 'Recorded',
        ...overrides
      }
    });
  }

  async function settled() {
    await page.waitForFunction(() => {
      const refresh = document.getElementById('refresh');
      const view = document.getElementById('view');
      return refresh && view &&
        !refresh.disabled &&
        view.getAttribute('aria-busy') === 'false';
    });
  }

  try {
    const instance = createApp({
      databasePath: path.join(temp, 'final-ui.sqlite'),
      imageConfig: {}
    });

    db = instance.db;

    server = await new Promise((resolve, reject) => {
      const listener = instance.app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.on('error', reject);
    });

    base = 'http://127.0.0.1:' + server.address().port;

    browser = await chromium.launch({
      headless: true,
      ...(process.env.CRM_BROWSER_CHANNEL
        ? { channel: process.env.CRM_BROWSER_CHANNEL }
        : {})
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }
    });

    await context.route('**/*', route =>
      route.request().url().startsWith(base)
        ? route.continue()
        : route.abort()
    );

    page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());

    await page.goto(base);
    await page.locator('#connection.online').waitFor();
    await settled();
    await check('Displayed API analytics use two decimals and N/A', async () => {
      assert.match(await page.locator('#view').innerText(), /Qualification rate\s*N\/A/);

      const campaign = await createCampaign();
      const leads = [];

      for (let i = 1; i <= 3; i++) {
        leads.push(await createLead(campaign.id, {
          name: 'Analytics lead ' + i,
          email: 'analytics' + i + '@example.com'
        }));
      }

      await api('/leads/' + leads[0].id + '/stage', {
        method: 'PATCH',
        body: { stage: 'Contacted' }
      });

      await api('/leads/' + leads[0].id + '/stage', {
        method: 'PATCH',
        body: { stage: 'Qualified' }
      });

      const analytics = await api('/analytics/summary');

      await page.locator('#refresh').click();
      await settled();

      const text = await page.locator('#view').innerText();

      assert.equal(analytics.totalCampaigns, 1);
      assert.equal(analytics.totalLeads, 3);
      assert.equal(analytics.qualifiedLeads, 1);
      assert.equal(analytics.qualificationRate, 33.33);

      assert.match(text, /Total campaigns\s*1/);
      assert.match(text, /Captured leads\s*3/);
      assert.match(text, /Qualified leads\s*1/);
      assert.match(text, /Qualification rate\s*33\.33%/);
    });
    await check('Campaign filters survive refresh and campaign save', async () => {
      await page.locator('a[data-route="campaigns"]').click();
await page.waitForFunction(() => location.hash === '#campaigns');
await page.locator('#field-campaign-search').waitFor();

      await page.locator('#field-campaign-search').fill('Runtime');
      await page.locator('#field-campaign-status').selectOption('Active');

      await page.locator('#refresh').click();
      await settled();

      assert.equal(await page.locator('#field-campaign-search').inputValue(), 'Runtime');
      assert.equal(await page.locator('#field-campaign-status').inputValue(), 'Active');

      await page.locator('#primary-action').click();
      await page.locator('#field-campaignName').fill('Runtime saved campaign');
      await page.locator('#field-prompt').fill('Runtime saved campaign brief');
      await page.locator('#field-status').selectOption('Active');
      await page.locator('#field-startDate').fill('2026-09-19');
      await page.locator('#field-endDate').fill('2026-09-26');

      await page.locator('#save-record').click();
      await page.locator('#editor').waitFor({ state: 'hidden' });
      await settled();

      assert.equal(await page.locator('#field-campaign-search').inputValue(), 'Runtime');
      assert.equal(await page.locator('#field-campaign-status').inputValue(), 'Active');
    });
    await check('Filtered CSV preserves commas, quotes and line breaks', async () => {
      await createCampaign({
        campaignName: 'CSV, "Quoted"\nLine',
        prompt: 'CSV export verification',
        status: 'Active'
      });

      await page.locator('#refresh').click();
      await settled();

      await page.locator('#field-campaign-search').fill('CSV');

      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export-campaigns').click();
      const download = await downloadPromise;

      const csvPath = await download.path();
      const csv = fs.readFileSync(csvPath, 'utf8');

      assert.match(csv, /CSV, ""Quoted""\r?\nLine/);
      assert.doesNotMatch(csv, /Runtime saved campaign/);
    });
    await check('Zero matching records disable filtered export', async () => {
      await page.locator('#field-campaign-search').fill('NO-SUCH-CAMPAIGN-999');

      assert.match(await page.locator('#view').innerText(), /No matching campaigns/);
      assert.equal(await page.locator('#export-campaigns').isDisabled(), true);

      await page.locator('#field-campaign-search').fill('');
    });
    await check('Copied saved-lead context updates overlap advice', async () => {
      const origin = await createCampaign({
        campaignName: 'LinkedIn source campaign',
        channel: 'LinkedIn',
        status: 'Active'
      });

      await createCampaign({
        campaignName: 'LinkedIn overlap campaign',
        channel: 'LinkedIn',
        status: 'Active'
      });

      const sourceLead = await createLead(origin.id, {
        name: 'Context source lead',
        email: 'context@example.com',
        sourcePlatform: 'LinkedIn'
      });

      await page.locator('#refresh').click();
      await settled();

      await page.locator('#primary-action').click();

      await page.locator('#field-sourceLead').selectOption(sourceLead.id);

      assert.equal(await page.locator('#field-channel').inputValue(), 'LinkedIn');

      const advice = await page.locator('#campaign-schedule-note').innerText();
      assert.match(advice, /LinkedIn/);
      assert.match(advice, /LinkedIn overlap campaign/);

      await page.locator('#cancel-editor').click();
    });
  } catch (error) {
    process.exitCode = 1;
    report.error = error.message;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (db?.open) db.close();

    fs.writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify(report, null, 2)
    );

    console.log(JSON.stringify(report, null, 2));
    console.log('Evidence: ' + output);

    if (
      path.dirname(temp) === os.tmpdir() &&
      path.basename(temp).startsWith('divinenet-final-ui-')
    ) {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
