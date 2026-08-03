# Agent vs Workflow Classification (OpenCode)

**Date:** 2026-08-03  
**Scope:** `.opencode/` team only (agents, tools, plugins, configs, CI hooks)  
**Principle:** Workflow = deterministic policy/state/gates. Agent = LLM reasoning. If an “agent” mostly runs workflow, **DEGRADE** it to workflow.

## Decision rubric

| Signal | Prefer |
|--------|--------|
| Enforces PASS/BLOCK with fixed rules | Workflow |
| Mutates state machine / ledgers / budgets | Workflow |
| Needs judgment, synthesis, design, diagnosis narrative | Agent |
| Templates notifications / threshold alerts | Workflow (+ optional Agent for prose) |
| Creative planning under uncertainty | Agent |

## Classification summary

### Workflow (keep / harden)

- **Gates & audits:** `decision-router`, `flow-policy-check`, `plan-approval-gate`, `production-approval-gate`, `elite-quality-gate`, `model-assignment-audit`, `agent-roster-audit`, `workflow-state-audit`, `autonomous-capability-audit`, `honors-grade-audit`, `readiness-smoke`, `repo-intake-gate`, `file-gate-check`, `clarification-gate`
- **State & loops:** `state-manager` (+ StateSnapshot), `goal-loop-manager`, `handoff-ledger`, `parallel-dispatch`, `snapshot-create` / `snapshot-restore`, `state-cleanup`
- **Safety:** `sandbox-run` (Docker or process_isolate), `production-safety-guard` plugin, `env-protection` plugin, `anti-doom-loop` plugin, `security-gate.yaml`, Telegram HITL gateway
- **Observability / cost:** `flow-observability` (+ optional OTLP), `metrics-record` / `metrics-push`, `cost-latency-threshold.mjs`, financial circuit breaker in `production-safety.yaml`
- **Degraded former agents (workflow owners):** `semantic-memory-pruner` tool, `cost-latency-threshold.mjs`, `telegram-notify`
- **Config machines:** `workflow-state-machine.yaml`, `task-classification.yaml`, `model-routing.yaml`, `harness-engineering.yaml`, `verification-loop.yaml` (maker/checker contract)

### Agents (LLM nodes)

All `*.md` under `.opencode/agents/` are Agents unless listed under Degrade. Primary entry: `chief-engineer-assistant`. Layer-1 selectable + pillar experts + Layer-2 specialists per `AGENTS.md`.

### Degrade to workflow (COMPLETED 2026-08-03)

| Former agent role | Decision | Status |
|-------------------|----------|--------|
| `memory-cleaner` prune path | **DEGRADE** operational prune to `semantic-memory-pruner` workflow tool; agent retained only as semantic merge advisor (delete tools denied) | Done — committed agent + tool |
| `Metrics-Observer` collection | **DEGRADE** thresholding to `scripts/opencode-governance/cost-latency-threshold.mjs`; agent interprets only | Done — committed agent rewrite |
| `Release-Notifier` template sends | **DEGRADE** send path to `telegram-notify` workflow; agent optional narrative only | Done — committed agent rewrite |

## Actor-Critic mapping

| Role | Component | Type |
|------|-----------|------|
| Actor (maker) | Specialist assigned by decision-router | Agent |
| Critic (checker) | `Technical-Verifier` + `truth-teller` + `elite-quality-gate` | Agent + Workflow |
| Iteration bound | `goal-loops.max_iterations` + hard cap; exceed → `CRITICAL_ERROR` | Workflow |
| Checkpoint | `state-manager` snapshot after each node | Workflow |

## Inventory

See [`docs/agent-inventory.yaml`](./agent-inventory.yaml). Governance details under [`docs/opencode-agent-governance/`](./opencode-agent-governance/).

## Local-only vs committed mirrors

| Path | Tracked? | Why |
|------|----------|-----|
| `docs/agent-inventory.yaml` | Yes | Full inventory mirror for CI |
| `.opencode/config/governance/**` | Yes | Canon policies |
| `.opencode/config/model-routing.yaml`, `agent-graph.yaml`, `semantic-memory-pruner.yaml` | Yes | Governance-critical, no secrets |
| Degraded agents (`memory-cleaner`, `Metrics-Observer`, `Release-Notifier`) | Yes | Prove Agent→Workflow bounds |
| Other `.opencode/agents/*` | No | Large local roster; inventory YAML is source of truth in git |
| `.opencode/CREDENCIALES.md` | **Never** | Secrets |
