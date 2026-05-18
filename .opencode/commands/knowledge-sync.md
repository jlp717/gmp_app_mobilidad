---
description: Bidirectional sync between memory graph and knowledge files. Files win on conflict.
---

# /knowledge-sync

Sync knowledge bidirectionally between memory graph and `.opencode/knowledge/` files.

**Principle**: Files are the source of truth. On conflict, files win.
But new learnings discovered during the session are saved back to files.

## Direction

### Phase 1: Files → Memory
1. Read ALL files in `.opencode/knowledge/`
2. Create/update entities in memory graph
3. Files ALWAYS override memory on conflict

### Phase 2: Memory → Files
1. Read current memory graph
2. Check for entities/observations NOT in files
3. Append new knowledge to corresponding files
4. If no corresponding file exists, append to `SESSION_LOG.md`

## Output
- Summary of what was synced
- Count of new entities created
- Count of files updated
- Any conflicts resolved

## When to Run
- After `/knowledge-bootstrap` to ensure graph matches files
- After `/health` to capture new state
- Before `/knowledge-save` for a clean checkpoint
- At end of session for handoff
