const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('./db/connection');
const { localImageEndpoint } = require('./services/local-image-provider');
const { readImageConfig } = require('./services/image-assets');

async function requireClosedPort(host, port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); reject(new Error('A review service is still running. Stop both CRM and the image runtime before resetting.')); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Could not verify that the service is stopped; reset cancelled.')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('Could not verify that the service is stopped; reset cancelled.')));
  });
}

async function resetImageRuntime() {
  if (!process.argv.includes('--confirm-runtime-stopped') || process.env.NODE_ENV === 'production') {
    throw new Error('Local recovery only. Stop sd-server and CRM, then pass --confirm-runtime-stopped.');
  }
  const runtime = new URL(localImageEndpoint(readImageConfig().baseUrl));
  const crmPort = Number(process.env.PORT || 3183);
  if (!Number.isInteger(crmPort) || crmPort < 1 || crmPort > 65535) throw new Error('Set PORT to the stopped CRM review port');
  await requireClosedPort(runtime.hostname.replace(/^\[|\]$/g, ''), Number(runtime.port || 80));
  await requireClosedPort('127.0.0.1', crmPort);
  const filename = path.resolve(process.env.CRM_DATABASE_PATH || path.join(__dirname, 'db/divinenet-crm.sqlite'));
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) throw new Error('Set CRM_DATABASE_PATH to the existing review database; no new database will be created');
  const db = createDatabase(filename);
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_runtime_guard'").get()) {
      throw new Error('This database has no local image runtime recovery state');
    }
    db.prepare("UPDATE ai_runtime_guard SET state='Ready',updated_at=? WHERE id=1").run(new Date().toISOString());
    console.log('Local image runtime retry guard reset. Restart sd-server, then CRM. No campaign or banner records were changed.');
  } finally { db.close(); }
}

if (require.main === module) resetImageRuntime().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { requireClosedPort };
