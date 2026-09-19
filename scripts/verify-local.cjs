'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(
  root,
  'test-evidence',
  'verification-' + new Date().toISOString().replace(/[:.]/g, '-')
);

fs.mkdirSync(output, { recursive: true });

function sources(dir = root, result = {}) {
  const excludedDirectories = [
    'node_modules',
    '.git',
    '.codex',
    '.agents',
    'data',
    'logs',
    'backups',
    'test-evidence',
    'evidence',
    'playwright-report',
    'test-results',
    'ai',
    'runtime'
  ];

  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory() && excludedDirectories.includes(item.name)) {
      continue;
    }

    if (
      item.isFile() &&
      (
        item.name === 'launcher.config.json' ||
        item.name === '.env' ||
        item.name.startsWith('.env.')
      )
    ) {
      continue;
    }

    const file = path.join(dir, item.name);

    if (item.isDirectory()) {
      sources(file, result);
    } else if (/\.(js|cjs|html|css|sql|json|cmd)$/.test(item.name)) {
      result[
        path.relative(root, file).replaceAll('\\', '/')
      ] = crypto
        .createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex');
    }
  }

  return result;
}

const report = {
  startedAt: new Date().toISOString(),
  executor: process.env.CRM_TEST_EXECUTOR || 'Unspecified executor',
  node: process.version,
  sourceHashes: sources(),
  runs: [],
  limitations: [
    'Not independent member QA or client acceptance',
    'Synthetic isolated records only',
    'Live AI is tested separately',
    'No Phase 1, social publishing or public deployment'
  ]
};

const suites = [
  ['backend', ['--test'], path.join(root, 'backend')],
  ['browser', ['scripts/browser-check.cjs']],
  ['notifications', ['scripts/notification-check.cjs']],
  ['banners', ['scripts/campaign-banner-check.cjs']],
  ['launcher', ['--test', 'scripts/start-crm.test.cjs']],
  ['recovery', ['--test', 'scripts/recovery-check.test.cjs']],
  ['workflows', ['scripts/local-workflows-check.cjs']],
  ['final-ui-runtime', ['scripts/final-ui-runtime-check.cjs']],
  ['campaign-dates', ['scripts/campaign-date-browser-check.cjs']],
  ['access-browser', ['scripts/access-browser-check.cjs']]
];

(async () => {
  for (const [name, args, cwd] of suites) {
    console.log('Checking ' + name + '...');

    const started = Date.now();
    let log = '';

    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: cwd || root,
        windowsHide: true,
        env: {
          ...process.env,
          CRM_TEST_EXECUTOR: report.executor,
          CRM_TEST_LIVE_AI: 'false'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', chunk => {
        log += chunk;
      });

      child.stderr.on('data', chunk => {
        log += chunk;
      });

      child.once('error', reject);
      child.once('close', resolve);
    });

    fs.writeFileSync(
      path.join(output, name + '.log'),
      log
    );

    report.runs.push({
      suite: name,
      exitCode: code,
      durationSeconds: (Date.now() - started) / 1000
    });

    console.log(
      name + ': ' +
      (code === 0 ? 'PASS' : 'FAIL (see log)')
    );

    if (code !== 0) {
      process.exitCode = 1;
    }
  }

  report.sourceUnchanged =
    JSON.stringify(sources()) ===
    JSON.stringify(report.sourceHashes);

  if (!report.sourceUnchanged) {
    process.exitCode = 1;
  }
})()
  .catch(error => {
    report.error = error.message;
    process.exitCode = 1;
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString();

    fs.writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify(report, null, 2)
    );

    console.log(
      'Verification evidence: ' + output
    );
  });
