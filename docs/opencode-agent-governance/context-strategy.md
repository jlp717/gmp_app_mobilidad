# Context Engineering Strategy — OpenCode

## Isolation model

| Layer | Owner | Contents |
|-------|-------|----------|
| `thread_state` | `state-manager` / task JSON | Current objective, step, locks, approvals, metrics, snapshot refs |
| `knowledge_base` | `.opencode/memory/`, RAG, beads, corrections | Durable lessons; **not** full chat transcripts |
| Leader context | Chief | High-level route, gates, compressed summaries |
| Worker context | Specialists via `handoff-ledger` | `task_description` + **compressed** `global_state` only (context_packet), never full thread |

## Worker packet rules

From `handoff-contract.yaml`:

- Required: objective, non_goals, tier, classification, verified_files, acceptance_criteria, required_gates, stop_conditions, evidence_required
- Forbidden: raw full conversation dump, unrelated prior task transcripts
- Soft cap: `harness-engineering.context_and_state.context_packet_max_tokens: 8000`

## Output compression

Specialist returns structured short JSON/MD:

- `status`, `summary` (one paragraph), `evidence`, `changes`, `risks`, `next_step`
- Aggregator (`parallel-dispatch` + Chief) reconciles parallel investigations into a single ledger summary

## Long-task strategy (documented choice)

**Choice: hybrid compaction + note-taking**

1. **Compaction (primary)** — `context-compaction.yaml`: summarize_then_truncate at 80% context; preserve system prompt, objective, last 3 tool results, blockers; persist summaries to filesystem.
2. **Note-taking (durable)** — progress in `.opencode/harness/progress.jsonl` + task state snapshots + goal-loop iteration evidence.

Rationale: compaction keeps the active window usable; notes/snapshots survive session restarts and enable StateSnapshot resume without replaying the full thread.

## Parallel reconciliation

1. `parallel-dispatch` writes per-agent pending manifests with the **same compressed packet**.
2. Each worker returns distilled specialist_output.
3. Chief / `handoff-ledger summarize` merges; conflicts → WARN + ask Javier if risk ≥ R2.

## Separation enforcement

Validators assert:

- Workers must not receive `full_thread: true` in packets
- Checker path in `verification-loop.yaml` forbids full context_packet to verifiers
