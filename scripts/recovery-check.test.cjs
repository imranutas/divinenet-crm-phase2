'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../backend/app');
const { restore, inspectDatabase } = require('./restore-crm.cjs');
const Database = require('../backend/node_modules/better-sqlite3');
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'divinenet-recovery-'));
  fs.mkdirSync(path.join(root, 'data'));
  // Leave isolated test records for evidence; no user database is touched.
  return root;
}
test('restore validates without mutation, restores separately and retains the previous database', async t => {
  const root = workspace(t);
  const file = path.join(root, 'data', 'divinenet.sqlite');
  const { db } = createApp({ databasePath: file, imageConfig: {} });
  db.prepare("INSERT INTO clients(id,name) VALUES('CLIENT-T','Synthetic restore client')").run();
  const backup = path.join(root, 'selected.sqlite');
  await db.backup(backup);
  db.prepare("INSERT INTO clients(id,name) VALUES('CLIENT-LATER','Later preserved record')").run();
  db.close();
  assert.equal((await restore(root, backup)).applied, false);
  const before = new Database(file, { readonly: true });
  assert.equal(before.prepare('SELECT count(*) AS n FROM clients').get().n, 2);
  before.close();
  const result = await restore(root, backup, { apply: true });
  assert.equal(result.applied, true);
  const restored = new Database(file, { readonly: true });
  assert.equal(restored.prepare('SELECT count(*) AS n FROM clients').get().n, 1);
  restored.close();
  const retained = new Database(path.join(result.preserved, 'divinenet.sqlite'), { readonly: true });
  assert.equal(retained.prepare('SELECT count(*) AS n FROM clients').get().n, 2);
  retained.close();
  assert.equal(fs.existsSync(path.join(root, 'data', '.maintenance.lock')), false);
});
test('restore refuses live process, same working database and unrelated SQLite', async t => {
  const root = workspace(t), file = path.join(root, 'data', 'divinenet.sqlite');
  const { db } = createApp({ databasePath: file, imageConfig: {} });
  const backup = path.join(root, 'selected.sqlite');
  await db.backup(backup); db.close();
  await assert.rejects(restore(root, file, { apply: true }), /Choose a backup/);
  fs.mkdirSync(path.join(root, 'logs'));
  fs.writeFileSync(path.join(root, 'logs', 'crm-launch.json'), JSON.stringify({ processId: process.pid }));
  await assert.rejects(restore(root, backup, { apply: true }), /still running/);
  const other = path.join(root, 'unrelated.sqlite');
  new Database(other).close();
  assert.throws(() => inspectDatabase(other), /not a supported/);
  assert.equal(fs.existsSync(file), true);
});
