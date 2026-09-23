'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createApp } = require('../backend/app');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'test-evidence', 'access-live-' + new Date().toISOString().replace(/[:.]/g, '-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-access-browser-'));
fs.mkdirSync(evidence, { recursive: true });
const live = process.env.CRM_TEST_LIVE_AI === 'true';
const report = {
  recordedAt: new Date().toISOString(),
  executor: process.env.CRM_TEST_EXECUTOR || 'Unspecified executor',
  liveAI: live,
  checks: [],
  limitations: [
    'Isolated synthetic records, not customer data',
    'Not independent member QA or client acceptance',
    'Local only; no external integration'
  ]
};
let browser, server, db, page, base;

const checks = async (name, action) => {
  try {
    await action();
    report.checks.push({ name, result: 'Pass' });
    console.log('PASS ' + name);
  } catch (error) {
    report.checks.push({ name, result: 'Fail', message: error.message });
    throw error;
  }
};

async function main() {
  const created = createApp({
    databasePath: path.join(temporary, 'crm.sqlite'),
    accessControl: true,
    imageConfig: live
      ? {
          provider: 'sd-cpp',
          approved: true,
          baseUrl: 'http://127.0.0.1:1234',
          model: require('./ai-runtime-files.json').modelLabel
        }
      : {}
  });

  db = created.db;

  server = await new Promise(resolve => {
    const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
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
  page.setDefaultTimeout(15000);

  const password = crypto.randomBytes(20).toString('hex');

  const request = async (route, data, method = 'GET') => {
    const response = await context.request.fetch(base + route, {
      method,
      ...(data ? { data } : {})
    });

    assert.ok(response.ok(), route + ': ' + response.status());
    return (await response.json()).data;
  };

  await checks(
    'First-use admin setup works in the browser and anonymous records stay private',
    async () => {
      assert.equal((await fetch(base + '/api/campaigns')).status, 401);

      await page.goto(base);
      await page.locator('#entry-submit').waitFor();
      await page.locator('#entry-username').fill('testadmin');
      await page.locator('#entry-password').fill(password);
      await page.locator('#entry-submit').click();
      await page.locator('#connection.online').waitFor();

      assert.equal(
        (await request('/api/account/status')).user.role,
        'admin'
      );
    }
  );

  await checks(
    'Authenticated navigation fits desktop, tablet and phone',
    async () => {
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(base + '/#dashboard');
        await page.locator('#connection.online').waitFor();

        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          ),
          'No page overflow at ' + width
        );

        await page.screenshot({
          path: path.join(evidence, 'dashboard-' + width + '.png'),
          fullPage: true
        });
      }

      await page.setViewportSize({
        width: 1440,
        height: 1000
      });
    }
  );

  let campaign, originalBytes;

  await checks(
    'Create a real stored campaign with local dates and optional genuine generated banner',
    async () => {
      await page.goto(base + '/#campaigns');
      await page.locator('#connection.online').waitFor();
      await page.locator('#primary-action').click();

      await page
        .locator('#field-campaignName')
        .fill('Synthetic product walkthrough');

      await page
        .locator('#field-prompt')
        .fill('Spring workshop promotion with a calm green garden background.');

      await page.locator('#field-budget').fill('10k');
      await page.locator('#field-status').selectOption('Active');

      assert.match(
        await page.locator('#field-startDate').inputValue(),
        /^\d{4}-\d{2}-\d{2}$/
      );

      if (live) {
        const start = Date.now();

        await page
          .locator('#banner-prompt')
          .fill(
            'Editorial photography of a lush green garden with soft morning sunlight, generous clear space, refined natural composition, no writing, no people.'
          );

        await page.locator('#banner-consent').check();

        const [response] = await Promise.all([
          page.waitForResponse(
            r => r.url().endsWith('/api/banner-drafts/generate'),
            { timeout: 135000 }
          ),
          page.locator('#generate-banner').click()
        ]);

        assert.equal(response.status(), 201, await response.text());

        report.generationSeconds =
          (Date.now() - start) / 1000;

        await page.locator('#banner-preview').waitFor();

        await page.waitForFunction(() => {
          const image =
            document.getElementById('banner-preview');
          return image.complete && image.naturalWidth > 0;
        });

        await page.locator('#banner-review').check();
        await page.locator('#approve-banner').click();

        await page.waitForFunction(() =>
          /approved/i.test(
            document.getElementById('banner-message').textContent
          )
        );

        await page.screenshot({
          path: path.join(
            evidence,
            'genuine-local-banner-in-campaign.png'
          ),
          fullPage: true
        });
      }

      await page.locator('#save-record').click();
      await page.locator('#editor').waitFor({ state: 'hidden' });

      campaign =
        (await request('/api/campaigns'))[0];

      assert.equal(campaign.budget, 10000);
      assert.equal(campaign.status, 'Active');

      if (live) {
        const assets = await request(
          '/api/campaigns/' +
            campaign.id +
            '/assets'
        );

        assert.equal(assets.length, 1);
        assert.equal(assets[0].provider, 'sd-cpp');

        const download =
          await context.request.get(
            base + assets[0].downloadUrl
          );

        originalBytes = await download.body();

        assert.equal(download.status(), 200);

        fs.writeFileSync(
          path.join(evidence, 'actual-model-output.png'),
          originalBytes
        );
      }
    }
  );

  await checks(
    'Unauthenticated local response form creates exactly one linked lead without exposing private data',
    async () => {
      const form = await request(
        '/api/campaigns/' +
          campaign.id +
          '/intake-link',
        {},
        'POST'
      );

      const respondent = await browser.newContext();
      const visitor = await respondent.newPage();

      await visitor.goto(base + form.url);

      await visitor
        .locator('#capture-name')
        .fill('Synthetic respondent');

      await visitor
        .locator('#capture-email')
        .fill('respondent@example.test');

      await visitor.getByRole('checkbox').check();
      await visitor.locator('#capture-submit').click();

      await visitor
        .getByRole('status')
        .filter({ hasText: /saved|received|thank/i })
        .waitFor();

      const leads = await request('/api/leads');

      assert.equal(leads.length, 1);
      assert.equal(leads[0].campaignId, campaign.id);
      assert.equal(leads[0].consentStatus, 'Recorded');

      assert.equal(
        (
          await respondent.request.get(
            base + '/api/leads'
          )
        ).status(),
        401
      );

      await respondent.close();
    }
  );

  await checks(
    'Admin creates viewer; viewer can read but not change campaigns or request an intake link',
    async () => {
      await page.goto(base + '/auth.html');

      await page
        .locator('#add-username')
        .fill('testviewer');

      await page
        .locator('#add-password')
        .fill(password);

      await page
        .locator('#add-role')
        .selectOption('viewer');

      await page
        .locator('#account-add-form button')
        .click();

      await page
        .locator('#account-users')
        .getByText('testviewer', { exact: true })
        .waitFor();

      const viewer = await browser.newContext();
      const vp = await viewer.newPage();

      await vp.goto(base + '/auth.html');

      await vp
        .locator('#entry-username')
        .fill('testviewer');

      await vp
        .locator('#entry-password')
        .fill(password);

      await vp.locator('#entry-submit').click();
      await vp.locator('#connection.online').waitFor();

      assert.equal(
        await vp.locator('#primary-action').isVisible(),
        false
      );

      assert.equal(
        (
          await viewer.request.post(
            base +
              '/api/campaigns/' +
              campaign.id +
              '/intake-link',
            { data: {} }
          )
        ).status(),
        403
      );

      assert.equal(
        (
          await viewer.request.post(
            base + '/api/banner-drafts/upload',
            { data: {} }
          )
        ).status(),
        403
      );

      await viewer.close();
    }
  );

  await checks(
    'SQLite restart preserves campaign, lead, account and approved image bytes',
    async () => {
      await new Promise(resolve =>
        server.close(resolve)
      );

      db.close();

      const reopened = createApp({
        databasePath: path.join(
          temporary,
          'crm.sqlite'
        ),
        accessControl: true,
        imageConfig: {}
      });

      db = reopened.db;
      server = null;

      assert.equal(
        db.prepare(
          'SELECT count(*) AS n FROM campaigns'
        ).get().n,
        1
      );

      assert.equal(
        db.prepare(
          'SELECT count(*) AS n FROM leads'
        ).get().n,
        1
      );

      assert.equal(
        db.prepare(
          'SELECT count(*) AS n FROM local_users'
        ).get().n,
        2
      );

      if (live) {
        assert.deepEqual(
          db.prepare(
            'SELECT image_data FROM campaign_assets'
          ).get().image_data,
          originalBytes
        );
      }

      assert.equal(
        db.pragma('integrity_check', { simple: true }),
        'ok'
      );

      assert.deepEqual(
        db.pragma('foreign_key_check'),
        []
      );
    }
  );
}

main()
  .catch(async error => {
    report.error = error.message;
    process.exitCode = 1;

    console.error(error.stack);

    if (page) {
      await page
        .screenshot({
          path: path.join(
            evidence,
            'failure.png'
          ),
          fullPage: true
        })
        .catch(() => {});
    }
  })
  .finally(async () => {
    await browser?.close();

    if (server?.listening) {
      await new Promise(resolve =>
        server.close(resolve)
      );
    }

    db?.close();

    fs.writeFileSync(
      path.join(evidence, 'results.json'),
      JSON.stringify(report, null, 2)
    );

    console.log('Evidence: ' + evidence);
  });