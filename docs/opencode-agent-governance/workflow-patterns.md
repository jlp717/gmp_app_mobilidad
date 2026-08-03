# Workflow Patterns & Graph Topology

## Explicit patterns in use

| Pattern | Where | Notes |
|---------|-------|-------|
| Chaining | INTAKE → ROUTED → DISCOVERY → PLAN → IMPLEMENT → VERIFY → … | `workflow-state-machine.yaml` |
| Routing | `decision-router` + `orchestrator-decision-tree.yaml` | Conditional dynamic routing by tier/risk |
| Parallelization | `parallel-dispatch` + worktree isolation | Max concurrent workstreams in harness |
| Orchestrator-workers | Chief + specialists | Handoff ledger context packets |
| Evaluator-optimizer | Maker/checker (`verification-loop.yaml`) + goal loops | Actor-Critic |
| Actor-Critic cycles | Maker agent vs Technical-Verifier/truth-teller/elite-quality-gate | Iteration counters in goal-loops |

## Anti-hang / CRITICAL_ERROR

- Global: `goal_loops.defaults.max_iterations` (20) + `max_iterations_hard_cap` (50)
- Per-node: agent `steps` frontmatter + goal tick bounds
- On exceed: `goal-loop-manager` returns `CRITICAL_ERROR` / status `max_iterations` (BLOCK) — **no silent hang**
- Plugin `anti-doom-loop` throws on 3 identical consecutive tool calls

## StateSnapshot / checkpointing

After each meaningful node transition:

1. `state-manager` operation `snapshot` writes `.opencode/state/snapshots/{task_id}/{ts}.json`
2. Task state stores `snapshot_key`
3. File snapshots via `snapshot-create` for rollback before risky edits

## Conditional dynamic routing

`decision-router` emits agents/MCP/tools/gates/skills; if new risk appears mid-flight, Chief re-runs router and updates context packet. Conservative route wins.
