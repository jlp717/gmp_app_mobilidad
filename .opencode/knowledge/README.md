# Knowledge Base — GMP App Movilidad

> **Source of Truth for all project knowledge.**
> This directory is git-tracked and persists across all session resets.
> Memory graph is a cache loaded FROM these files at session start.

## Architecture

```
.opencode/knowledge/           ← Persistent, git-tracked, source of truth
         ↓ sync at session start
Memory Graph (MCP server)      ← Fast cache, ephemeral (RAM)
         ↓ sync on /knowledge-save or /knowledge-sync
.opencode/knowledge/           ← Updated with new learnings
```

## File Inventory

| File | Purpose | Auto-updated? |
|------|---------|---------------|
| `BUSINESS_RULES.md` | Business logic invariants, critical rules | Manual (review on change) |
| `ARCHITECTURE.md` | System architecture (Flutter, Backend, DB) | Manual (review on change) |
| `DB_SCHEMA.md` | Database schemas, tables, query patterns | Manual (review on change) |
| `USER_PATTERNS.md` | User preferences, expectations, anti-patterns | Manual (review on change) |
| `PROJECT_STATE.md` | Current state: branch, tests, known issues, debt | Auto-updated by /health |
| `TEAM_CAPABILITIES.md` | Agent roster, model assignments, skills, MCPs | Auto-updated by /knowledge-sync |
| `DECISIONS.md` | Architecture Decision Records | Appended by agents on decisions |
| `SESSION_LOG.md` | Last session summary, handoff context | Auto-updated by orchestrator |
| `COMMANDS.md` | Custom slash commands reference | Manual |

## Protocols

### Session Start (Orchestrator)
1. Read ALL files in `.opencode/knowledge/` 
2. Create entities in memory graph from file contents
3. Run quick health check (`/health --quick`)
4. Proceed with user's request

### Knowledge Capture
- **Significant decisions**: Agent MUST append to `DECISIONS.md`
- **New business rules**: Agent MUST add to `BUSINESS_RULES.md`
- **State changes**: Orchestrator MUST update `PROJECT_STATE.md`
- **End of session**: Orchestrator MUST update `SESSION_LOG.md`

### Sync Commands
- `/knowledge-sync` — Sync memory ↔ files (bidirectional)
- `/knowledge-save` — Dump memory graph to files
- `/health` — Full project audit + update PROJECT_STATE.md
