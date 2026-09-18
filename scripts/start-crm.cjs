'use strict';
// Package-owned launcher. Never adopts ownership of an already running process.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');
const pinned = require('./ai-runtime-files.json');
const ROOT = path.resolve(__dirname, '..');
const CRM_PORT = 3192;
const AI_PORT = 1234;
const AI_URL = 'http://127.0.0.1:' + AI_PORT;
const CRM_URL = 'http://127.0.0.1:' + CRM_PORT;
const LOGS = path.join(ROOT, 'logs');
const OWN_RECORD = path.join(LOGS, 'runtime-launch.json');
const CRM_RECORD = path.join(LOGS, 'crm-launch.json');
const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\divinenet-crm-' + crypto.createHash('sha256').update(ROOT.toLowerCase()).digest('hex').slice(0, 20) : path.join(LOGS, 'crm-control.sock');
let ownedRuntime;
let crmStarted = false;
let controlServer;
let crmServer;
let crmDatabase;
let stopping = false;
let shutdownCode = 0;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function samePath(a, b) { return typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }
function configFor(root = ROOT) {
  const file = path.join(root, 'launcher.config.json');
  const config = fs.existsSync(file) ? readJson(file) : {};
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('launcher.config.json must contain an object.');
  for (const key of Object.keys(config)) if (!['aiDirectory', 'enableAI', 'openBrowser'].includes(key)) throw new Error('Unknown launcher setting: ' + key);
  for (const key of ['enableAI', 'openBrowser']) if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new Error(key + ' must be true or false.');
  if (config.aiDirectory != null && (typeof config.aiDirectory !== 'string' || !config.aiDirectory.trim())) throw new Error('aiDirectory must be a nonempty path or null.');
  return { enableAI: true, openBrowser: true, ...config };
}

function aiDirectory(config, root = ROOT) {
  if (config.aiDirectory) return path.resolve(root, config.aiDirectory);
  return [path.join(root, 'ai'), path.resolve(root, '../../AI_RUNTIME_PILOT_15_SEPTEMBER_2026')].find(dir => fs.existsSync(path.join(dir, 'manifest.json')));
}

function assertDependencies() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24 is required; found ' + process.version + '. Nothing was installed or changed.');
  const localRequire = createRequire(path.join(ROOT, 'backend/package.json'));
  try {
    for (const dependency of ['express', 'cors', 'better-sqlite3']) {
      const resolved = localRequire.resolve(dependency);
      if (!resolved.toLowerCase().startsWith(path.join(ROOT, 'backend/node_modules').toLowerCase() + path.sep)) throw new Error('Dependency is outside this package');
    }
    localRequire('express');
    localRequire('cors');
    const Database = localRequire('better-sqlite3');
    let probe;
    try {
      probe = new Database(':memory:');
      const result = probe.prepare('SELECT 1 AS ready').get();
      if (result.ready !== 1) throw new Error('SQLite readiness query failed');
    } finally {
      if (probe) probe.close();
    }
  } catch (error) {
    throw new Error('Backend dependencies are missing or incompatible in this package. Restore backend/node_modules from the supplied package, or run npm ci --prefix backend separately if you choose to download dependencies. Details: ' + error.message);
  }
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('Port ' + port + ' is occupied or unavailable. Existing services were left untouched.')));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(resolve));
  });
}

function parseListeners(output, port) {
  return output.split(/\r?\n/).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== 'TCP' || fields[3] !== 'LISTENING' || !fields[1].endsWith(':' + port)) return [];
    const pid = Number(fields[4]);
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Unrecognised runtime listener owner.');
    return [{ address: fields[1].slice(0, -(String(port).length + 1)), pid }];
  });
}

function listeners(port) {
  const result = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) throw new Error('Cannot safely inspect local runtime ownership.');
  return parseListeners(result.stdout, port);
}

function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid runtime process identity.');
  const command = `$p=Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{processId=$p.Id;executable=$p.Path;started=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) throw new Error('Cannot verify the existing image-runtime process.');
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
}

function recordedIdentityMatches(record, actual, expectedExe) {
  return record?.processId === actual?.processId && samePath(record.executable, expectedExe) && samePath(actual.executable, expectedExe) &&
    Number.isFinite(Date.parse(record.started)) && Number.isFinite(Date.parse(actual.started)) && Math.abs(Date.parse(record.started) - Date.parse(actual.started)) <= 5000;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyAI(dir) {
  console.log('Checking pinned local AI files (about 6 GB; no download)...');
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (manifest.runtimeCommit !== pinned.runtimeCommit) throw new Error('The AI runtime version is not the reviewed version.');
  for (const notice of pinned.notices) if (!fs.statSync(path.join(dir, notice)).isFile()) throw new Error('Missing AI provenance/licence notice: ' + notice);
  for (const [relative, size, digest] of pinned.files) {
    const file = path.join(dir, relative);
    if (fs.statSync(file).size !== size || await sha256(file) !== digest) throw new Error('AI file verification failed: ' + relative);
  }
  const expectedRuntimeNames = new Set(pinned.files.filter(([name]) => name.startsWith('runtime/')).map(([name]) => path.basename(name).toLowerCase()));
  for (const name of fs.readdirSync(path.join(dir, 'runtime'))) if (/\.(dll|exe)$/i.test(name) && !expectedRuntimeNames.has(name.toLowerCase())) throw new Error('Unexpected runtime executable: ' + name);
}

async function readEndpoint(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error('Readiness request returned HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 100000) throw new Error('Unexpected readiness response.');
  return JSON.parse(text);
}

function capabilitiesMatch(value) {
  const defaults = value?.defaults;
  return value?.current_mode === 'img_gen' && value?.model?.name === 'z_image_turbo-Q3_K.gguf' &&
    defaults?.width === 768 && defaults?.height === 512 && defaults?.seed === 42 &&
    defaults?.batch_count === 1 && defaults?.output_format === 'png' &&
    defaults?.sample_params?.sample_steps === 8 && defaults?.sample_params?.sample_method === 'euler' && defaults?.sample_params?.guidance?.txt_cfg === 1;
}

async function readyAI() {
  const models = await readEndpoint(AI_URL + '/v1/models');
  if (!Array.isArray(models.data) || !models.data.some(item => item.id === 'sd-cpp-local')) throw new Error('Unexpected local image server.');
  if (!capabilitiesMatch(await readEndpoint(AI_URL + '/sdcpp/v1/capabilities'))) throw new Error('Loaded model/settings do not match the reviewed AI pilot.');
}

function runtimeArgs() {
  return ['--listen-ip','127.0.0.1','--listen-port',String(AI_PORT),'--diffusion-model','z_image_turbo-Q3_K.gguf','--llm','Qwen3-4B-Instruct-2507-Q4_K_M.gguf','--vae','ae.safetensors','--backend','Vulkan1','--offload-to-cpu','--max-vram','6.5','--diffusion-fa','--threads','8','--width','768','--height','512','--steps','8','--cfg-scale','1.0','--sampling-method','euler','--seed','42','--log-level','info'];
}

async function prepareAI(config, checkOnly) {
  if (!config.enableAI) { console.log('AI disabled by launcher choice. Campaigns and leads remain available.'); return false; }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This optional AI pilot requires Windows x64 with the reviewed Vulkan GPU setup.');
  const dir = aiDirectory(config);
  if (!dir) throw new Error('Optional AI files were not found; use an ai folder or launcher.config.json aiDirectory.');
  await verifyAI(dir);
  const exe = path.join(dir, 'runtime/sd-server.exe');
  const current = listeners(AI_PORT);
  if (current.length) {
    if (current.some(item => item.address !== '127.0.0.1' || item.pid !== current[0].pid)) throw new Error('Port 1234 is not one verified loopback-only runtime.');
    const actual = processIdentity(current[0].pid);
    const records = [OWN_RECORD, path.join(dir, 'runtime-launch.json')].filter(fs.existsSync).map(readJson);
    if (!records.some(record => recordedIdentityMatches(record, actual, exe))) throw new Error('The existing runtime is not identified by a matching process record.');
    await readyAI();
    console.log('Using the verified existing local AI runtime. This launcher will NEVER stop that existing process.');
    return true;
  }
  await assertPortFree(AI_PORT);
  if (checkOnly) { console.log('AI files are valid; runtime is stopped. --check does not start it.'); return false; }
  // A live recorded process without its listener may still be loading or busy: never start a duplicate.
  for (const file of [OWN_RECORD, path.join(dir, 'runtime-launch.json')]) {
    if (!fs.existsSync(file)) continue;
    const record = readJson(file);
    try { process.kill(record.processId, 0); throw new Error('A recorded runtime process is still present without readiness; inspect it before restarting.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  fs.mkdirSync(LOGS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = fs.openSync(path.join(LOGS, 'ai-' + stamp + '.stdout.log'), 'ax');
  const err = fs.openSync(path.join(LOGS, 'ai-' + stamp + '.stderr.log'), 'ax');
  try { ownedRuntime = spawn(exe, runtimeArgs(), { cwd: dir, windowsHide: true, stdio: ['ignore', out, err] }); }
  finally { fs.closeSync(out); fs.closeSync(err); }
  await new Promise((resolve, reject) => { ownedRuntime.once('spawn', resolve); ownedRuntime.once('error', reject); });
  const actual = processIdentity(ownedRuntime.pid);
  if (!samePath(actual.executable, exe)) throw new Error('New runtime executable identity mismatch.');
  fs.writeFileSync(OWN_RECORD, JSON.stringify({ ...actual, workingDirectory: dir, arguments: runtimeArgs(), listener: AI_URL, runtimeCommit: pinned.runtimeCommit, attribution: 'Package launcher process; not member QA or client acceptance' }, null, 2) + '\n');
  console.log('Starting the optional local AI runtime. Waiting for model readiness...');
  const readinessDeadline = Date.now() + 120000;
  let nextNotice = Date.now() + 15000;
  while (Date.now() < readinessDeadline) {
    if (ownedRuntime.exitCode !== null) throw new Error('AI runtime exited; inspect package logs. The GPU setup may not match this computer.');
    try {
      await readyAI();
      const bound = listeners(AI_PORT);
      if (bound.length !== 1 || bound[0].pid !== ownedRuntime.pid || bound[0].address !== '127.0.0.1') throw new Error('Unexpected newly started runtime listener.');
      console.log('The package-started AI runtime is ready.');
      return true;
    } catch { await delay(1000); }
    if (Date.now() >= nextNotice) { console.log('Still waiting for optional AI readiness...'); nextNotice = Date.now() + 15000; }
  }
  throw new Error('AI startup timed out; core CRM will remain available.');
}

function stopOwnedRuntime() {
  if (ownedRuntime && ownedRuntime.exitCode === null && !ownedRuntime.killed) ownedRuntime.kill();
}

function stopCRM(code = 0) {
  shutdownCode = Math.max(shutdownCode, code);
  if (stopping) return;
  stopping = true;
  if (controlServer?.listening) controlServer.close();
  const finished = () => {
    try { crmDatabase?.close(); } catch { shutdownCode = 1; }
    stopOwnedRuntime();
    process.exit(shutdownCode);
  };
  if (crmServer?.listening) crmServer.close(finished);
  else finished();
  if (code !== 0) setTimeout(() => { stopOwnedRuntime(); process.exit(1); }, 3000).unref();
}

function browserOpen(url) {
  // URL is a fixed loopback constant, not caller-controlled shell text.
  const child = process.platform === 'win32'
    ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, detached: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log('Open ' + url + ' in your browser.'));
  child.unref();
}

async function enablePackageStop() {
  fs.mkdirSync(LOGS, { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  controlServer = net.createServer(socket => {
    let input = '';
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('data', chunk => {
      input += chunk.toString('utf8');
      if (input.length > 512) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      if (input.trim() !== token) { socket.end('DENIED\n'); return; }
      socket.end('OK\n');
      controlServer.close();
      // Closes only this process's own app/database; no public HTTP route.
      setImmediate(() => stopCRM(0));
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => { controlServer.once('error', reject); controlServer.listen(PIPE, resolve); });
  fs.writeFileSync(CRM_RECORD, JSON.stringify({ processId: process.pid, executable: process.execPath, packageRoot: ROOT, pipe: PIPE, token, started: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
}

async function requestPackageStop() {
  if (!fs.existsSync(CRM_RECORD)) { console.log('This package has no recorded CRM process. No process was stopped.'); return; }
  const record = readJson(CRM_RECORD);
  if (!samePath(record.packageRoot, ROOT) || record.pipe !== PIPE || !/^[0-9a-f]{64}$/.test(record.token)) throw new Error('Package stop record is invalid. No process was stopped.');
  await new Promise((resolve, reject) => {
    const client = net.connect(PIPE);
    let reply = '';
    client.setTimeout(3000, () => client.destroy(new Error('Package stop request timed out. No other process was stopped.')));
    client.once('connect', () => client.write(record.token + '\n'));
    client.on('data', data => { reply += data.toString('utf8'); });
    client.once('error', error => reject(new Error('Recorded package CRM is stopped or unavailable. No process was killed. ' + error.code)));
    client.once('end', () => { if (reply.trim() === 'OK') resolve(); else reject(new Error('Stop request was not accepted. No process was killed.')); });
  });
  console.log('Graceful shutdown requested from this package CRM only. Pre-existing AI and other services are untouched.');
}

async function main(argv = process.argv.slice(2)) {
  for (const arg of argv) if (!['--no-open', '--no-ai', '--check', '--help', '--stop'].includes(arg)) throw new Error('Unknown option ' + arg);
  if (argv.includes('--stop')) { await requestPackageStop(); return; }
  if (argv.includes('--help')) {
    console.log('START-CRM.cmd [--no-open] [--no-ai] [--check] [--stop]\n--check validates files and existing readiness only; starts no service and opens no user or persistent database.\n--stop requests graceful shutdown from this package only.\nCRM stays local at http://127.0.0.1:3192 with data/divinenet.sqlite.');
    return;
  }
  console.log('Divinenet CRM - local workspace\nNo downloads, public hosting, existing database replacement or system installation.');
  assertDependencies();
  if (fs.existsSync(path.join(ROOT, 'data', '.maintenance.lock'))) throw new Error('Database recovery is in progress. Startup stopped without opening the database.');
  if (process.env.NODE_ENV === 'production') throw new Error('Production startup is disabled. This package is for local review only.');
  await assertPortFree(CRM_PORT);
  const config = configFor();
  if (argv.includes('--no-ai')) config.enableAI = false;
  let ai = false;
  try { ai = await prepareAI(config, argv.includes('--check')); }
  catch (error) { stopOwnedRuntime(); console.warn('AI unavailable: ' + error.message + '\nCore campaign/lead CRM can still run. No substitute image is presented as AI.'); }
  if (argv.includes('--check')) { console.log('Core startup checks passed. No service or database was started.'); return; }
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  Object.assign(process.env, { PORT: String(CRM_PORT), CRM_DATABASE_PATH: path.join(ROOT, 'data/divinenet.sqlite'), CRM_ENABLE_LIVE_AI: String(ai), AI_LIVE_APPROVED: String(ai), AI_IMAGE_PROVIDER: ai ? 'sd-cpp' : '', AI_IMAGE_BASE_URL: AI_URL, AI_IMAGE_MODEL: ai ? pinned.modelLabel : '' });
  console.log('Database: ' + process.env.CRM_DATABASE_PATH);
  if (ai) console.log('AI uses reproducible seed 42: the same prompt can produce the same picture. Each result still requires your review.');
  console.log('Keep this window open. Ctrl+C stops this CRM only, plus an AI runtime started by this window; pre-existing services are untouched.');
  // Existing application is served in this foreground process, not a detached child.
  const created = require('../backend/app.js').createApp({ databasePath: process.env.CRM_DATABASE_PATH, imageConfig: ai ? undefined : {}, accessControl: true });
  crmDatabase = created.db;
  crmStarted = true;
  await new Promise((resolve, reject) => {
    crmServer = created.app.listen(CRM_PORT, '127.0.0.1', resolve);
    crmServer.once('error', reject);
  });
  process.once('SIGINT', () => stopCRM(0));
  process.once('SIGTERM', () => stopCRM(0));
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const result = await readEndpoint(CRM_URL + '/api/health');
      if (result.success !== true) throw new Error('Unexpected CRM readiness response');
      healthy = true;
      break;
    } catch { await delay(250); }
  }
  if (!healthy || !crmServer.listening || crmServer.address().address !== '127.0.0.1') throw new Error('CRM readiness was not confirmed.');
  if (process.platform === 'win32') {
    const bound = listeners(CRM_PORT);
    if (bound.length !== 1 || bound[0].pid !== process.pid || bound[0].address !== '127.0.0.1') throw new Error('CRM listener ownership was not confirmed.');
  }
  await enablePackageStop();
  console.log('READY: ' + CRM_URL + '/#campaigns');
  if (config.openBrowser && !argv.includes('--no-open')) browserOpen(CRM_URL + '/#campaigns');
}

if (require.main === module) {
  process.once('exit', stopOwnedRuntime);
  main().catch(error => {
    stopOwnedRuntime(); console.error('Startup failed: ' + error.message); process.exitCode = 1;
    if (crmStarted) stopCRM(1);
  });
}

module.exports = { configFor, aiDirectory, parseListeners, recordedIdentityMatches, capabilitiesMatch, runtimeArgs, assertDependencies, assertPortFree, samePath };