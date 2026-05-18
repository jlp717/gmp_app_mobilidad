---
description: Dump memory graph to knowledge files. Creates a filesystem checkpoint of current memory state.
---

# /knowledge-save

Dump ALL memory graph entities to `.opencode/knowledge/` files.

Use this when you've discovered significant new information during a session
and want to persist it before the session ends or before a reset.

## Protocol

1. Read full memory graph via `memory_read_graph`
2. For each entity:
   - Map entity name to a `.opencode/knowledge/` file
   - If entity name has a corresponding file → UPDATE it with new observations
   - If entity name has NO corresponding file → CREATE a new file
3. Format observations as structured markdown sections
4. Write/update files
5. Verify files were written correctly

## Entity → File Mapping

| Entity Type | Target File |
|-------------|-------------|
| Knowledge/general entity | Entity name as filename + `.md` |
| BusinessRules | `BUSINESS_RULES.md` |
| Architecture | `ARCHITECTURE.md` |
| DatabaseKnowledge | `DB_SCHEMA.md` |
| UserPreferences | `USER_PATTERNS.md` |
| ProjectState | `PROJECT_STATE.md` |
| Config | `TEAM_CAPABILITIES.md` |
| Decision | `DECISIONS.md` |
| SessionContext | `SESSION_LOG.md` |

## When to Run

- Before ending a session
- After discovering critical new information
- When the user says "guarda esto"
- After a complex task that generated significant context
