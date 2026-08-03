#!/usr/bin/env node
/**
 * Deterministic OpenCode governance validator.
 * Exit 0 = PASS baseline; non-zero = regression / missing controls.
 */
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(process.cwd())
const findings = []

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

function check(id, ok, evidence, fix) {
  findings.push({
    id,
    status: ok ? "PASS" : "FAIL",
    evidence,
    fix: ok ? null : fix,
  })
}

const baseline = JSON.parse(read("docs/opencode-agent-governance/evals/baseline.json"))
const gold = JSON.parse(read("docs/opencode-agent-governance/evals/gold-cases.json"))

for (const doc of baseline.required_docs) {
  check(`doc:${doc}`, exists(doc), doc, `Create ${doc}`)
}
for (const doc of baseline.required_canon) {
  check(`canon:${doc}`, exists(doc), doc, `Create ${doc}`)
}

check(
  "gold_min_cases",
  Array.isArray(gold.cases) && gold.cases.length >= baseline.min_gold_cases,
  `cases=${gold.cases?.length || 0}`,
  `Add gold cases to reach ${baseline.min_gold_cases}`,
)

const inventory = exists("docs/agent-inventory.yaml") ? read("docs/agent-inventory.yaml") : ""
check(
  "inventory_agents",
  /agents:\n/.test(inventory) && (inventory.match(/^\s+- name:/gm) || []).length >= 40,
  `agent_name_lines≈${(inventory.match(/^\s+- name:/gm) || []).length}`,
  "Regenerate docs/agent-inventory.yaml",
)

const classification = exists("docs/agent-classification.md") ? read("docs/agent-classification.md") : ""
check(
  "classification_degrade",
  /DEGRADE/i.test(classification) && /Workflow/i.test(classification),
  "agent-classification.md",
  "Document Workflow vs Agent + DEGRADE decisions",
)

const sandboxPolicy = exists("docs/opencode-agent-governance/canon/sandbox-policy.yaml")
  ? read("docs/opencode-agent-governance/canon/sandbox-policy.yaml")
  : ""
check(
  "sandbox_ttl_30",
  /ttl_seconds:\s*30/.test(sandboxPolicy) && /ttl_hard_max_seconds:\s*30/.test(sandboxPolicy),
  "sandbox-policy.yaml",
  "Enforce TTL ≤ 30s in sandbox policy",
)

const aci = exists("docs/opencode-agent-governance/canon/tool-aci-registry.yaml")
  ? read("docs/opencode-agent-governance/canon/tool-aci-registry.yaml")
  : ""
check(
  "aci_annotations",
  /destructive:/.test(aci) && /open_world:/.test(aci) && /poka_yoke:/.test(aci),
  "tool-aci-registry.yaml",
  "Add destructive/open-world annotations + poka-yoke",
)

const otel = exists("docs/opencode-agent-governance/canon/otel-agentops.yaml")
  ? read("docs/opencode-agent-governance/canon/otel-agentops.yaml")
  : ""
check(
  "otel_gen_ai",
  /gen_ai\./.test(otel) && /OTEL_EXPORTER_OTLP_ENDPOINT/.test(otel) && !/collector_otlp:\s*"pending"/.test(otel),
  "otel-agentops.yaml",
  "Map spans to gen_ai.* + optional OTLP (not pending)",
)

check(
  "sandbox_process_isolate",
  /fallback_when_docker_missing:/.test(sandboxPolicy) && /process_isolate/.test(sandboxPolicy),
  "sandbox-policy.yaml",
  "Document process_isolate fallback when Docker missing",
)

check(
  "canary_rollback_script",
  exists("scripts/opencode-governance/canary-eval-rollback.mjs") &&
    exists("docs/opencode-agent-governance/evals/canary-state.json"),
  "canary-eval-rollback.mjs + canary-state.json",
  "Add canary eval auto-rollback script and state marker",
)

check(
  "degrade_completed",
  /status:\s*completed/.test(inventory) &&
    exists(".opencode/tools/semantic-memory-pruner.ts") &&
    exists("scripts/opencode-governance/cost-latency-threshold.mjs"),
  "degrade agents + workflow owners",
  "Complete Agent→Workflow degrade for memory-cleaner / Metrics-Observer / Release-Notifier",
)

const intent = exists("docs/opencode-agent-governance/canon/intent-validator.yaml")
  ? read("docs/opencode-agent-governance/canon/intent-validator.yaml")
  : ""
check(
  "intent_validator",
  /node_id:\s*intent-validator/.test(intent),
  "intent-validator.yaml",
  "Define intent-validator entry node",
)

// Optional local runtime hardenings (.opencode may be gitignored)
const sandboxTs = path.join(root, ".opencode/tools/sandbox-run.ts")
if (fs.existsSync(sandboxTs)) {
  const src = fs.readFileSync(sandboxTs, "utf8")
  check(
    "runtime_sandbox_ttl",
    /timeout_seconds:[\s\S]*?\.default\(30\)/.test(src) || /default\(30\)/.test(src),
    "sandbox-run.ts",
    "Set sandbox-run default timeout to 30s",
  )
  check(
    "runtime_sandbox_isolate",
    /process_isolate/.test(src) && /dockerAvailable/.test(src),
    "sandbox-run.ts",
    "Implement process_isolate when Docker missing",
  )
} else {
  findings.push({
    id: "runtime_sandbox_ttl",
    status: "WARN",
    evidence: "local .opencode/tools/sandbox-run.ts missing in CI sandbox",
    fix: null,
  })
}

const flowPlugin = path.join(root, ".opencode/plugins/flow-observability.ts")
if (fs.existsSync(flowPlugin)) {
  const src = fs.readFileSync(flowPlugin, "utf8")
  check(
    "runtime_otlp_optional",
    /OTEL_EXPORTER_OTLP_ENDPOINT/.test(src) && /exportOtlpFailSoft/.test(src),
    "flow-observability.ts",
    "Wire optional fail-soft OTLP exporter behind env",
  )
} else {
  findings.push({
    id: "runtime_otlp_optional",
    status: "WARN",
    evidence: "flow-observability.ts missing",
    fix: null,
  })
}

const goalTs = path.join(root, ".opencode/tools/goal-loop-manager.ts")
if (fs.existsSync(goalTs)) {
  const src = fs.readFileSync(goalTs, "utf8")
  check(
    "runtime_critical_error",
    /CRITICAL_ERROR/.test(src),
    "goal-loop-manager.ts",
    "Emit CRITICAL_ERROR when max_iterations reached",
  )
} else {
  findings.push({
    id: "runtime_critical_error",
    status: "WARN",
    evidence: "local goal-loop-manager.ts missing in CI",
    fix: null,
  })
}

const stateTs = path.join(root, ".opencode/tools/state-manager.ts")
if (fs.existsSync(stateTs)) {
  const src = fs.readFileSync(stateTs, "utf8")
  check(
    "runtime_state_snapshot",
    /"snapshot"/.test(src) || /snapshot/.test(src),
    "state-manager.ts",
    "Add state-manager snapshot operation",
  )
} else {
  findings.push({
    id: "runtime_state_snapshot",
    status: "WARN",
    evidence: "local state-manager.ts missing in CI",
    fix: null,
  })
}

const fails = findings.filter((f) => f.status === "FAIL")
const warns = findings.filter((f) => f.status === "WARN")
const passes = findings.filter((f) => f.status === "PASS")
const report = {
  status: fails.length ? "FAIL" : "PASS",
  pass: passes.length,
  warn: warns.length,
  fail: fails.length,
  findings,
}

console.log(JSON.stringify(report, null, 2))
fs.mkdirSync(path.join(root, "docs/opencode-agent-governance/evals"), { recursive: true })
fs.writeFileSync(
  path.join(root, "docs/opencode-agent-governance/evals/last-validation.json"),
  JSON.stringify(report, null, 2),
  "utf8",
)

if (fails.length) process.exit(1)
