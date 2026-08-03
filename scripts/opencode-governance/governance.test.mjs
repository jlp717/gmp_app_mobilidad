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

test("sandbox policy TTL hard max 30", () => {
  const policy = fs.readFileSync(
    path.join(root, "docs/opencode-agent-governance/canon/sandbox-policy.yaml"),
    "utf8",
  )
  assert.match(policy, /ttl_hard_max_seconds:\s*30/)
})

test("intent validator is workflow entry node", () => {
  const intent = fs.readFileSync(
    path.join(root, "docs/opencode-agent-governance/canon/intent-validator.yaml"),
    "utf8",
  )
  assert.match(intent, /classification:\s*workflow/)
  assert.match(intent, /node_id:\s*intent-validator/)
})

test("otel maps gen_ai conventions", () => {
  const otel = fs.readFileSync(
    path.join(root, "docs/opencode-agent-governance/canon/otel-agentops.yaml"),
    "utf8",
  )
  assert.match(otel, /gen_ai\.execute_tool|gen_ai\.route|gen_ai\.invoke_agent/)
})

test("inventory lists agents and degrade list", () => {
  const inv = fs.readFileSync(path.join(root, "docs/agent-inventory.yaml"), "utf8")
  assert.match(inv, /chief-engineer-assistant/)
  assert.match(inv, /degrade_to_workflow:/)
  assert.match(inv, /memory-cleaner/)
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
