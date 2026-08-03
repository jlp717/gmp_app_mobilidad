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
- **Safety:** `sandbox-run`, `production-safety-guard` plugin, `env-protection` plugin, `anti-doom-loop` plugin, `security-gate.yaml`, Telegram HITL gateway
- **Observability / cost:** `flow-observability`, `metrics-record` / `metrics-push`, `cost-latency-threshold.mjs`, financial circuit breaker in `production-safety.yaml`
- **Config machines:** `workflow-state-machine.yaml`, `task-classification.yaml`, `model-routing.yaml`, `harness-engineering.yaml`, `verification-loop.yaml` (maker/checker contract)

### Agents (LLM nodes)

All `*.md` under `.opencode/agents/` are Agents unless listed under Degrade. Primary entry: `chief-engineer-assistant`. Layer-1 selectable + pillar experts + Layer-2 specialists per `AGENTS.md`.

### Degrade to workflow (actions taken / required)

| Former agent role | Decision | Justification |
|-------------------|----------|---------------|
| `memory-cleaner` prune path | **DEGRADE** operational prune to `semantic-memory-pruner` workflow; agent retained only for semantic merge proposals | Deterministic GC must not invent deletes |
| `Metrics-Observer` collection | **DEGRADE** thresholding to `scripts/opencode-governance` + `cost-latency-threshold.mjs`; agent interprets only | Thresholds are policy, not creativity |
| `Release-Notifier` template sends | **DEGRADE** send path to `telegram-notify` workflow; agent optional for complex narrative | HITL + templating safer as workflow |

## Actor-Critic mapping

| Role | Component | Type |
|------|-----------|------|
| Actor (maker) | Specialist assigned by decision-router | Agent |
| Critic (checker) | `Technical-Verifier` + `truth-teller` + `elite-quality-gate` | Agent + Workflow |
| Iteration bound | `goal-loops.max_iterations` + hard cap; exceed → `CRITICAL_ERROR` | Workflow |
| Checkpoint | `state-manager` snapshot after each node | Workflow |

## Inventory

See [`docs/agent-inventory.yaml`](./agent-inventory.yaml). Governance details under [`docs/opencode-agent-governance/`](./opencode-agent-governance/).
