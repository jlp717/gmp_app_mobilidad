'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { checkToolchain, FLUTTER_ACTION } = require('../toolchain.cjs');

function fixture({ node = '24.21.0', flutter = '3.35.6', engine = '>=24.21.0 <25', workflow } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-toolchain-'));
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.nvmrc'), `${node}\n`);
  fs.writeFileSync(path.join(root, '.fvmrc'), JSON.stringify({ flutter }) + '\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ engines: { node: engine } }) + '\n');
  fs.writeFileSync(path.join(root, 'backend', 'package.json'), JSON.stringify({ engines: { node: engine } }) + '\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { '': { engines: { node: engine } } } }) + '\n');
  fs.writeFileSync(path.join(root, 'backend', 'package-lock.json'), JSON.stringify({ packages: { '': { engines: { node: engine } } } }) + '\n');
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'test.yml'), workflow || `jobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version-file: .nvmrc\n      - uses: ${FLUTTER_ACTION}\n        with:\n          flutter-version-file: .fvmrc\n`);
  return root;
}

test('accepts canonical pins and parsed YAML', () => {
  assert.deepEqual(checkToolchain(fixture(), { runtimeVersion: '24.21.0' }), []);
});

test('rejects missing version files and incompatible engines', () => {
  const root = fixture({ node: '20.0.0', engine: '>=20' });
  fs.unlinkSync(path.join(root, '.fvmrc'));
  assert.equal(checkToolchain(root, { runtimeVersion: '20.2.0' }).includes('.fvmrc: missing-or-invalid-json'), true);
  fs.writeFileSync(path.join(root, '.fvmrc'), JSON.stringify({ flutter: 'not-semver' }));
  const findings = checkToolchain(root, { runtimeVersion: '20.2.0' });
  assert.equal(findings.some((finding) => finding.includes('Node major 24')), true);
  assert.equal(findings.some((finding) => finding.includes('flutter must contain')), true);
  assert.equal(findings.filter((finding) => finding.includes('engines.node')).length, 4);
  assert.equal(findings.filter((finding) => finding.includes('package-lock.json')).length, 2);
});

test('rejects an otherwise consistent project under Node 20 before reporting PASS', () => {
  const findings = checkToolchain(fixture(), { runtimeVersion: '20.2.0' });
  assert.equal(findings.some((finding) => finding.includes('runtime: expected Node 24.21.0')), true);
});

test('rejects invalid workflow YAML', () => {
  const root = fixture({ workflow: 'jobs: [not-valid-yaml' });
  const findings = checkToolchain(root, { runtimeVersion: '24.21.0' });
  assert.equal(findings.some((finding) => finding.includes('invalid-yaml')), true);
});

test('rejects empty source of truth, moving action tags and duplicate version values', () => {
  const root = fixture({ workflow: `env:\n  NODE_VERSION: '24.21.0'\njobs:\n  checks:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '24.21.0'\n      - uses: subosito/flutter-action@v2\n        with:\n          flutter-version: '3.35.6'\n` });
  fs.writeFileSync(path.join(root, '.nvmrc'), '\n');
  const findings = checkToolchain(root, { runtimeVersion: '20.2.0' });
  assert.equal(findings.includes('.nvmrc: empty'), true);
  assert.equal(findings.some((finding) => finding.includes('setup-node must be pinned')), true);
  assert.equal(findings.some((finding) => finding.includes('setup-node must use node-version-file')), true);
  assert.equal(findings.some((finding) => finding.includes('flutter-action must be pinned')), true);
  assert.equal(findings.some((finding) => finding.includes('duplicate workflow version')), true);
});
