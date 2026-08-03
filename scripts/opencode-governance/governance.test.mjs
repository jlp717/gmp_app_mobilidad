import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const root = path.resolve(process.cwd())

test("baseline and gold cases parse", () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(root, "docs/opencode-agent-governance/evals/baseline.json"), "utf8"),
  )
  const gold = JSON.parse(
    fs.readFileSync(path.join(root, "docs/opencode-agent-governance/evals/gold-cases.json"), "utf8"),
  )
  assert.ok(baseline.min_gold_cases >= 6)
  assert.equal(gold.cases.length >= baseline.min_gold_cases, true)
  for (const c of gold.cases) {
    assert.ok(c.id && c.expect)
    assert.equal(c.deterministic, true)
  }
})

test("ACI registry marks destructive and open-world", () => {
  const aci = fs.readFileSync(
    path.join(root, "docs/opencode-agent-governance/canon/tool-aci-registry.yaml"),
    "utf8",
  )
  assert.match(aci, /destructive:/)
  assert.match(aci, /open_world:/)
  assert.match(aci, /poka_yoke:/)
  assert.match(aci, /sandbox-run/)
})

test("sandbox policy TTL hard max 30 + process_isolate fallback", () => {
  const policy = fs.readFileSync(
    path.join(root, "docs/opencode-agent-governance/canon/sandbox-policy.yaml"),
    "utf8",
  )
  assert.match(policy, /ttl_hard_max_seconds:\s*30/)
  assert.match(policy, /fallback_when_docker_missing:/)
  assert.match(policy, /mode:\s*process_isolate/)
  assert.match(policy, /network_with_isolate:\s*false/)
})

test("intent validator is workflow entry node", () => {
  const intent = fs.readFileSync(
    path.join(root, "docs/opencode-agent-governance/canon/intent-validator.yaml"),
    "utf8",
  )
  assert.match(intent, /classification:\s*workflow/)
  assert.match(intent, /node_id:\s*intent-validator/)
})

test("otel maps gen_ai conventions and optional OTLP env", () => {
  const otel = fs.readFileSync(
    path.join(root, "docs/opencode-agent-governance/canon/otel-agentops.yaml"),
    "utf8",
  )
  assert.match(otel, /gen_ai\.execute_tool|gen_ai\.route|gen_ai\.invoke_agent/)
  assert.match(otel, /OTEL_EXPORTER_OTLP_ENDPOINT/)
  assert.match(otel, /collector_otlp:\s*"optional"/)
  assert.doesNotMatch(otel, /collector_otlp:\s*"pending"/)
})

test("inventory lists agents and completed degrade list", () => {
  const inv = fs.readFileSync(path.join(root, "docs/agent-inventory.yaml"), "utf8")
  assert.match(inv, /chief-engineer-assistant/)
  assert.match(inv, /degrade_to_workflow:/)
  assert.match(inv, /memory-cleaner/)
  assert.match(inv, /status:\s*completed/)
  assert.match(inv, /semantic-memory-pruner/)
})

test("validate-governance exits 0", () => {
  const r = spawnSync(process.execPath, ["scripts/opencode-governance/validate-governance.mjs"], {
    cwd: root,
    encoding: "utf8",
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const report = JSON.parse(r.stdout)
  assert.equal(report.status, "PASS")
  assert.equal(report.fail, 0)
})

test("gold case ids unique", () => {
  const gold = JSON.parse(
    fs.readFileSync(path.join(root, "docs/opencode-agent-governance/evals/gold-cases.json"), "utf8"),
  )
  const ids = gold.cases.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("sandbox-run implements process_isolate fail-closed network", () => {
  const src = fs.readFileSync(path.join(root, ".opencode/tools/sandbox-run.ts"), "utf8")
  assert.match(src, /process_isolate/)
  assert.match(src, /dockerAvailable/)
  assert.match(src, /network=true requires Docker/)
  assert.match(src, /\.default\(30\)/)
})

test("flow-observability optional OTLP fail-soft", () => {
  const src = fs.readFileSync(path.join(root, ".opencode/plugins/flow-observability.ts"), "utf8")
  assert.match(src, /OTEL_EXPORTER_OTLP_ENDPOINT/)
  assert.match(src, /exportOtlpFailSoft/)
  assert.match(src, /buildOtlpTracePayload/)
})

test("degraded agents deny unbounded tools", () => {
  const mc = fs.readFileSync(path.join(root, ".opencode/agents/memory-cleaner.md"), "utf8")
  const mo = fs.readFileSync(path.join(root, ".opencode/agents/Metrics-Observer.md"), "utf8")
  const rn = fs.readFileSync(path.join(root, ".opencode/agents/Release-Notifier.md"), "utf8")
  assert.match(mc, /DEGRADE/)
  assert.match(mc, /memory_delete_entities:\s*deny/)
  assert.match(mc, /semantic-memory-pruner/)
  assert.match(mo, /cost-latency-threshold/)
  assert.match(mo, /task:\s*deny/)
  assert.match(rn, /telegram-notify/)
  assert.match(rn, /bash:\s*deny/)
})

test("canary-eval-rollback script runs and keeps stable on pass", () => {
  const r = spawnSync(process.execPath, ["scripts/opencode-governance/canary-eval-rollback.mjs"], {
    cwd: root,
    encoding: "utf8",
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.action, "pass")
  const state = JSON.parse(
    fs.readFileSync(path.join(root, "docs/opencode-agent-governance/evals/canary-state.json"), "utf8"),
  )
  assert.ok(["stable", "rolled_back"].includes(state.status) || state.status === "stable")
  assert.ok(state.last_known_good)
})

test("cost-latency-threshold script is committed", () => {
  assert.ok(
    fs.existsSync(path.join(root, "scripts/opencode-governance/cost-latency-threshold.mjs")),
  )
})
