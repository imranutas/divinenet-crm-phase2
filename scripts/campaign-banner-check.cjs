'use strict';
// Synthetic browser regression. The injected PNG provider is not live AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { deflateSync, crc32 } = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createApp } = require('../backend/app');

function syntheticPng() {
  const width = 640, height = 360;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 3 + 1) + 1 + x * 3;
    pixels[i] = x < width / 2 ? 24 : 180;
    pixels[i + 1] = y < height / 2 ? 120 : 195;
    pixels[i + 2] = 100;
  }
  const chunk = (type, bytes) => {
    const result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length); result.write(type, 4, 'ascii'); bytes.copy(result, 8);
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(temporaryRoot, 'divinenet-banner-browser-'));
  const output = path.join(root, 'test-evidence', 'campaign-banner-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const git = (...args) => {
    try { return execFileSync('git', ['-c', 'safe.directory=' + root.replace(/\\/g, '/'), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return 'not available'; }
  };
  const sourceFiles = ['apps.js', 'index.html', 'style.css', 'backend/app.js', 'backend/db/migrate.js',
    'backend/db/connection.js', 'backend/repositories/campaignRepository.js', 'backend/validation.js',
    'backend/services/image-assets.js', 'backend/services/campaign-save.js', 'backend/services/local-image-provider.js',
    'backend/services/png-validation.js', 'scripts/campaign-banner-check.cjs'];
  const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const report = {
    recordedAt: new Date().toISOString(), executor: process.env.CRM_TEST_EXECUTOR || 'Assistant automated review',
    commit: git('rev-parse', 'HEAD'), workingTree: git('status', '--short'), node: process.version,
    provider: 'Injected deterministic test-double, synthetic PNG; not live AI', checks: [],
    limitations: ['Isolated synthetic SQLite only', 'No model download or live inference', 'Controlled failure/response-loss simulation', 'Not independent human QA or production/client acceptance'],
    sourceHashes: sourceHashes()
  };
  const png = syntheticPng();
  let browser, context, page, base, currentStore, successfulCampaign;
  const stores = [];
  let providerCalls = 0, failNextGeneration = false, visit = 0;
  const provider = { provider: 'test-double', model: 'synthetic-browser-fixture', async generate() {
    providerCalls++;
    if (failNextGeneration) { failNextGeneration = false; throw new Error('Synthetic provider failure'); }
    return { bytes: png, provider: 'test-double', model: 'synthetic-browser-fixture' };
  } };
 async function openStore(name, configured) {
  const instance = createApp({
    databasePath: path.join(temp, name + '.sqlite'),
    imageConfig: {},
    campaignNow: () => new Date('2026-09-15T02:00:00Z'),
    ...(configured ? { imageProvider: provider } : {})
  });
  const server = await new Promise((resolve, reject) => {
    const listener = instance.app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const store = {
    db: instance.db,
    server,
    base: 'http://127.0.0.1:' + server.address().port
  };
  stores.push(store);
  return store;
}
  async function records(route) {
    const response = await fetch(base + '/api/' + route);
    assert.ok(response.ok, 'GET ' + route + ' must succeed');
    return (await response.json()).data;
  }
  async function openNew(name) {
    await page.goto(base + '/?banner-check=' + (++visit) + '#campaigns');
    await page.locator('#connection.online').waitFor();
    await page.locator('#primary-action').click();
    await page.locator('#editor').waitFor();
    await page.locator('#field-campaignName').fill(name);
    await page.locator('#field-prompt').fill('Synthetic campaign objective for browser verification.');
    await page.locator('#field-startDate').fill('2026-09-15');
    await page.locator('#field-endDate').fill('2026-09-20');
  }
  async function generate() {
    await page.locator('#banner-prompt').fill('Synthetic geometric campaign background, no personal information.');
    await page.locator('#banner-consent').check();
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/banner-drafts/generate') && r.request().method() === 'POST'),
      page.locator('#generate-banner').click()
    ]);
    assert.equal(response.status(), 201, await response.text());
    const draft = (await response.json()).data;
    await page.locator('#banner-preview').waitFor();
    await page.waitForFunction(() => { const image = document.getElementById('banner-preview'); return image.complete && image.naturalWidth > 0; });
    return draft;
  }
  async function approve() {
    await page.locator('#banner-review').check();
    const [response] = await Promise.all([
      page.waitForResponse(r => /\/api\/banner-drafts\/[^/]+\/approve$/.test(r.url())),
      page.locator('#approve-banner').click()
    ]);
    assert.ok(response.ok(), await response.text());
    await page.waitForFunction(() => /approved/i.test(document.getElementById('banner-message').textContent));
  }
  async function save() {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url() === base + '/api/campaigns' && r.request().method() === 'POST'),
      page.locator('#save-record').click()
    ]);
    assert.ok(response.ok(), await response.text());
    const campaign = (await response.json()).data;
    await page.locator('#editor').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.getElementById('view').getAttribute('aria-busy') === 'false');
    return campaign;
  }
  let executedCount = 0;
  async function check(name, fn) {
    try {
  await fn();
  executedCount += 1;
  report.checks.push({ name, result: 'Pass' });
}
    catch (error) {
      report.checks.push({ name, result: 'Fail', message: error.message });
      if (page) await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { if (page) await page.unroute('**/api/campaigns').catch(() => {}); }
  }
  try {
    currentStore = await openStore('configured-fixture', true); base = currentStore.base;
    browser = await chromium.launch({ headless: true, ...(process.env.CRM_BROWSER_CHANNEL ? { channel: process.env.CRM_BROWSER_CHANNEL } : {}) });
    context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    await context.route('**/*', route => stores.some(store => route.request().url().startsWith(store.base + '/')) ? route.continue() : route.abort());
    page = await context.newPage(); page.setDefaultTimeout(7000); page.on('dialog', dialog => dialog.accept());
    await page.clock.setFixedTime(new Date('2026-09-15T02:00:00Z'));
    await check('Generate, preview and approve before saving one campaign with one linked approved banner', async () => {
      await openNew('Synthetic campaign with reviewed banner');
      assert.match(JSON.stringify(await records('ai/status')), /test-double/);
      assert.deepEqual(await records('campaigns'), []);
      const draft = await generate();
      assert.ok(draft.id); assert.equal(draft.status, 'Draft');
      assert.deepEqual(await records('campaigns'), [], 'Generation alone must not create a campaign');
      await approve();
      await page.screenshot({ path: path.join(output, 'desktop-reviewed-banner-before-save.png'), fullPage: true });
      successfulCampaign = await save();
      const campaigns = await records('campaigns');
      assert.equal(campaigns.length, 1);
      const assets = await records('campaigns/' + successfulCampaign.id + '/assets');
      assert.equal(assets.length, 1); assert.equal(assets[0].status, 'Approved'); assert.equal(assets[0].campaignId, successfulCampaign.id);
      assert.equal(assets[0].provider, 'test-double');
    });
    await check('An unreviewed generated draft cannot be saved as a campaign banner', async () => {
      await openNew('Synthetic unreviewed banner must wait');
      const before = (await records('campaigns')).length;
      await generate();
      if (!(await page.locator('#save-record').isDisabled())) {
        await page.locator('#save-record').click();
        await page.waitForFunction(() => { const form = document.getElementById('form-error'), banner = document.getElementById('banner-message'); return (form && !form.hidden && form.textContent) || (banner && /review|approv/i.test(banner.textContent)); });
      }
      assert.equal(await page.locator('#editor').isVisible(), true);
      assert.equal((await records('campaigns')).length, before);
      await page.locator('#discard-banner').click();
      await page.locator('#cancel-editor').click();
    });
    await check('Editing an approved image prompt invalidates the old selection', async () => {
      await openNew('Synthetic prompt edit invalidation');
      await generate(); await approve();
      await page.locator('#banner-prompt').fill('A changed synthetic brief that needs a new image.');
      assert.equal(await page.locator('#banner-review').isChecked(), false);
      assert.match(await page.locator('#banner-message').innerText(), /chang|generat|invalid|discard/i);
      assert.equal(await page.locator('#banner-preview').isVisible(), false);
      assert.equal(await page.locator('#approve-banner').isVisible(), false, 'The previous preview must not be approved against the changed prompt');
      await page.locator('#cancel-editor').click();
    });
    await check('Reopening a saved campaign shows its approved banner and offers the same PNG for download', async () => {
      assert.ok(successfulCampaign, 'Initial saved campaign is required');
      await page.goto(base + '/#campaigns'); await page.locator('#connection.online').waitFor();
      await page.getByRole('row').filter({ has: page.getByText(successfulCampaign.campaignName, { exact: true }) }).getByRole('button', { name: 'Edit', exact: true }).click();
      const image = page.locator('#editor img[src*="/api/assets/"]').first();
      await image.waitFor();
      const link = page.locator('#editor a[href*="/api/assets/"][href$="/download"]').first();
      await link.waitFor();
      const response = await fetch(new URL(await link.getAttribute('href'), base));
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
      const downloadPromise = page.waitForEvent('download'); await link.click();
      const download = await downloadPromise; assert.match(download.suggestedFilename(), /\.png$/i);
      await page.locator('#cancel-editor').click();
    });
    await check('A lost successful save response can be retried without duplicate campaign or banner', async () => {
      await openNew('Synthetic response loss safe retry'); await generate(); await approve();
      const before = (await records('campaigns')).length, requests = []; let responseLost = false;
      await page.route('**/api/campaigns', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        requests.push(route.request().postDataJSON());
        if (!responseLost) { responseLost = true; const response = await route.fetch(); assert.ok(response.ok()); return route.abort('failed'); }
        return route.continue();
      });
      await page.locator('#save-record').click(); await page.locator('#form-error').waitFor();
      assert.equal((await records('campaigns')).length, before + 1);
      assert.equal(await page.locator('#field-campaignName').inputValue(), 'Synthetic response loss safe retry');
      assert.equal(await page.locator('#form-fields').evaluate(element => element.inert), true, 'An uncertain committed save must lock the payload until retried');
      const originalPrompt = await page.locator('#banner-prompt').inputValue();
      let promptMutationBlocked = false;
      // fill() can directly assign inert inputs; check real pointer/keyboard access instead.
      try { await page.locator('#banner-prompt').click({ timeout: 400 }); }
      catch { promptMutationBlocked = true; }
      assert.equal(promptMutationBlocked, true, 'Uncertain save must not allow changing its banner request');
      await page.keyboard.type('Synthetic attempted keyboard edit');
      assert.equal(await page.locator('#banner-prompt').inputValue(), originalPrompt);
      assert.match(await page.locator('#save-record').innerText(), /retry/i);
      const saved = await save();
      assert.equal(requests.length, 2); assert.match(requests[0].clientRequestId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
      assert.equal(requests[1].clientRequestId, requests[0].clientRequestId);
      assert.equal(requests[1].bannerDraftId, requests[0].bannerDraftId);
      assert.equal((await records('campaigns')).length, before + 1);
      assert.equal((await records('campaigns/' + saved.id + '/assets')).length, 1);
    });
    await check('Campaign banner editor and preview fit a 390px phone without horizontal overflow', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openNew('Synthetic mobile banner'); await generate();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await page.locator('#editor').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      assert.ok(await page.locator('#banner-section').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.locator('#banner-preview').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'mobile-390-banner-preview.png'), fullPage: true });
      await page.locator('#discard-banner').click(); await page.locator('#cancel-editor').click();
      await page.setViewportSize({ width: 1440, height: 1050 });
    });
    await check('Generation failure preserves the brief and allows an explicit successful retry', async () => {
      await openNew('Synthetic provider failure recovery');
      await page.locator('#banner-prompt').fill('Keep this synthetic brief after a failure.'); await page.locator('#banner-consent').check();
      failNextGeneration = true;
      const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/banner-drafts/generate')), page.locator('#generate-banner').click()]);
      assert.equal(response.status(), 502);
      await page.waitForFunction(() => !document.getElementById('generate-banner').disabled);
      assert.equal(await page.locator('#banner-prompt').inputValue(), 'Keep this synthetic brief after a failure.');
      assert.match(await page.locator('#banner-message').innerText(), /fail|retry|could not/i);
      await generate(); await page.locator('#discard-banner').click(); await page.locator('#cancel-editor').click();
    });
    await check('Failed regeneration keeps the previously approved banner available for campaign save', async () => {
      await openNew('Synthetic regeneration preserves approval');
      const previous = await generate(); await approve();
      const previousImage = await page.locator('#banner-preview').getAttribute('src');
      failNextGeneration = true;
      const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/banner-drafts/generate')), page.locator('#generate-banner').click()]);
      assert.equal(response.status(), 502);
      await page.waitForFunction(() => !document.getElementById('generate-banner').disabled);
      assert.equal(await page.locator('#banner-preview').isVisible(), true);
      assert.equal(await page.locator('#banner-preview').getAttribute('src'), previousImage);
      assert.equal(await page.locator('#banner-review').isChecked(), true);
      const saved = await save();
      const assets = await records('campaigns/' + saved.id + '/assets');
      assert.equal(assets.length, 1); assert.equal(assets[0].id, previous.id); assert.equal(assets[0].status, 'Approved');
    });
    await check('Unavailable image generation stays disabled while ordinary campaign saving works', async () => {
      currentStore = await openStore('provider-unavailable', false); base = currentStore.base;
      await openNew('Synthetic campaign without configured AI');
      assert.equal(await page.locator('#generate-banner').isDisabled(), true);
      assert.match(await page.locator('#banner-section').innerText(), /unavailable|not configured|not enabled|not ready/i);
      const saved = await save(); assert.ok(saved.id);
      assert.equal((await records('campaigns')).length, 1);
      assert.equal((await records('campaigns/' + saved.id + '/assets')).length, 0);
    });
    assert.equal(executedCount, 9, 'Expected all 9 banner scenarios to complete successfully');
  } catch (error) { report.setupError = error.message; }
  finally {
    if (browser) await browser.close();
    for (const store of stores) { await new Promise(resolve => store.server.close(resolve)); if (store.db.open) store.db.close(); }
    report.executedCount = executedCount;
report.expectedCount = 9;
    report.providerCalls = providerCalls; report.passed = report.checks.filter(check => check.result === 'Pass').length; report.failed = report.checks.filter(check => check.result === 'Fail').length;
    report.sourceUnchangedDuringRun = JSON.stringify(report.sourceHashes) === JSON.stringify(sourceHashes());
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); console.log('Evidence: ' + output);
    const exactTemp = fs.realpathSync(temp);
    assert.equal(path.dirname(exactTemp), temporaryRoot); assert.equal(fs.lstatSync(exactTemp).isSymbolicLink(), false);
    assert.ok(path.basename(exactTemp).startsWith('divinenet-banner-browser-')); fs.rmSync(exactTemp, { recursive: true, force: false });
    if (report.failed || report.setupError || !report.sourceUnchangedDuringRun) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
