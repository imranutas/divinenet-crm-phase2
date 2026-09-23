const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
const { createDatabase } = require('../db/connection');

// A cold backup is copied only after this test's server and database are closed.
// It is restored to another new file, never over a developer's database.
async function isolatedStore(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const folder = fs.mkdtempSync(path.join(temporaryRoot, 'divinenet-cold-restore-'));
  let db;
  let server;
  let base;

  function ownedFile(name) {
    const filename = path.resolve(folder, name);
    assert.equal(path.dirname(filename), path.resolve(folder));
    return filename;
  }

  async function close() {
    if (server) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server = undefined;
    }
    if (db) {
      db.close();
      db = undefined;
    }
  }

  async function open(name) {
    assert.equal(db, undefined, 'Close the previous database before opening another');
    db = createDatabase(ownedFile(name));
    // createApp runs the real migrations and normal startup, without sample seeds.
    const { app } = createApp({  
      db,  
      imageConfig: {},   
      campaignNow: () => new Date('2026-09-12T02:00:00Z') 
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }

  async function request(route, method = 'GET', body, expectedStatus = 200) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    assert.equal(response.status, expectedStatus, method + ' ' + route + ': ' + JSON.stringify(result));
    assert.equal(result.success, true);
    return result.data;
  }

  function coldCopy(from, to) {
    assert.equal(server, undefined, 'Stop the server before copying SQLite files');
    assert.equal(db, undefined, 'Close SQLite before making the cold backup');
    const source = ownedFile(from);
    // Never treat a live WAL as a complete single-file backup.
    for (const suffix of ['-wal', '-journal']) {
      const sidecar = source + suffix;
      assert.ok(!fs.existsSync(sidecar) || fs.statSync(sidecar).size === 0, 'Unsettled SQLite sidecar: ' + suffix);
    }
    fs.copyFileSync(source, ownedFile(to), fs.constants.COPYFILE_EXCL);
  }

  function fingerprint(name) {
    return createHash('sha256').update(fs.readFileSync(ownedFile(name))).digest('hex');
  }

  t.after(async () => {
    await close();
    const exactFolder = fs.realpathSync(folder);
    assert.equal(exactFolder, path.resolve(folder));
    assert.equal(path.dirname(exactFolder), temporaryRoot);
    assert.ok(path.basename(exactFolder).startsWith('divinenet-cold-restore-'));
    assert.equal(fs.lstatSync(exactFolder).isSymbolicLink(), false);
    fs.rmSync(exactFolder, { recursive: true, force: false });
  });

  await open('source.sqlite');
  return { request, close, open, coldCopy, fingerprint, get db() { return db; } };
}

const campaign = {
  campaignName: 'Synthetic recovery campaign', prompt: 'Synthetic recovery brief',
  startDate: '2026-09-12', endDate: '2026-09-20', channel: 'Website', budget: '10k'
};
const lead = campaignId => ({
  campaignId, name: 'Synthetic recovery lead', email: 'recovery@example.com',
  sourcePlatform: 'Website', consentStatus: 'Recorded'
});

test('cold restore preserves linked campaign, directory records and lead stage history', async t => {
  const store = await isolatedStore(t);
  const client = await store.request('/api/clients', 'POST', { name: 'Synthetic recovery client' }, 201);
  const brand = await store.request('/api/brands', 'POST', { name: 'Synthetic recovery brand' }, 201);
  const savedCampaign = await store.request('/api/campaigns', 'POST', { ...campaign, clientId: client.id, brandId: brand.id }, 201);
  const savedLead = await store.request('/api/leads', 'POST', lead(savedCampaign.id), 201);
  const contactedLead = await store.request('/api/leads/' + savedLead.id + '/stage', 'PATCH', { stage: 'Contacted' });
  const history = await store.request('/api/leads/' + savedLead.id + '/history');
  assert.equal(history.length, 1);
  assert.equal(history[0].lead_id, savedLead.id);
  assert.equal(history[0].from_stage, 'New');
  assert.equal(history[0].to_stage, 'Contacted');
  assert.deepEqual(store.db.pragma('foreign_key_check'), []);

  await store.close();
  store.coldCopy('source.sqlite', 'backup.sqlite');
  const backupHash = store.fingerprint('backup.sqlite');

  // A later change in the original must not leak into the restored snapshot.
  await store.open('source.sqlite');
  await store.request('/api/campaigns/' + savedCampaign.id, 'PUT', { campaignName: 'Synthetic later edit' });
  await store.request('/api/campaigns', 'POST', { ...campaign, campaignName: 'Synthetic later campaign' }, 201);
  await store.close();
  store.coldCopy('backup.sqlite', 'restored.sqlite');
  await store.open('restored.sqlite');

  assert.deepEqual(await store.request('/api/campaigns'), [savedCampaign]);
  assert.deepEqual(await store.request('/api/leads'), [contactedLead]);
  assert.deepEqual(await store.request('/api/leads/' + savedLead.id + '/history'), history);
  assert.deepEqual(await store.request('/api/clients'), [client]);
  assert.deepEqual(await store.request('/api/brands'), [brand]);
  assert.equal(store.db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(store.db.pragma('foreign_key_check'), []);
  assert.deepEqual(store.db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  assert.equal(store.fingerprint('backup.sqlite'), backupHash, 'Restore must not change the saved backup');
});

test('cold restore of an intentionally empty database adds no sample records and preserves ID counters', async t => {
  const store = await isolatedStore(t);
  const savedCampaign = await store.request('/api/campaigns', 'POST', campaign, 201);
  const savedLead = await store.request('/api/leads', 'POST', lead(savedCampaign.id), 201);
  await store.request('/api/leads/' + savedLead.id, 'DELETE');
  await store.request('/api/campaigns/' + savedCampaign.id, 'DELETE');
  await store.close();
  store.coldCopy('source.sqlite', 'empty-backup.sqlite');
  store.coldCopy('empty-backup.sqlite', 'empty-restored.sqlite');
  await store.open('empty-restored.sqlite');

  for (const route of ['/api/campaigns', '/api/leads', '/api/clients', '/api/brands']) {
    assert.deepEqual(await store.request(route), [], route + ' must stay empty');
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM lead_stage_history').get().count, 0);
  assert.deepEqual(store.db.pragma('foreign_key_check'), []);
  assert.deepEqual(store.db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  const nextCampaign = await store.request('/api/campaigns', 'POST', campaign, 201);
  const nextLead = await store.request('/api/leads', 'POST', lead(nextCampaign.id), 201);
  assert.equal(nextCampaign.id, 'CAM-002');
  assert.equal(nextLead.id, 'LEAD-002');
});
test('cold restore preserves approved banner and save-request receipt without duplicates', async t => {
  const store = await isolatedStore(t);

  // Synthetic PNG fixture used only for this regression test.
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQCVjwHwADhAIEWAExyQAAAABJRU5ErkJggg==',
    'base64'
  );

  // Reopen the source database with a controlled test-double image provider.
  await store.close();

  const sourcePath = path.join(
    fs.realpathSync(os.tmpdir()),
    'unused'
  );

  // Use a separate isolated environment because banner generation requires
  // the explicitly configured provider boundary.
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'divinenet-banner-recovery-'));
  const original = path.join(folder, 'original.sqlite');
  const backup = path.join(folder, 'backup.sqlite');
  const restored = path.join(folder, 'restored.sqlite');

  let db;
  let server;
  let base;

  async function open(filename) {
    db = createDatabase(filename);
    const { app } = createApp({
      db,
      campaignNow: () => new Date('2026-09-12T02:00:00Z'),
      imageConfig: {},
      imageProvider: {
        provider: 'test-double',
        model: 'synthetic-fixture',
        generate: async () => ({ bytes: pngBytes })
      }
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }

  async function close() {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      server = undefined;
    }
    if (db) {
      db.close();
      db = undefined;
    }
  }

  async function request(route, method = 'GET', body, expectedStatus = 200) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const result = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.equal(result.success, true);
    return result.data;
  }

  t.after(async () => {
    await close();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  await open(original);

  const generated = await request('/api/banner-drafts/generate', 'POST', {
    prompt: 'Synthetic recovery banner',
    consentToSend: true
  }, 201);

  const approved = await request(
    '/api/banner-drafts/' + generated.id + '/approve',
    'POST',
    { reviewed: true }
  );

  const clientRequestId = require('node:crypto').randomUUID();

  const body = {
    ...campaign,
    bannerDraftId: approved.id,
    clientRequestId
  };

  const saved = await request('/api/campaigns', 'POST', body, 201);
  const assets = await request('/api/campaigns/' + saved.id + '/assets');

  assert.equal(assets.length, 1);
  assert.equal(assets[0].campaignId, saved.id);
  assert.equal(assets[0].status, 'Approved');

  const originalDownload = await fetch(base + assets[0].downloadUrl);
  const originalBytes = Buffer.from(await originalDownload.arrayBuffer());
  const originalHash = createHash('sha256').update(originalBytes).digest('hex');

  assert.deepEqual(originalBytes, pngBytes);

  // Cold backup: the original database must be closed before copying.
  await close();
  fs.copyFileSync(original, backup, fs.constants.COPYFILE_EXCL);

  const originalHashBeforeRestore = createHash('sha256')
    .update(fs.readFileSync(original))
    .digest('hex');

  const backupHashBeforeRestore = createHash('sha256')
    .update(fs.readFileSync(backup))
    .digest('hex');

  // Restore into a different database file.
  fs.copyFileSync(backup, restored, fs.constants.COPYFILE_EXCL);
  await open(restored);

  const restoredAssets = await request('/api/campaigns/' + saved.id + '/assets');

  assert.equal(restoredAssets.length, 1);
  assert.equal(restoredAssets[0].id, assets[0].id);
  assert.equal(restoredAssets[0].campaignId, saved.id);
  assert.equal(restoredAssets[0].status, 'Approved');

  const restoredDownload = await fetch(base + restoredAssets[0].downloadUrl);
  const restoredBytes = Buffer.from(await restoredDownload.arrayBuffer());
  const restoredHash = createHash('sha256').update(restoredBytes).digest('hex');

  assert.equal(restoredHash, originalHash);
  assert.deepEqual(restoredBytes, pngBytes);

  // The saved clientRequestId receipt must survive restoration.
  // Identical retry must return the existing campaign, not create duplicates.
  const retried = await request('/api/campaigns', 'POST', body);
  assert.deepEqual(retried, saved);

  assert.equal((await request('/api/campaigns')).length, 1);
  assert.equal((await request('/api/campaigns/' + saved.id + '/assets')).length, 1);

  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);

  await close();

  // Recovery must not alter either the original database or its cold backup.
  assert.equal(
    createHash('sha256').update(fs.readFileSync(original)).digest('hex'),
    originalHashBeforeRestore
  );
  assert.equal(
    createHash('sha256').update(fs.readFileSync(backup)).digest('hex'),
    backupHashBeforeRestore
  );
});
