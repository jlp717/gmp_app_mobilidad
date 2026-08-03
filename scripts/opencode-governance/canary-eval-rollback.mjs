#!/usr/bin/env node
/**
 * Canary eval + auto-rollback for OpenCode governance (agent/prompt/model markers).
 * Staging/local orchestration — does NOT deploy to production hosts.
 *
 * Usage:
 *   node scripts/opencode-governance/canary-eval-rollback.mjs
 *   node scripts/opencode-governance/canary-eval-rollback.mjs --promote <label>
 *   node scripts/opencode-governance/canary-eval-rollback.mjs --candidate <label>
 *
 * On validate-governance FAIL while status=canary → restore last_known_good, exit 1.
 * On PASS with candidate → promote to last_known_good / active.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"

const root = path.resolve(process.cwd())
const statePath = path.join(root, "docs/opencode-agent-governance/evals/canary-state.json")
const markerDir = path.join(root, "docs/opencode-agent-governance/evals/canary-markers")

function hashGovernance() {
  const files = [
    "docs/agent-classification.md",
    "docs/agent-inventory.yaml",
    "docs/opencode-agent-governance/canon/sandbox-policy.yaml",
    "docs/opencode-agent-governance/canon/otel-agentops.yaml",
    "docs/opencode-agent-governance/canon/cost-governance.yaml",
    "docs/opencode-agent-governance/canon/intent-validator.yaml",
    "docs/opencode-agent-governance/canon/tool-aci-registry.yaml",
    "docs/opencode-agent-governance/evals/baseline.json",
    "docs/opencode-agent-governance/evals/gold-cases.json",
  ]
  const h = crypto.createHash("sha256")
  for (const f of files) {
    const p = path.join(root, f)
    if (fs.existsSync(p)) h.update(fs.readFileSync(p))
    h.update("\n")
  }
  return h.digest("hex").slice(0, 16)
}

function loadState() {
  if (!fs.existsSync(statePath)) {
    return {
      version: 1,
      active_revision: "bootstrap",
      last_known_good: "bootstrap",
      candidate: null,
      status: "stable",
      updated_at: new Date().toISOString(),
      notes: "Auto-created canary state",
    }
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8"))
}

function saveState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.mkdirSync(markerDir, { recursive: true })
  state.updated_at = new Date().toISOString()
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8")
  fs.writeFileSync(
    path.join(markerDir, `${state.active_revision}.json`),
    JSON.stringify(
      {
        revision: state.active_revision,
        governance_hash: state.governance_hash,
        status: state.status,
        saved_at: state.updated_at,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
}

function runValidator() {
  const r = spawnSync(process.execPath, ["scripts/opencode-governance/validate-governance.mjs"], {
    cwd: root,
    encoding: "utf8",
  })
  let report = null
  try {
    report = JSON.parse(r.stdout || "{}")
  } catch {
    report = { status: "FAIL", parse_error: true, stdout: r.stdout, stderr: r.stderr }
  }
  return { exit: r.status ?? 1, report }
}

const args = process.argv.slice(2)
const promoteIdx = args.indexOf("--promote")
const candidateIdx = args.indexOf("--candidate")
const state = loadState()
const governanceHash = hashGovernance()
state.governance_hash = governanceHash

if (candidateIdx >= 0) {
  const label = args[candidateIdx + 1] || `canary-${governanceHash}`
  state.candidate = label
  state.status = "canary"
  state.active_revision = label
  saveState(state)
  console.log(JSON.stringify({ action: "candidate_set", ...state }, null, 2))
}

if (promoteIdx >= 0) {
  const label = args[promoteIdx + 1] || state.candidate || state.active_revision
  state.active_revision = label
  state.last_known_good = label
  state.candidate = null
  state.status = "stable"
  saveState(state)
  console.log(JSON.stringify({ action: "promoted", ...state }, null, 2))
  process.exit(0)
}

const { exit, report } = runValidator()
const pass = exit === 0 && report?.status === "PASS" && (report?.fail ?? 1) === 0

if (pass) {
  if (state.status === "canary" && state.candidate) {
    state.last_known_good = state.candidate
    state.active_revision = state.candidate
    state.candidate = null
    state.status = "stable"
    state.last_result = "promoted_after_pass"
  } else {
    state.last_known_good = state.active_revision || governanceHash
    state.status = "stable"
    state.last_result = "pass"
  }
  saveState(state)
  console.log(
    JSON.stringify(
      {
        action: "pass",
        canary: state,
        validator: { status: report.status, pass: report.pass, fail: report.fail },
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

// FAIL path: auto-rollback when in canary
if (state.status === "canary" || state.candidate) {
  const rolled = {
    ...state,
    active_revision: state.last_known_good,
    candidate: null,
    status: "rolled_back",
    last_result: "auto_rollback_on_eval_regression",
    regression_evidence: {
      validator_status: report?.status,
      fail: report?.fail,
      findings: (report?.findings || []).filter((f) => f.status === "FAIL").slice(0, 12),
    },
  }
  saveState(rolled)
  console.log(
    JSON.stringify(
      {
        action: "auto_rollback",
        canary: rolled,
        validator: report,
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

saveState({
  ...state,
  last_result: "fail_stable_no_rollback",
})
console.log(
  JSON.stringify(
    {
      action: "fail",
      note: "Stable revision failed validation; no canary candidate to roll back",
      canary: state,
      validator: report,
    },
    null,
    2,
  ),
)
process.exit(1)
