#!/usr/bin/env node
/**
 * Deterministic cost/latency threshold check for team runs.
 * Reads .opencode/state/metrics-latest.json and flow traces; exits non-zero on BLOCK.
 */
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const args = new Set(process.argv.slice(2))
const failOnWarn = args.has("--fail-on-warn")

const THRESHOLDS = {
  session_cost_usd_warn: 5,
  session_cost_usd_block: 25,
  p95_latency_ms_warn: 120000,
  p95_latency_ms_block: 300000,
  token_budget_warn_ratio: 0.8,
}

const findings = []
const metricsPath = path.join(root, ".opencode", "state", "metrics-latest.json")
let metrics = null
if (fs.existsSync(metricsPath)) {
  try {
    metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"))
  } catch {
    findings.push({ severity: "WARN", rule: "metrics_parse", evidence: metricsPath, fix: "Repair metrics-latest.json" })
  }
} else {
  findings.push({
    severity: "WARN",
    rule: "metrics_missing",
    evidence: "No .opencode/state/metrics-latest.json",
    fix: "Run metrics-record after team sessions",
  })
}

if (metrics) {
  const cost = Number(metrics.session_cost_usd ?? metrics.cost_usd ?? 0)
  const p95 = Number(metrics.p95_latency_ms ?? metrics.latency_p95_ms ?? 0)
  const budget = Number(metrics.token_budget ?? metrics.budget_tokens ?? 0)
  const used = Number(metrics.tokens_used ?? metrics.total_tokens ?? 0)

  if (cost >= THRESHOLDS.session_cost_usd_block) {
    findings.push({
      severity: "BLOCK",
      rule: "cost_circuit_breaker",
      evidence: `session_cost_usd=${cost}`,
      fix: "Pause loops; require Javier approval to continue",
    })
  } else if (cost >= THRESHOLDS.session_cost_usd_warn) {
    findings.push({
      severity: "WARN",
      rule: "cost_high",
      evidence: `session_cost_usd=${cost}`,
      fix: "Reduce concurrent handoffs or switch to opencode-go models",
    })
  }

  if (p95 >= THRESHOLDS.p95_latency_ms_block) {
    findings.push({
      severity: "BLOCK",
      rule: "latency_block",
      evidence: `p95_latency_ms=${p95}`,
      fix: "Split workstreams or reduce tool-call depth",
    })
  } else if (p95 >= THRESHOLDS.p95_latency_ms_warn) {
    findings.push({
      severity: "WARN",
      rule: "latency_warn",
      evidence: `p95_latency_ms=${p95}`,
      fix: "Profile slow tools via flow-trace",
    })
  }

  if (budget > 0 && used / budget >= THRESHOLDS.token_budget_warn_ratio) {
    findings.push({
      severity: "WARN",
      rule: "token_budget_ratio",
      evidence: `used=${used} budget=${budget}`,
      fix: "Trigger context-compaction or close handoffs",
    })
  }
}

const blocks = findings.filter((f) => f.severity === "BLOCK")
const warns = findings.filter((f) => f.severity === "WARN")
const status = blocks.length ? "BLOCK" : warns.length ? "WARN" : "PASS"

const payload = {
  status,
  generated_at: new Date().toISOString(),
  thresholds: THRESHOLDS,
  block_count: blocks.length,
  warn_count: warns.length,
  findings,
}

const outDir = path.join(root, ".opencode", "state")
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, "cost-latency-threshold-latest.json"), JSON.stringify(payload, null, 2))

console.log(`cost-latency-threshold: ${status} blocks=${blocks.length} warns=${warns.length}`)
if (status === "BLOCK" || (failOnWarn && warns.length)) process.exit(1)
process.exit(0)
