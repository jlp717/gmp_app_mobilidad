---
name: context-reset
description: Protocol for clearing the context window between major phases while preserving task state via structured handoffs. Implements Anthropic's context reset strategy for OpenCode V4.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
  version: "1.0"
---

## Purpose

When the context window approaches capacity (70%+), this protocol clears it while preserving all task-critical state in a structured handoff file. The next session/agent reads the handoff and continues without losing context.

## Trigger

- Context exceeds 70% capacity
- Transitioning between major phases (discovery → plan → execute → verify)
- Switching primary agent (Chief → Specialist → Reviewer)
- Session handoff at end of work block

## Protocol

### Step 1: Generate Handoff

Before context is cleared, write a structured handoff file:

```markdown
# Context Handoff: {task_id}

## Objective
{One sentence describing the current goal}

## Completed Work
- [x] Step 1: ...
- [x] Step 2: ...

## Remaining Work
- [ ] Step 3: ...
- [ ] Step 4: ...

## Key Decisions Made
| Decision | Rationale | Impact |
|----------|-----------|--------|
| Use Riverpod over Provider | Team convention, autoDispose | All new features |

## Files Modified
- `lib/features/commissions/providers/commissions_provider.dart` — added batch loading
- `backend/routes/commissions.js` — added pagination

## Verified Facts
- CPC table has duplicates; use ROW_NUMBER() for dedup
- commissions_provider.dart:142 contains confirmed N+1
- Backend route `/api/commissions` uses auth middleware

## Blockers
- DB2 schema verification pending for CPC indexes
- Waiting on Javier approval for migration plan

## Next Steps
1. Run `dart run build_runner build` after provider changes
2. Verify DB2 query plan for new batch endpoint
3. Deploy to staging for QA smoke test

## Context Checksum
- Last state-manager snapshot: `20260810-220000-gmp-nplus1-audit`
- Last handoff-ledger entry: `handoff-20260810-220500`
- Workflow checkpoint: `phase-2-complete`
```

### Step 2: Persist State

```bash
# Save state-manager snapshot
state-manager snapshot --task_id {task_id} --node_id {current_node}

# Save handoff to filesystem
.opencode/state/context-handoffs/{task_id}-{timestamp}.md

# Update handoff-ledger
handoff-ledger record_handoff --task_id {task_id} --agent {current_agent}
```

### Step 3: Clear Context

Signal context reset to OpenCode. The conversation window is cleared. Only the handoff file and state-manager checkpoint persist.

### Step 4: Resume

The next session/agent:

1. Reads `.opencode/state/context-handoffs/{task_id}-latest.md`
2. Reads `state-manager read --task_id {task_id}`
3. Reads `handoff-ledger summarize --task_id {task_id}`
4. Continues from "Next Steps"

## Handoff File Location

```
.opencode/state/context-handoffs/
├── 20260810-220000-gmp-nplus1-audit-20260810-223000.md
├── 20260810-220000-gmp-nplus1-audit-20260810-230000.md
└── 20260810-220000-gmp-nplus1-audit-latest.md  # symlink to newest
```

## Handoff Quality Checklist

Before clearing context, verify the handoff contains:

- [ ] Task ID and objective are unambiguous
- [ ] Completed work is specific (file:line references)
- [ ] Remaining work is actionable (no vague items)
- [ ] Key decisions include rationale
- [ ] Files modified are listed with change summary
- [ ] Verified facts are distinguished from assumptions
- [ ] Blockers are explicit with owner
- [ ] Next steps are ordered and bounded

## Integration with Dynamic Workflow

When a workflow script triggers a context reset between phases:

```javascript
// Inside workflow script
await workflow.phase("execute", {
  agents: [...],
  on_phase_complete: async (phase) => {
    await workflow.checkpoint();
    await workflow.signal_context_reset({
      handoff_path: `.opencode/state/context-handoffs/${task_id}-${phase}.md`,
    });
  },
});
```

## Anxiety Prevention

If the model shows signs of context anxiety (premature wrap-up, repeated summarization):

1. Inject reminder: "Context anxiety detected. The task is not complete."
2. Check if a context reset is actually needed (vs. just injecting the handoff)
3. If reset needed: follow this protocol
4. If reset NOT needed: continue working, ignore anxiety signal

## State Preservation Matrix

| State | Preserved Via | Survives Reset |
|-------|---------------|----------------|
| Task progress | state-manager snapshot | Yes |
| Agent handoffs | handoff-ledger | Yes |
| File modifications | git diff | Yes |
| Verified facts | handoff file | Yes |
| Conversation history | NO | Lost on reset |
| Tool call results | NO (summarized in handoff) | Partial |
| Memory MCP entities | memory MCP | Yes |
| Workflow checkpoints | filesystem | Yes |
