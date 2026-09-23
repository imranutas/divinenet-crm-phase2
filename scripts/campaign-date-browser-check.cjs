'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { createApp } = require('../backend/app');

async function main() {
  const output = path.join(__dirname, '..', 'test-evidence', 'campaign-dates-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const report = { executor: process.env.CRM_TEST_EXECUTOR || 'Unspecified executor', checks: [],
    limitations: ['Synthetic in-memory records', 'No scheduler or publishing service', 'Not independent human QA'] };
  let time = new Date('2026-09-19T14:01:00Z'); // Sydney Sep20, Los Angeles Sep19.
  const { app, db } = createApp({ databasePath: ':memory:', imageConfig: {}, campaignNow: () => time });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  async function check(name, action) { await action(); report.checks.push({ name, result: 'Pass' }); console.log('PASS ' + name); }
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CRM_BROWSER_CHANNEL ? { channel: process.env.CRM_BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.clock.setFixedTime(time);
    const start = page.locator('#field-startDate');
    await page.goto(base + '/#campaigns');
    await page.locator('#connection.online').waitFor();
    await page.locator('#primary-action').click();
    await check('Date picker uses Sydney business day even in a different browser timezone', async () => {
      assert.equal(await start.inputValue(), '2026-09-20');
      assert.equal(await start.getAttribute('min'), '2026-09-20');
      assert.equal(await page.locator('#field-endDate').inputValue(), '2026-09-27');
    });
    await check('New campaign rejects a past date and clears the error for today', async () => {
      await start.fill('2026-09-19');
      assert.equal(await start.evaluate(input => input.checkValidity()), false);
      assert.match(await start.evaluate(input => input.validationMessage), /before today/);
      await start.fill('2026-09-20');
      assert.equal(await start.evaluate(input => input.checkValidity()), true);
      await page.locator('#field-campaignName').fill('Synthetic date UI');
      await page.locator('#field-prompt').fill('Synthetic date verification');
      await page.locator('#save-record').click();
      await page.locator('#editor').waitFor({ state: 'hidden' });
    });
    time = new Date('2026-09-20T14:01:00Z');
    await page.clock.setFixedTime(time);
    await page.goto(base + '/#campaigns');
    await page.locator('#connection.online').waitFor();
    await page.getByRole('row').filter({ hasText: 'Synthetic date UI' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await check('Historical date remains editable without permitting another past date', async () => {
      assert.equal(await start.inputValue(), '2026-09-20');
      assert.equal(await start.evaluate(input => input.checkValidity()), true);
      await start.fill('2026-09-19');
      assert.equal(await start.evaluate(input => input.checkValidity()), false);
      await start.fill('2026-09-20');
      assert.equal(await start.evaluate(input => input.checkValidity()), true);
      await page.locator('#field-campaignName').fill('Historical date retained');
      await page.locator('#save-record').click();
      await page.locator('#editor').waitFor({ state: 'hidden' });
      const records = await (await fetch(base + '/api/campaigns')).json();
      assert.equal(records.data.length, 1);
      assert.equal(records.data[0].startDate, '2026-09-20');
      assert.equal(records.data[0].campaignName, 'Historical date retained');
    });
    await check('Campaign sections filter real records without claiming publication', async () => {
      await page.locator('[data-campaign-section="Draft"]').click();
      assert.match(await page.locator('#campaign-results').innerText(), /Historical date retained/);
      for (const section of ['Scheduled', 'Published']) {
        await page.locator('[data-campaign-section="' + section + '"]').click();
        assert.equal(await page.locator('#export-campaigns').isDisabled(), true);
        assert.equal(await page.locator('#campaign-results tbody tr').count(), 0);
      }
      assert.equal(await page.locator('footer').count(), 0);
    });
    await check('Campaign section controls fit a narrow screen', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, 'sections-390.png'), fullPage: true });
    });
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
