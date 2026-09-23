'use strict';
// Explicit local recovery. Original files are retained, never silently deleted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('../backend/node_modules/better-sqlite3');

function inspectDatabase(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) throw new Error('The selected database failed integrity or relationship checks.');
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const name of ['campaigns', 'leads', 'schema_migrations', 'campaign_assets']) if (!names.has(name)) throw new Error('This is not a supported Divinenet backup.');
    return { campaigns: db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n, leads: db.prepare('SELECT COUNT(*) AS n FROM leads').get().n };
  } finally { db.close(); }
}

async function restore(root, selected, { apply = false } = {}) {
  root = path.resolve(root);
  const source = fs.realpathSync(path.resolve(selected));
  const data = path.join(root, 'data');
  const target = path.join(data, 'divinenet.sqlite');
  if (source.toLowerCase() === target.toLowerCase()) throw new Error('Choose a backup, not the working database.');
  const counts = inspectDatabase(source);
  if (!apply) return { applied: false, source, counts, message: 'Backup validated only. To restore, stop this CRM and repeat with --apply.' };
  fs.mkdirSync(data, { recursive: true });
  const lock = path.join(data, '.maintenance.lock');
  const lockFd = fs.openSync(lock, 'wx');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex');
  const stage = path.join(data, 'restore-' + stamp + '.sqlite');
  const preserved = path.join(root, 'backups', 'before-restore-' + stamp);
  const moved = [];
  try {
    const recordFile = path.join(root, 'logs', 'crm-launch.json');
    if (fs.existsSync(recordFile)) {
      const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
      if (!Number.isInteger(record.processId) || record.processId < 1) throw new Error('Invalid startup record; recovery stopped safely.');
      try { process.kill(record.processId, 0); throw new Error('The recorded CRM process is still running. Use STOP-CRM.cmd before restoring.'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (fs.existsSync(target)) {
      const current = new Database(target, { fileMustExist: true, timeout: 0 });
      try {
        // Refuse any active reader/writer that prevents a clean checkpoint.
        const checkpoint = current.pragma('wal_checkpoint(TRUNCATE)')[0];
        if (checkpoint?.busy) throw new Error('Database is in use. Close all CRM processes before recovery.');
        current.exec('BEGIN EXCLUSIVE; ROLLBACK;');
      } finally { current.close(); }
    }
    const backup = new Database(source, { readonly: true, fileMustExist: true });
    try { await backup.backup(stage); } finally { backup.close(); }
    inspectDatabase(stage);
    fs.mkdirSync(preserved, { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(target + suffix)) {
        fs.renameSync(target + suffix, path.join(preserved, 'divinenet.sqlite' + suffix));
        moved.push(suffix);
      }
    }
    fs.renameSync(stage, target);
    return { applied: true, source, counts, preserved, message: 'Restore completed. Start the CRM and verify records. Earlier files remain in the recovery folder.' };
  } catch (error) {
    if (!fs.existsSync(target)) for (const suffix of moved) {
      const old = path.join(preserved, 'divinenet.sqlite' + suffix);
      if (fs.existsSync(old)) fs.renameSync(old, target + suffix);
    }
    throw error;
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock); // Only our newly created maintenance marker.
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args[0] || args.some((arg, i) => i > 0 && arg !== '--apply')) {
    console.log('Usage: node scripts/restore-crm.cjs "full path to backup.sqlite" [--apply]\nWithout --apply this only validates. Stop the CRM before applying a restore.');
    process.exitCode = 1;
  } else restore(path.resolve(__dirname, '..'), args[0], { apply: args.includes('--apply') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { restore, inspectDatabase };
