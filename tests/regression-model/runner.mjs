import fs from 'node:fs';

const scenarios = JSON.parse(fs.readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8')).scenarios;
const opencode = JSON.parse(fs.readFileSync('opencode.json', 'utf8'));
const fallback = JSON.parse(fs.readFileSync('.opencode/fallback-models.json', 'utf8'));
const policy = fs.readFileSync('.opencode/config/model-update-policy.yaml', 'utf8');
const taskClassification = fs.readFileSync('.opencode/config/task-classification.yaml', 'utf8');
const providerHealthStore = fs.readFileSync('.opencode/lib/provider-health-store.ts', 'utf8');
const fallbackForward = fs.readFileSync('.opencode/plugins/model-fallback-forward.ts', 'utf8');
const flowObservability = fs.readFileSync('.opencode/plugins/flow-observability.ts', 'utf8');
const automationSchedule = JSON.parse(fs.readFileSync('.opencode/config/automation-schedule.json', 'utf8'));
const autonomousFlow = fs.readFileSync('.opencode/config/autonomous-flow.yaml', 'utf8');
const mcp = JSON.parse(fs.readFileSync('.mcp.json', 'utf8'));

const cursorModels = opencode.provider?.['cursor-acp']?.models ?? {};
const requiredCursorModels = [
  'composer-2.5',
  'composer-2.5-fast',
  'claude-fable-5-thinking-max',
  'claude-fable-5-thinking-xhigh',
  'claude-opus-4-8-thinking-max',
  'claude-opus-4-8-thinking-xhigh',
  'claude-opus-4-7-thinking-max',
  'claude-4.6-opus-max-thinking',
];

const critical = [
  'chief-engineer-assistant',
  'GMP-Orchestrator',
  'Architect-Planner',
  'sre-engineer',
  'appsec-engineer',
  'qa-automation-lead',
  'code-autopilot',
  'DB2-AS400-Specialist',
  'DB2-Query-Optimizer',
  'Redis-Cache-Specialist',
  'Runtime-Log-Diagnostician',
  'API-Contract-Specialist',
  'Flutter-Architecture-Specialist',
  'Flutter-Performance-Specialist',
  'Performance-Analyst',
  'Technical-Verifier',
  'Check-Reviewer',
  'truth-teller',
  'team-curator',
  'Security-Validator',
  'DevOps-CICD-Specialist',
];

const failures = [];
for (const id of requiredCursorModels) {
  if (!cursorModels[id]) failures.push(`cursor model missing in opencode.json: ${id}`);
  if (cursorModels[id]?.reasoning !== true) failures.push(`cursor model reasoning not true: ${id}`);
  if (cursorModels[id]?.tool_call !== true) failures.push(`cursor model tool_call not true: ${id}`);
}
for (const name of critical) {
  if ((fallback.agents?.[name]?.fallback ?? []).some((model) => model.startsWith('cursor-acp/'))) {
    failures.push(`cursor-acp fallback remains in critical agent ${name}`);
  }
}
for (const name of ['Node-Express-Specialist', 'Test-Writer', 'Code-Reviewer']) {
  if (!(fallback.agents?.[name]?.fallback ?? []).includes('opencode-go/glm-5.2')) {
    failures.push(`glm fallback missing in ${name}`);
  }
}
if (policy.includes('cursor-acp/claude-4.6-sonnet')) failures.push('legacy cursor claude remains in policy');
const tierABlock = taskClassification.match(/\n    A:\n([\s\S]*?)\n    B:/)?.[1] ?? '';
if (/default_models:[^\n]*cursor-acp\/composer-2\.5/.test(tierABlock)) {
  failures.push('Tier A automatic defaults include Composer');
}
if (providerHealthStore.includes('cursor-acp/claude-4.6-sonnet')) failures.push('legacy unsafe fallback remains in provider-health-store');
if (/\?\s*"cursor-acp\/composer-2\.5"/.test(fallbackForward)) failures.push('hardcoded Composer fallback remains in model-fallback-forward ternary');
if (!fallback.manual_high_capability_models?.cursor_acp?.includes('cursor-acp/claude-opus-4-8-thinking-max')) {
  failures.push('manual Cursor high-capability metadata missing');
}
if (JSON.stringify(fallback).includes('openai/gpt-5.5-pro')) failures.push('gpt-5.5-pro present in fallback config');
if (!policy.includes('provider_probe_acceptance')) failures.push('provider probe acceptance missing in model-update-policy');
if (!taskClassification.includes('Provider catalog/probe changes are R3 local config')) failures.push('provider probe classification missing');
if (automationSchedule.jobs?.memory_garbage_collector?.tool !== 'semantic-memory-pruner') failures.push('semantic memory schedule not aligned');
if (!fs.existsSync('.opencode/scripts/memory/semantic-memory-pruner.mjs')) failures.push('semantic-memory-pruner script missing');
if (!fs.existsSync('.opencode/scripts/security/guardvibe-fallback-scan.mjs')) failures.push('guardvibe fallback script missing');
if (!mcp.mcpServers?.guardvibe && !opencode.mcp?.guardvibe) failures.push('guardvibe MCP/fallback wiring missing');
if (!flowObservability.includes('readLatestFlow') || !flowObservability.includes('writeJsonAtomic')) failures.push('flow-observability tolerant parse/atomic write missing');
if (!autonomousFlow.includes('provider-model-probe') || !autonomousFlow.includes('guardvibe-or-fallback-scan')) failures.push('final verification tools missing');
if ((scenarios.find((s) => s.id === 'final-29-item-checklist')?.items ?? []).length !== 29) failures.push('final 29-item checklist fixture missing');

if (failures.length) {
  console.error(JSON.stringify({ status: 'FAIL', scenarios: scenarios.length, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'PASS', scenarios: scenarios.length }, null, 2));
