#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('../../backend/node_modules/js-yaml');

const INTERPOLATION = /\$\{\{/;
const MUTATION_OR_LOG_PATTERN = /(?:actions\/checkout|downloadJobLogs|createPullRequest|createComment|createIssue|reRunWorkflow|reRunJob|telegram|\bcurl\b|git\s+(?:push|commit))/i;
const READ_ONLY_PERMISSIONS = ['actions', 'contents'];
const GITHUB_SCRIPT_ACTION = 'actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b';
const REQUESTED_SKIP_TESTS = "${{ github.event.inputs.skip_tests || 'false' }}";
const SKIP_TESTS_STEP_RUN = `SKIP="$REQUESTED_SKIP_TESTS"
case "$SKIP" in
  true|false) ;;
  *)
    echo "::error::skip_tests must be true or false"
    exit 1
    ;;
esac
printf 'skip_tests=%s\\n' "$SKIP" >> "$GITHUB_OUTPUT"
echo "::notice::Tests will be skipped: $SKIP"`;

function workflowFiles(root) {
  const directory = path.join(root, '.github', 'workflows');
  return fs.readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => path.join(directory, name));
}

function parseWorkflow(file) {
  try {
    const document = yaml.load(fs.readFileSync(file, 'utf8'));
    return document && typeof document === 'object' ? document : null;
  } catch (error) {
    return { parseError: error.reason || error.message };
  }
}

function checkWorkflowInputs(root) {
  const findings = [];
  for (const file of workflowFiles(root)) {
    const document = parseWorkflow(file);
    if (!document) {
      findings.push(`${file}: YAML root must be an object`);
      continue;
    }
    if (document.parseError) {
      findings.push(`${file}: invalid YAML`);
      continue;
    }
    for (const [jobName, job] of Object.entries(document.jobs || {})) {
      if (typeof job?.defaults?.run === 'string' && INTERPOLATION.test(job.defaults.run)) {
        findings.push(`${file}:${jobName}:defaults.run: interpolation is forbidden in run; pass data through env and validate before use`);
      }
      for (const [index, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
        if (!step || typeof step !== 'object') continue;
        const location = `${file}:${jobName}:steps[${index}]`;
        if (typeof step.run === 'string' && INTERPOLATION.test(step.run)) {
          findings.push(`${location}: interpolation is forbidden in run; pass data through env and validate before use`);
        }
        if (typeof step.with?.script === 'string' && INTERPOLATION.test(step.with.script)) {
          findings.push(`${location}: interpolation is forbidden in github-script script; use context or environment input`);
        }
      }
    }
  }
  return findings;
}

function hasReadOnlyPermissions(permissions) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return false;
  const keys = Object.keys(permissions).sort();
  return keys.length === READ_ONLY_PERMISSIONS.length &&
    keys.every((key, index) => key === READ_ONLY_PERMISSIONS[index]) &&
    keys.every((key) => permissions[key] === 'read');
}

function checkReadOnlyObserver(root) {
  const file = path.join(root, '.github', 'workflows', 'ci-self-heal.yml');
  const source = fs.readFileSync(file, 'utf8');
  const document = parseWorkflow(file);
  const findings = [];
  if (!document || document.parseError) return ['ci-self-heal.yml: invalid YAML'];
  const jobNames = Object.keys(document.jobs || {});
  if (jobNames.length !== 1 || jobNames[0] !== 'inspect') {
    findings.push('ci-self-heal.yml: observer must contain exactly one inspect job');
  }
  if (!hasReadOnlyPermissions(document.permissions)) {
    findings.push('ci-self-heal.yml: observer root permissions must be exactly actions and contents read');
  }
  for (const [jobName, job] of Object.entries(document.jobs || {})) {
    if (Object.hasOwn(job || {}, 'permissions') && !hasReadOnlyPermissions(job.permissions)) {
      findings.push(`ci-self-heal.yml: job ${jobName} permissions must be exactly actions and contents read when overridden`);
    }
  }
  const inspectSteps = document.jobs?.inspect?.steps;
  if (!Array.isArray(inspectSteps) || inspectSteps.length !== 1 || inspectSteps[0]?.uses !== GITHUB_SCRIPT_ACTION || typeof inspectSteps[0]?.with?.script !== 'string') {
    findings.push('ci-self-heal.yml: observer must contain exactly one pinned github-script metadata step');
  }
  if (!source.includes('github.rest.actions.getWorkflowRun') || !source.includes('github.rest.actions.listJobsForWorkflowRun')) {
    findings.push('ci-self-heal.yml: observer must query workflow run and job metadata through GitHub Actions API');
  }
  if (MUTATION_OR_LOG_PATTERN.test(source)) {
    findings.push('ci-self-heal.yml: observer contains a forbidden checkout, log download, mutation, or external messaging operation');
  }
  const permittedApiCalls = /github\.rest\.actions\.(?:getWorkflowRun|listJobsForWorkflowRun)/g;
  const residualGithubApiSource = source.replace(permittedApiCalls, '');
  if (/\bgithub\s*(?:\.\s*(?:rest|request)|\[\s*['"](?:rest|request)['"]\s*\])/i.test(residualGithubApiSource)) {
    findings.push('ci-self-heal.yml: observer may only call the approved read-only Actions metadata APIs');
  }
  return findings;
}

function checkCiCdSkipFlag(root) {
  const document = parseWorkflow(path.join(root, '.github', 'workflows', 'ci-cd.yml'));
  const findings = [];
  const step = document?.jobs?.preflight?.steps?.find((candidate) => candidate?.id === 'check');
  const normalizedRun = typeof step?.run === 'string' ? step.run.replace(/\r\n/g, '\n').trim() : '';
  if (!step || step.env?.REQUESTED_SKIP_TESTS !== REQUESTED_SKIP_TESTS || normalizedRun !== SKIP_TESTS_STEP_RUN) {
    findings.push('ci-cd.yml: preflight check must use the approved true|false skip_tests output template');
  }
  return findings;
}

function main() {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag >= 0 ? path.resolve(process.argv[rootFlag + 1]) : path.resolve(__dirname, '..', '..');
  const findings = [...checkWorkflowInputs(root), ...checkReadOnlyObserver(root), ...checkCiCdSkipFlag(root)];
  if (findings.length) {
    process.stdout.write(`${findings.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('workflow input safety check passed\n');
  }
}

if (require.main === module) main();

module.exports = { checkCiCdSkipFlag, checkReadOnlyObserver, checkWorkflowInputs };
