'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createApp } = require('../backend/app');

async function main() {
  const root = path.resolve(__dirname, '..');
  const flag = process.argv.indexOf('--script-file');
  if (flag !== -1 && !process.argv[flag + 1]) throw new Error('Supply the baseline apps.js path.');
  const scriptFile = flag === -1 ? path.join(root, 'apps.js') : process.argv[flag + 1];
  const script = fs.readFileSync(scriptFile, 'utf8');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const git = (...args) => {
    try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return 'Not available (for example, downloaded ZIP)'; }
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-notification-'));
  const output = path.join(root, 'test-evidence', 'notifications-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    recordedAt: new Date().toISOString(), executor: process.env.CRM_TEST_EXECUTOR || 'Operator not recorded',
    commit: git('rev-parse', 'HEAD'), workingTree: git('status', '--short'),
    scriptSource: scriptFile, scriptSha256: hash(script), testSha256: hash(fs.readFileSync(__filename)),
    node: process.version, expectedChecks: 8, checks: [],
    limitations: ['Synthetic local database only', 'Controlled network failures', 'External removal is not a full backup/restore test', 'No live AI, Phase 1 or production acceptance tested']
  };
  let db, server, browser, page, base, protectedCampaign, visit = 0;
  const campaignBody = name => ({ campaignName: name, prompt: 'Synthetic notification brief', channel: 'Website', startDate: '2026-09-15', endDate: '2026-09-20' });
  async function request(route, method = 'GET', body) {
    const response = await fetch(base + '/api' + route, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    assert.ok(response.ok, method + ' ' + route + ': ' + JSON.stringify(payload));
    return payload.data;
  }
  async function settled() {
    await page.waitForFunction(() => !document.getElementById('refresh').disabled && document.getElementById('view').getAttribute('aria-busy') === 'false');
  }
  async function openCampaigns() {
    await page.goto(base + '/?notification-check=' + (++visit) + '#campaigns');
    await page.locator('#connection.online').waitFor();
    await settled();
    await page.locator('#view').getByRole('table').waitFor();
  }
  async function goToOverview() {
    await page.evaluate(() => {
      window.notificationNavigation = new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true }));
    });
    await page.locator('[data-route="dashboard"]').click();
    await page.evaluate(() => window.notificationNavigation.then(() => true));
    await settled();
  }
  async function deleteCampaign(campaign) {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url() === base + '/api/campaigns/' + campaign.id && r.request().method() === 'DELETE'),
      page.getByRole('row').filter({ has: page.getByText(campaign.campaignName, { exact: true }) }).getByRole('button', { name: 'Delete', exact: true }).click()
    ]);
    await page.locator(response.ok() ? '#notice' : '#global-error').waitFor();
    await settled();
    return response.status();
  }
  async function successfulDelete() {
    const campaign = await request('/campaigns', 'POST', campaignBody('Disposable ' + Date.now()));
    await openCampaigns();
    assert.equal(await deleteCampaign(campaign), 200);
  }
  async function fillCampaign(name) {
    await page.locator('#primary-action').click();
    await page.locator('#field-campaignName').fill(name);
    await page.locator('#field-prompt').fill('Keep this draft after a failed save.');
    await page.locator('#field-startDate').fill('2026-09-15');
    await page.locator('#field-endDate').fill('2026-09-20');
  }
  async function finishSave() {
    await page.locator('#save-record').click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    await page.locator('#notice').waitFor();
    await settled();
    assert.match(await page.locator('#notice').innerText(), /saved to the database/);
  }
  async function check(name, action) {
    try { await action(); report.checks.push({ name, result: 'Pass' }); console.log('PASS: ' + name); }
    catch (error) {
      report.checks.push({ name, result: 'Fail', message: error.message });
      console.error('FAIL: ' + name + ': ' + error.message);
      await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await page.unroute('**/api/campaigns').catch(() => {}); }
  }
  try {
const instance = createApp({
  databasePath: path.join(temp, 'notifications.sqlite'),
  imageConfig: {},
  campaignNow: () => new Date('2026-09-15T02:00:00Z')
});
    db = instance.db;
    server = await new Promise((resolve, reject) => {
      const listener = instance.app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.on('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
    protectedCampaign = await request('/campaigns', 'POST', campaignBody('Protected notification campaign'));
    await request('/leads', 'POST', { campaignId: protectedCampaign.id, name: 'Synthetic lead', email: 'notification@example.com', sourcePlatform: 'Website', consentStatus: 'Unknown' });
    browser = await chromium.launch({ headless: true, ...(process.env.CRM_BROWSER_CHANNEL ? { channel: process.env.CRM_BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-09-15T02:00:00Z'));
    page.setDefaultTimeout(5000);
    if (flag !== -1) await page.route('**/apps.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: script }));
    page.on('dialog', dialog => dialog.accept());

    await check('Fresh deletion success survives its automatic reload', async () => {
      await successfulDelete();
      assert.equal(await page.locator('#notice').innerText(), 'Campaign deleted.');
      assert.equal(await page.locator('#global-error').isVisible(), false);
    });
    await check('Protected deletion shows its error without an old success', async () => {
      await successfulDelete();
      assert.equal(await deleteCampaign(protectedCampaign), 409);
      assert.match(await page.locator('#global-error').innerText(), /cannot be deleted while leads are linked/i);
      assert.equal(await page.locator('#notice').isVisible(), false);
      assert.equal((await request('/campaigns/' + protectedCampaign.id)).id, protectedCampaign.id);
    });
    await check('Navigation clears an obsolete campaign action error', async () => {
      await openCampaigns();
      await deleteCampaign(protectedCampaign);
      await goToOverview();
     await page.locator('#breadcrumb').waitFor();
assert.equal(await page.locator('#breadcrumb').textContent(), 'Overview');
      assert.equal(await page.locator('#global-error').isVisible(), false);
      assert.equal(await page.locator('#notice').isVisible(), false);
    });
    await check('Opening a new action clears obsolete notifications', async () => {
      await openCampaigns();
      await deleteCampaign(protectedCampaign);
      await page.locator('#primary-action').click();
      await page.locator('#editor').waitFor();
      assert.equal(await page.locator('#global-error').isVisible(), false);
      assert.equal(await page.locator('#notice').isVisible(), false);
      await page.locator('#cancel-editor').click();
    });
    await check('Failed save retains input; successful retry retains fresh success', async () => {
      await openCampaigns();
      await fillCampaign('Retain this notification draft');
      const before = (await request('/campaigns')).length;
      await page.route('**/api/campaigns', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Synthetic save failure: please retry.' }) }) : route.continue());
      await page.locator('#save-record').click();
      await page.locator('#form-error').waitFor();
      assert.equal(await page.locator('#field-campaignName').inputValue(), 'Retain this notification draft');
      assert.equal(await page.locator('#field-prompt').inputValue(), 'Keep this draft after a failed save.');
      assert.match(await page.locator('#form-error').innerText(), /Synthetic save failure/);
      assert.equal((await request('/campaigns')).length, before);
      await page.unroute('**/api/campaigns');
      await finishSave();
      assert.equal((await request('/campaigns')).length, before + 1);
    });
    await check('Manual Refresh Data clears an old deletion success', async () => {
      await successfulDelete();
      await page.locator('#refresh').click();
      await settled();
      assert.equal(await page.locator('#notice').isVisible(), false);
    });
    await check('Same-page refresh clears saved success after external record removal', async () => {
      await openCampaigns();
      await fillCampaign('External removal notification check');
      await finishSave();
      const saved = (await request('/campaigns')).find(c => c.campaignName === 'External removal notification check');
      assert.ok(saved, 'Campaign must actually be stored.');
      assert.equal(await page.locator('#notice').innerText(), 'Campaign ' + saved.id + ' saved to the database.');
      await request('/campaigns/' + saved.id, 'DELETE');
      await page.locator('#refresh').click();
      await settled();
      assert.equal(await page.locator('#notice').isVisible(), false);
      assert.equal(await page.getByRole('row').filter({ hasText: saved.campaignName }).count(), 0);
      assert.equal(await page.locator('#global-error').isVisible(), false);
    });
    await check('Outage remains visible on navigation and pending refresh until recovery', async () => {
      await openCampaigns();
      await page.route('**/api/campaigns', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Synthetic backend outage' }) }));
      await page.locator('#refresh').click();
      await page.locator('#global-error').waitFor();
      await settled();
      await goToOverview();
      assert.match(await page.locator('#global-error').innerText(), /Synthetic backend outage/);
      assert.equal(await page.locator('#global-error').isVisible(), true);
      assert.equal(await page.locator('#primary-action').isDisabled(), true);
      await page.unroute('**/api/campaigns');
      let release, intercepted, timer;
      const gate = new Promise(resolve => { release = resolve; });
      const started = new Promise(resolve => { intercepted = resolve; });
      await page.route('**/api/campaigns', async route => { intercepted(); await gate; await route.continue(); });
      try {
        await page.locator('#refresh').click();
        await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Refresh request was not sent.')), 5000); })]);
        assert.equal(await page.locator('#view').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('#global-error').isVisible(), true);
        assert.match(await page.locator('#global-error').innerText(), /Synthetic backend outage/);
        assert.equal(await page.locator('#notice').isVisible(), false);
      } finally { clearTimeout(timer); release(); }
      await page.locator('#connection.online').waitFor();
      await settled();
      assert.equal(await page.locator('#global-error').isVisible(), false);
    });
  } catch (error) { report.setupError = error.message; }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (db?.open) db.close();
    report.passed = report.checks.filter(check => check.result === 'Pass').length;
    report.failed = report.checks.filter(check => check.result === 'Fail').length;
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('Notification checks: ' + report.checks.length + ' executed, ' + report.passed + ' passed, ' + report.failed + ' failed.');
    console.log('Evidence: ' + output);
    const exactTemp = path.resolve(temp);
    assert.equal(path.dirname(exactTemp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(exactTemp).startsWith('divinenet-notification-'));
    fs.rmSync(exactTemp, { recursive: true, force: true });
    if (report.failed || report.setupError || report.checks.length !== report.expectedChecks) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
