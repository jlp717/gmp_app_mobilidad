---
name: goal-driven-loop
description: Itera hacia un objetivo con checklist persistente, criterios verificables y parada por completion_promise o max_iterations (Claude /goal, /loop, Ralph).
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  integration: goal-loop-manager
---

## When To Use

Use when Javier describes an **objective** instead of a one-shot prompt:

- "Deja listo el flujo pedidos→bolsa→cobros sin errores"
- "No pares hasta que pasen todos los tests"
- "Itera hasta que el endpoint responda 200 en staging"
- "Cada 10 minutos verifica health del backend"
- `/goal ...` or `/loop ...`

Do **not** use for simple questions, one-line fixes, or status checks without iteration.

## Modes

| Mode | When | Behavior |
|------|------|----------|
| `ralph` | Unknown scope, refinement needed | Same objective each iteration; learn from prior ticks in state file |
| `checklist` | Clear acceptance criteria | Track criteria `pending` → `done` with evidence per item |
| `recurring` | Monitoring/triage | Fixed interval until cancel or stop condition |

## Workflow

### 1. Create goal

```
goal-loop-manager operation=create
  objective="..."
  acceptance_criteria=["criterio 1", "criterio 2"]
  completion_promise="GOAL_DONE"
  max_iterations=20
  loop_mode=ralph|checklist|recurring
  interval=5m   # recurring only
```

Also run `decision-router` and `flow-policy-check` before first implementation tick.

### 2. Iteration loop

Each iteration:

1. `goal-loop-manager operation=resume goal_id=...` — read checklist and next_action
2. Execute work (delegate specialists, run tests, verify)
3. `goal-loop-manager operation=tick` with:
   - `iteration_summary`
   - `evidence[]` (commands, files, test output, screenshots)
   - `checklist_updates[]` (`id`, `status`, `evidence`)
   - `blockers[]` if stuck
4. If `should_continue` and status `active`, start next iteration immediately
5. If all criteria done: `operation=verify` then `operation=complete`

### 3. Stop conditions

- All acceptance criteria `done` + `complete` with exact `completion_promise`
- `max_iterations` reached → report partial progress, do not fake DONE
- Javier says stop → `operation=cancel`
- V4 gate blocks (plan, production, DB2 write) → `status=blocked`, explain what approval is needed

## Rules

- **Evidence required** every tick; empty ticks are invalid
- **V4 gates still apply**: plan approval (T2/T3), elite-quality-gate, production-approval-gate
- **Hybrid mode**: loops do NOT replace asking Javier. On ambiguity, NEEDS_INFO, or business decision → `clarification-gate ask` + `goal-loop-manager pause` → end turn
- **No doom loops**: vary actions between iterations; if same tool+args repeat 3×, anti-doom-loop blocks
- **Goal drift**: re-read `objective` and pending criteria at each `resume`; do not drop constraints after compaction
- **Persist state** in `.opencode/state/goals/` so interrupted sessions resume
- **Natural language**: Javier never needs `/goal` or `/loop`; Chief maps phrases to this skill

## Combine with team flow

- Link `task_id` when goal is part of a Tier 2/3 task
- Record delegations in `handoff-ledger` per iteration
- On complete: `memory-save` lessons, update beads if applicable
- Recurring + goal: set hard completion criteria with `/goal`, cadence with `/loop`

## Chief mobile summary

After each iteration, report in ≤3 lines:

1. Iteration N/M — what changed
2. Checklist: X/Y done
3. Next: continue | blocked (reason) | DONE
