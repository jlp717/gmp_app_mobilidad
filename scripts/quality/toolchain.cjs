#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('../../backend/node_modules/js-yaml');

const NODE_ACTION = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const FLUTTER_ACTION = 'subosito/flutter-action@1a449444c387b1966244ae4d4f8c696479add0b2';
const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readText(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

function workflowFiles(root) {
  const directory = path.join(root, '.github', 'workflows');
  return fs.readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => path.join(directory, name));
}

function checkWorkflow(file, source) {
  const findings = [];
  let document;
  try {
    document = yaml.load(source);
  } catch (error) {
    return [`${file}: invalid-yaml:${error.reason || error.message}`];
  }
  if (!document || typeof document !== 'object') return [`${file}: yaml-root-must-be-object`];
  const jobs = document.jobs;
  if (!jobs || typeof jobs !== 'object') return findings;
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object' || !Array.isArray(job.steps)) continue;
    job.steps.forEach((step, index) => {
      if (!step || typeof step !== 'object') return;
      const location = `${file}:${jobName}:steps[${index}]`;
      if (typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@')) {
        if (step.uses !== NODE_ACTION) findings.push(`${location}: setup-node must be pinned to ${NODE_ACTION}`);
        if (step.with?.['node-version-file'] !== '.nvmrc') findings.push(`${location}: setup-node must use node-version-file .nvmrc`);
        if (Object.hasOwn(step.with || {}, 'node-version')) findings.push(`${location}: setup-node must not use node-version`);
      }
      if (typeof step.uses === 'string' && step.uses.startsWith('subosito/flutter-action@')) {
        if (step.uses !== FLUTTER_ACTION) findings.push(`${location}: flutter-action must be pinned to ${FLUTTER_ACTION}`);
        if (step.with?.['flutter-version-file'] !== '.fvmrc') findings.push(`${location}: flutter-action must use flutter-version-file .fvmrc`);
        if (Object.hasOwn(step.with || {}, 'flutter-version')) findings.push(`${location}: flutter-action must not use flutter-version`);
      }
    });
  }
  if (/\b(?:NODE_VERSION|FLUTTER_VERSION)\s*:/m.test(source)) findings.push(`${file}: duplicate workflow version environment variable`);
  return findings;
}

function nodeRange(version) {
  const match = EXACT_SEMVER.exec(version);
  return match ? `>=${version} <${Number(match[1]) + 1}` : null;
}

function checkToolchain(root, { runtimeVersion = process.versions.node } = {}) {
  const findings = [];
  let nvmrc = '';
  try {
    nvmrc = readText(path.join(root, '.nvmrc'));
  } catch {
    findings.push('.nvmrc: missing-or-unreadable');
  }
  const nodeMatch = EXACT_SEMVER.exec(nvmrc);
  if (!nvmrc) findings.push('.nvmrc: empty');
  else if (!nodeMatch) findings.push('.nvmrc: must contain an exact semver');
  else if (nodeMatch[1] !== '24') findings.push('.nvmrc: Node major 24 is required');
  const expectedRange = nodeRange(nvmrc);
  if (expectedRange && runtimeVersion !== nvmrc) findings.push(`runtime: expected Node ${nvmrc}, got ${runtimeVersion}`);

  try {
    const fvm = readJson(path.join(root, '.fvmrc'));
    if (typeof fvm.flutter !== 'string' || !EXACT_SEMVER.test(fvm.flutter)) findings.push('.fvmrc: flutter must contain an exact semver');
  } catch {
    findings.push('.fvmrc: missing-or-invalid-json');
  }

  for (const packageFile of ['package.json', path.join('backend', 'package.json')]) {
    try {
      const packageJson = readJson(path.join(root, packageFile));
      if (expectedRange && packageJson.engines?.node !== expectedRange) findings.push(`${packageFile}: engines.node must equal ${expectedRange}`);
    } catch {
      findings.push(`${packageFile}: missing-or-invalid-json`);
    }
  }

  for (const lockFile of ['package-lock.json', path.join('backend', 'package-lock.json')]) {
    try {
      const lock = readJson(path.join(root, lockFile));
      if (expectedRange && lock.packages?.['']?.engines?.node !== expectedRange) {
        findings.push(`${lockFile}: packages[\"\"].engines.node must equal ${expectedRange}`);
      }
    } catch {
      findings.push(`${lockFile}: missing-or-invalid-json`);
    }
  }

  try {
    for (const file of workflowFiles(root)) {
      findings.push(...checkWorkflow(path.relative(root, file).replaceAll('\\', '/'), fs.readFileSync(file, 'utf8')));
    }
  } catch {
    findings.push('.github/workflows: missing-or-unreadable');
  }
  return findings;
}

function main() {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag >= 0 ? path.resolve(process.argv[rootFlag + 1]) : path.resolve(__dirname, '..', '..');
  const findings = checkToolchain(root);
  process.stdout.write(`${JSON.stringify({ status: findings.length ? 'BLOCKED' : 'PASS', findings })}\n`);
  process.exitCode = findings.length ? 1 : 0;
}

if (require.main === module) main();

module.exports = { checkToolchain, checkWorkflow, nodeRange, NODE_ACTION, FLUTTER_ACTION };
