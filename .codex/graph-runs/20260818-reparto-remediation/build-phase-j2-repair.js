'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.cwd();
const files = new Map();
function load(name) {
  if (!files.has(name)) files.set(name, fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n'));
  return files.get(name);
}
function replaceOnce(name, before, after) {
  const source = load(name);
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw new Error(`bad anchor ${name}: ${before.slice(0, 60)}`);
  files.set(name, source.slice(0, at) + after + source.slice(at + before.length));
}

replaceOnce('backend/routes/repartidor.js',
`    if (PRIVILEGED_REPARTIDOR_ROLES.has(role)) {
        if (activeMode !== 'REPARTIDOR') {`,
`    if (role === 'JEFE_VENTAS') {
        if (activeMode !== 'REPARTIDOR') {`);

replaceOnce('backend/src/chatbot/chatbot_authorization.js',
`    isJefeVentas:
      supervisorRole || (Boolean(user.isJefeVentas) && !explicitNonSupervisor),`,
`    isJefeVentas: isSupervisor({
      role,
      activeMode: user.activeMode,
      isJefeVentas: Boolean(user.isJefeVentas) && !explicitNonSupervisor,
    }),`);

replaceOnce('backend/__tests__/middleware/auth-middleware.test.js',
`            user: { id: 'V001', code: '001', isJefeVentas: true }`,
`            user: { id: 'V001', code: '001', role: 'JEFE_VENTAS', isJefeVentas: true }`);
replaceOnce('backend/__tests__/repartidor-finanzas-http-gap-coverage.test.js',
`const validTiers = () => ({ tiers: [{ thresholdPct: 0, commissionPct: 1 }] });`,
`const validTiers = () => ({ tiers: [{ thresholdPct: 30, commissionPct: 1 }] });`);

const legacy = 'backend/__tests__/repartidor-legacy-read-security.test.js';
replaceOnce(legacy,
`const routes = require('../routes/repartidor');`,
`const previousTableSet = process.env.REPARTO_TABLE_SET;
process.env.REPARTO_TABLE_SET = 'isolated_test';
const routes = require('../routes/repartidor');

afterAll(() => {
  if (previousTableSet === undefined) delete process.env.REPARTO_TABLE_SET;
  else process.env.REPARTO_TABLE_SET = previousTableSet;
});`);
replaceOnce(legacy,
`      LAST_VISIT: 20260803 - index,
      })),`,
`      LAST_VISIT: 20260803 - index,
        OWNER_ID: '05',
      })),`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-phase-j2-'));
for (const [name, modified] of files) {
  const oldPath = path.join(tmp, 'old', name);
  const newPath = path.join(tmp, 'new', name);
  fs.mkdirSync(path.dirname(oldPath), { recursive: true });
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.copyFileSync(path.join(root, name), oldPath);
  fs.writeFileSync(newPath, modified, 'utf8');
}
const diff = spawnSync('git', ['diff', '--no-index', '--binary', '--', 'old', 'new'], {
  cwd: tmp, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
});
if (![0, 1].includes(diff.status)) throw new Error(diff.stderr);
const output = diff.stdout.replaceAll('a/old/', 'a/').replaceAll('b/new/', 'b/');
fs.writeFileSync(path.join(root, '.codex/graph-runs/20260818-reparto-remediation/phase-j2-repair.generated.patch'), output, 'utf8');
console.log(`generated ${files.size} files, ${output.length} bytes`);
