'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('../backend/node_modules/better-sqlite3');
const root = path.resolve(__dirname, '..');
(async () => {
  const source = path.join(root, 'data', 'divinenet.sqlite');
  if (!fs.existsSync(source)) throw new Error('No working database yet. Start the CRM first.');
  const destination = path.join(root, 'backups', 'divinenet-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0,8) + '.sqlite');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(destination); } finally { db.close(); }
  const check = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    if (check.pragma('integrity_check', { simple: true }) !== 'ok' || check.pragma('foreign_key_check').length) throw new Error('Backup was created but validation failed; do not use it for recovery.');
  } finally { check.close(); }
  console.log('A new validated database backup was created:\n' + destination + '\nThe original database was not replaced.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
