'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { checkCiCdSkipFlag, checkReadOnlyObserver, checkWorkflowInputs } = require('../workflow-inputs.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function fixture(workflow) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-workflow-inputs-'));
  const directory = path.join(root, '.github', 'workflows');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'fixture.yml'), workflow);
  return root;
}

function observerFixture(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-workflow-observer-'));
  const directory = path.join(root, '.github', 'workflows');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'ci-self-heal.yml'), source);
  return root;
}

function ciCdFixture(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-workflow-ci-cd-'));
  const directory = path.join(root, '.github', 'workflows');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'ci-cd.yml'), source);
  return root;
}

function observerSource() {
  const workflow = require('../../../backend/node_modules/js-yaml').load(
    fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci-self-heal.yml'), 'utf8'),
  );
  return workflow.jobs.inspect.steps.find((step) => typeof step.with?.script === 'string').with.script;
}

async function runObserver({ dispatchId = '123', payloadRun, run, jobs = [] } = {}) {
  const calls = [];
  const failures = [];
  const notices = [];
  const summaries = [];
  const summary = {
    addHeading(value) { summaries.push(['heading', value]); return this; },
    addTable(value) { summaries.push(['table', value]); return this; },
    addRaw(value) { summaries.push(['raw', value]); return this; },
    async write() { summaries.push(['write']); },
  };
  const actions = new Proxy({
    async getWorkflowRun(args) { calls.push(['getWorkflowRun', args]); return { data: run }; },
    async listJobsForWorkflowRun(args) { calls.push(['listJobsForWorkflowRun', args]); return { data: { total_count: jobs.length, jobs } }; },
  }, { get(target, key) { if (!Object.hasOwn(target, key)) throw new Error(`unexpected Actions API: ${String(key)}`); return target[key]; } });
  const github = { rest: new Proxy({ actions }, { get(target, key) { if (!Object.hasOwn(target, key)) throw new Error(`unexpected GitHub API: ${String(key)}`); return target[key]; } }) };
  await vm.runInNewContext(`(async () => {${observerSource()}\n})()`, {
    context: { repo: { owner: 'owner', repo: 'repo' }, payload: payloadRun ? { workflow_run: payloadRun } : {} },
    core: { setFailed(value) { failures.push(value); }, notice(value) { notices.push(value); }, summary },
    github,
    process: { env: { WORKFLOW_RUN_ID: dispatchId } },
  });
  return { calls, failures, notices, summaries };
}

function trustedRun(overrides = {}) {
  const sha = 'a'.repeat(40);
  return {
    id: 123, repository: { full_name: 'owner/repo' }, head_repository: { full_name: 'owner/repo', fork: false },
    status: 'completed', head_sha: sha, head_commit: { id: sha }, conclusion: 'failure', ...overrides,
  };
}

test('allows expressions in env and if when run consumes the environment variable', () => {
  const root = fixture(`jobs:\n  gate:\n    steps:\n      - if: \${{ github.event.pull_request.body != '' }}\n        env:\n          BODY: \${{ github.event.pull_request.body }}\n        run: test -n "$BODY"\n`);
  assert.deepEqual(checkWorkflowInputs(root), []);
});

test('rejects every run interpolation, including wrappers and bracket notation', () => {
  const root = fixture(`jobs:\n  gate:\n    steps:\n      - run: |\n          echo \${{ toJSON(github.event.pull_request.title) }} \${{ format(inputs.name) }} \${{ github['event'].pull_request.title }}\n`);
  assert.match(checkWorkflowInputs(root).join('\n'), /interpolation is forbidden in run/);
});

test('rejects every github-script interpolation', () => {
  const root = fixture(`jobs:\n  gate:\n    steps:\n      - uses: actions/github-script@deadbeef\n        with:\n          script: |\n            console.log("\${{ format(github['event'].issue.title) }}")\n`);
  const findings = checkWorkflowInputs(root).join('\n');
  assert.match(findings, /github-script script/);
});

test('observer rejects root or job permissions outside its exact read-only allowlist and unexpected REST APIs', () => {
  const original = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci-self-heal.yml'), 'utf8');
  const rootPermissions = observerFixture(original.replace('  contents: read', '  contents: read\n  issues: write'));
  assert.match(checkReadOnlyObserver(rootPermissions).join('\n'), /root permissions/);
  const jobPermissions = observerFixture(original.replace('    runs-on: ubuntu-latest', '    permissions:\n      issues: write\n    runs-on: ubuntu-latest'));
  assert.match(checkReadOnlyObserver(jobPermissions).join('\n'), /job inspect permissions/);
  const inheritedSecondJob = observerFixture(original.replace('  inspect:\n', '  shadow:\n    runs-on: ubuntu-latest\n    steps: []\n  inspect:\n'));
  assert.match(checkReadOnlyObserver(inheritedSecondJob).join('\n'), /exactly one inspect job/);
  const unexpectedApi = observerFixture(`${original}\n# github.rest.issues.create({})\n`);
  assert.match(checkReadOnlyObserver(unexpectedApi).join('\n'), /approved read-only Actions metadata APIs/);
  const unpinnedAction = observerFixture(original.replace('actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b', 'actions/github-script@v8'));
  assert.match(checkReadOnlyObserver(unpinnedAction).join('\n'), /exactly one pinned github-script metadata step/);
});

test('ci-cd skip flag has a strict shell allowlist and bounded output write', () => {
  assert.deepEqual(checkCiCdSkipFlag(repoRoot), []);
});

test('ci-cd skip flag rejects comments containing decoys and an active unsafe echo', () => {
  const root = ciCdFixture(`jobs:\n  preflight:\n    steps:\n      - id: check\n        env:\n          REQUESTED_SKIP_TESTS: \${{ github.event.inputs.skip_tests || 'false' }}\n        run: |\n          # case "$SKIP" in true|false) ;; esac\n          # printf 'skip_tests=%s\\n' "$SKIP" >> "$GITHUB_OUTPUT"\n          SKIP="$REQUESTED_SKIP_TESTS"\n          echo "skip_tests=$SKIP" >> "$GITHUB_OUTPUT"\n`);
  assert.match(checkCiCdSkipFlag(root).join('\n'), /approved true\|false skip_tests output template/);
});

test('real observer script permits only valid same-repository metadata and bounds summaries', async () => {
  const valid = await runObserver({ run: trustedRun(), jobs: [{ conclusion: '<script>\n'.repeat(30) }] });
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.calls.map(([name]) => name), ['getWorkflowRun', 'listJobsForWorkflowRun']);
  const rendered = JSON.stringify(valid.summaries);
  assert.equal(rendered.includes('<'), false);
  assert.ok(rendered.length < 1000);
  for (const badRun of [trustedRun({ repository: { full_name: 'other/repo' } }), trustedRun({ head_repository: { full_name: 'owner/repo', fork: true } }), trustedRun({ head_sha: 'invalid' })]) {
    const result = await runObserver({ run: badRun });
    assert.deepEqual(result.calls.map(([name]) => name), ['getWorkflowRun']);
    assert.deepEqual(result.failures, ['workflow run did not satisfy trusted repository, id, status, or SHA checks']);
  }
});

test('real observer script rejects invalid dispatch IDs before any API call', async () => {
  const result = await runObserver({ dispatchId: '123\nother=value', run: trustedRun() });
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.failures, ['workflow_run_id must be a positive safe integer']);
});

test('committed workflows and the metadata observer satisfy the static policy', () => {
  assert.deepEqual(checkWorkflowInputs(repoRoot), []);
  assert.deepEqual(checkReadOnlyObserver(repoRoot), []);
  assert.deepEqual(checkCiCdSkipFlag(repoRoot), []);
});
