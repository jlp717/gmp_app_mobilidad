#!/usr/bin/env node
/**
 * Generates docs/agent-inventory.yaml from local .opencode/agents + tools listing.
 * Safe to run when .opencode/ exists locally (often gitignored).
 */
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(process.cwd())
const agentsRawPath = path.join(root, "scripts/opencode-governance/_agents-raw.json")
const toolsRawPath = path.join(root, "scripts/opencode-governance/_tools-raw.txt")
const outPath = path.join(root, "docs/agent-inventory.yaml")

const workflowToolNames = new Set([
  "decision-router",
  "flow-policy-check",
  "handoff-ledger",
  "state-manager",
  "plan-approval-gate",
  "production-approval-gate",
  "elite-quality-gate",
  "model-assignment-audit",
  "agent-roster-audit",
  "workflow-state-audit",
  "readiness-smoke",
  "snapshot-create",
  "snapshot-restore",
  "file-gate-check",
  "clarification-gate",
  "goal-loop-manager",
  "scheduled-automation-runner",
  "sandbox-run",
  "semantic-memory-pruner",
  "parallel-dispatch",
  "flow-status",
  "flow-trace",
  "model-provider-health",
  "state-cleanup",
  "autonomous-capability-audit",
  "honors-grade-audit",
  "repo-intake-gate",
  "team-ci",
  "metrics-record",
  "metrics-push",
  "telegram-notify",
  "correction-capture",
  "intent-validator",
])

const degradeCandidates = [
  {
    agent: "memory-cleaner",
    justification:
      "Mostly deterministic GC/prune; keep LLM only for semantic merge; prune path is workflow semantic-memory-pruner (status=completed).",
  },
  {
    agent: "Metrics-Observer",
    justification:
      "Collection/thresholding is workflow (cost-latency-threshold.mjs); agent should only interpret incidents (status=completed).",
  },
  {
    agent: "Release-Notifier",
    justification:
      "Templated Telegram notify is workflow (telegram-notify); agent only for narrative synthesis (status=completed).",
  },
]

const plugins = [
  "anti-doom-loop",
  "anti-hallucination-guard",
  "context-compaction",
  "env-protection",
  "execution-visibility",
  "flow-observability",
  "goal-loop-idle-hint",
  "mobile-mode-detector",
  "model-fallback-forward",
  "production-safety-guard",
  "rate-limit-handler",
  "same-error-detector",
  "session-lifecycle",
  "session-resilience",
  "task-tracer",
  "user-correction-capture",
]

function loadAgents() {
  if (fs.existsSync(agentsRawPath)) {
    const raw = fs.readFileSync(agentsRawPath, "utf8").replace(/^\uFEFF/, "")
    return JSON.parse(raw)
  }
  const agentsDir = path.join(root, ".opencode/agents")
  if (!fs.existsSync(agentsDir)) {
    throw new Error("Missing agents raw JSON and .opencode/agents/")
  }
  return fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md") && !f.includes(".bak"))
    .map((f) => {
      const c = fs.readFileSync(path.join(agentsDir, f), "utf8")
      const name = f.replace(/\.md$/, "")
      const model = (c.match(/^model:\s*(.+)$/m) || [])[1]?.trim() || "MISSING"
      const mode = (c.match(/^mode:\s*(.+)$/m) || [])[1]?.trim() || "n/a"
      const description =
        (c.match(/^description:\s*"?(.+?)"?\s*$/m) || [])[1]?.replace(/"/g, "").trim() || "n/a"
      const tools = [...c.matchAll(/^ {2}([a-z0-9-]+):\s*true/gm)].map((m) => m[1])
      const invoker =
        mode === "primary"
          ? "javier_entrypoint"
          : mode === "subagent"
            ? "chief_or_task_tool"
            : "chief_decision_router_or_manual_at"
      return { name, mode, model, description, tools: tools.join(","), invoker }
    })
}

function loadTools() {
  if (fs.existsSync(toolsRawPath)) {
    return fs
      .readFileSync(toolsRawPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((t) => t.replace(/\.ts$/, ""))
  }
  const toolsDir = path.join(root, ".opencode/tools")
  if (!fs.existsSync(toolsDir)) return []
  return fs
    .readdirSync(toolsDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""))
}

const agents = loadAgents()
const tools = loadTools()
const lines = []

lines.push("# OpenCode agent inventory — FASE 0 audit")
lines.push("# Runtime agents live under .opencode/agents/ (often gitignored). This file is the committed inventory.")
lines.push("version: 1")
lines.push("project: gmp_app_mobilidad")
lines.push('generated_at: "2026-08-03T19:00:00+02:00"')
lines.push('scope: ".opencode/ agents, tools, plugins, workflow configs"')
lines.push("")
lines.push("classification_principle: |")
lines.push("  Workflow = deterministic gates/state/tools that enforce policy without creative reasoning.")
lines.push("  Agent = LLM node that reasons, plans, or synthesizes. If an agent mostly does workflow work, DEGRADE.")
lines.push("")
lines.push("agents:")

for (const a of agents) {
  const toolsList = a.tools ? String(a.tools).split(",").filter(Boolean) : []
  const kind = a.mode === "primary" ? "orchestrator_agent" : "agent"
  lines.push(`  - name: ${a.name}`)
  lines.push(`    kind: ${kind}`)
  lines.push("    declared_role: |")
  lines.push(`      ${(a.description || "n/a").replace(/\r?\n/g, " ").slice(0, 240)}`)
  lines.push(`    assigned_model: ${a.model}`)
  lines.push(`    mode: ${a.mode}`)
  lines.push("    tools_access:")
  if (toolsList.length === 0) {
    lines.push("      - frontmatter_defaults")
  } else {
    for (const t of toolsList) lines.push(`      - ${t}`)
  }
  lines.push(`    invoked_by: ${a.invoker}`)
  lines.push('    notes: "Layer per AGENTS.md V4 two-layer model"')
}

lines.push("")
lines.push("workflow_tools:")
for (const name of tools) {
  lines.push(`  - name: ${name}`)
  lines.push(`    classification: ${workflowToolNames.has(name) ? "workflow" : "agent_tool"}`)
  lines.push("    invoked_by: agents_via_tool_call")
}

lines.push("")
lines.push("plugins_workflow:")
for (const p of plugins) {
  lines.push(`  - name: ${p}`)
  lines.push("    classification: workflow")
  lines.push("    invoked_by: opencode_runtime_hooks")
}

lines.push("")
lines.push("degrade_to_workflow:")
for (const d of degradeCandidates) {
  lines.push(`  - agent: ${d.agent}`)
  lines.push("    justification: |")
  lines.push(`      ${d.justification}`)
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8")
console.log(`Wrote ${outPath} (${agents.length} agents, ${tools.length} tools)`)
