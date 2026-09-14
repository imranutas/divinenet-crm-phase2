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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-inline-'));
  const output = path.join(root, 'test-evidence', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  function git(...args) {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return 'not available'; }
  }
  const report = {
    recordedAt: new Date().toISOString(),
    executor: process.env.CRM_TEST_EXECUTOR || (process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'Operator not recorded'),
    commit: git('rev-parse', 'HEAD'), workingTree: git('status', '--short'),
    node: process.version, checks: [],
    limitations: ['Synthetic local data only', 'No live AI, Phase 1, publishing or production acceptance tested']
  };
  let db, server, browser, page, base;
  async function check(name, fn) {
    try { await fn(); report.checks.push({ name, result: 'Pass' }); }
    catch (error) {
      report.checks.push({ name, result: 'Fail', message: error.message });
      if (page) await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
      throw error;
    }
  }
  try {
    const instance = createApp({ databasePath: path.join(temp, 'browser.sqlite'), imageConfig: {} });
    db = instance.db;
    server = await new Promise((resolve, reject) => {
      const listener = instance.app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.on('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.CRM_BROWSER_CHANNEL ? { channel: process.env.CRM_BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    const records = async name => (await (await fetch(base + '/api/' + name)).json()).data;
    let campaign, lead;
    await check('Empty database opens without invented campaigns', async () => {
      await page.goto(base);
      await page.locator('#connection.online').waitFor();
      assert.deepEqual(await records('campaigns'), []);
    });
    await check('Create campaign saves Website, numeric budget and selected directories', async () => {
      await page.locator('a[data-route="campaigns"]').click();
      await page.locator('#primary-action').click();
      await page.locator('#field-campaignName').fill('Synthetic handoff campaign');
      await page.locator('#field-prompt').fill('Synthetic campaign brief');
      await page.locator('#field-clientId').selectOption('__new__');
      await page.locator('#field-client').fill('Synthetic client');
      await page.locator('#field-brandId').selectOption('__new__');
      await page.locator('#field-brand').fill('Synthetic brand');
      await page.locator('#field-budget').fill('10k');
      await page.locator('#field-startDate').fill('2026-09-15');
      await page.locator('#field-endDate').fill('2026-09-20');
      assert.equal(await page.locator('#field-budget').inputValue(), '10000');
      await page.locator('#save-record').click();
      await page.locator('#editor').waitFor({ state: 'hidden' });
      await page.locator('#connection.online').waitFor();
      campaign = (await records('campaigns'))[0];
      assert.equal(campaign.channel, 'Website'); assert.equal(campaign.budget, 10000);
      assert.ok(campaign.clientId && campaign.brandId);
    });
    await check('Lead form saves a relationship in the same database', async () => {
      await page.locator('a[data-route="leads"]').click(); await page.locator('#primary-action').click();
      await page.locator('#field-campaignId').selectOption(campaign.id);
      await page.locator('#field-name').fill('Synthetic lead');
      await page.locator('#field-email').fill('handoff@example.com');
      await page.locator('#field-sourcePlatform').selectOption('Website');
      await page.locator('#field-consentStatus').selectOption('Unknown');
      await page.locator('#save-record').click(); await page.locator('#editor').waitFor({ state: 'hidden' });
      await page.locator('#connection.online').waitFor();
      lead = (await records('leads'))[0];
      assert.equal(lead.campaignId, campaign.id); assert.equal(lead.stage, 'New');
    });
    await check('Saved context resets cleanly and hides unused custom-name fields', async () => {
      await page.locator('a[data-route="campaigns"]').click(); await page.locator('#primary-action').click();
      await page.locator('#field-clientId').selectOption('__new__');
      await page.locator('#field-client').fill('Unsaved example');
      await page.locator('#field-sourceLead').selectOption(lead.id);
      assert.equal(await page.locator('#field-prompt').inputValue(), campaign.prompt);
      assert.equal(await page.locator('#field-client').isVisible(), false);
      await page.locator('#field-sourceLead').selectOption('');
      for (const field of ['prompt', 'clientId', 'brandId', 'budget']) assert.equal(await page.locator('#field-' + field).inputValue(), '');
      assert.equal(await page.locator('#field-channel').inputValue(), 'Website');
      await page.locator('#field-startDate').fill('2026-09-15'); await page.locator('#field-endDate').fill('2026-09-20');
      await page.locator('#field-endDate').fill('');
      assert.match(await page.locator('#form-fields .callout').innerText(), /Select dates/);
      await page.locator('#cancel-editor').click();
    });
    await check('An unsuccessful save retains input without adding a record', async () => {
      await page.locator('#primary-action').click();
      await page.locator('#field-campaignName').fill('Do not lose this draft');
      await page.locator('#field-prompt').fill('Synthetic failure check');
      await page.locator('#field-startDate').fill('2026-09-15'); await page.locator('#field-endDate').fill('2026-09-20');
      await page.route('**/api/campaigns', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Synthetic unavailable response' }) }) : route.continue());
      await page.locator('#save-record').click(); await page.locator('#form-error').waitFor();
      assert.equal(await page.locator('#field-campaignName').inputValue(), 'Do not lose this draft');
      assert.equal((await records('campaigns')).length, 1);
      await page.unroute('**/api/campaigns'); await page.locator('#cancel-editor').click();
    });
    await check('A new browser session sees the same saved records', async () => {
      const other = await browser.newContext(); const otherPage = await other.newPage();
      await otherPage.goto(base + '/#campaigns'); await otherPage.locator('#connection.online').waitFor();
      assert.match(await otherPage.locator('#view').innerText(), /Synthetic handoff campaign/); await other.close();
    });
    await check('Phone, tablet and desktop layouts do not overflow the page', async () => {
      await page.locator('a[data-route="dashboard"]').click();
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(output, 'dashboard-' + width + '.png'), fullPage: true });
      }
    });
    await check('Missing AI configuration is visible and generation stays disabled', async () => {
      await page.locator('a[data-route="studio"]').click();
      assert.equal(await page.getByRole('button', { name: 'Generate image', exact: true }).isDisabled(), true);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM campaign_assets').get().n, 0);
    });
  } catch (error) { process.exitCode = 1; report.error = error.message; }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (db?.open) db.close();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('Evidence: ' + output);
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('divinenet-inline-')) fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
