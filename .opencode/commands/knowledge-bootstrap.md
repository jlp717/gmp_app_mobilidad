---
description: Load all knowledge files into memory graph. Run at session start or after reset.
---

# /knowledge-bootstrap

Load all persistent knowledge from `.opencode/knowledge/` into the memory graph.

Run this at the START of every session to restore project context.
After OpenCode Go reset, this is REQUIRED before any meaningful work.

## Protocol

1. Read ALL files in `.opencode/knowledge/` (9 files)
2. For each file, create entities and observations in the memory graph:
   - Entity name → filename without extension (e.g., `BUSINESS_RULES`)
   - Entity type → `Knowledge`
   - Observations → key sections from the file
3. Verify load was successful by reading memory graph

## Files to Load

| File | Entity Name | Key Sections |
|------|-------------|--------------|
| `BUSINESS_RULES.md` | business_rules | Core rules, vendor ALL, RUTERO_CONFIG, commissions, prohibitions |
| `ARCHITECTURE.md` | architecture | Stack, Flutter arch, Backend arch, key files, tech debt |
| `DB_SCHEMA.md` | db_schema | Connection, schemas, query rules, IBM i quirks |
| `USER_PATTERNS.md` | user_patterns | Quality standards, hard rejections, aesthetic preferences |
| `TEAM_CAPABILITIES.md` | team_capabilities | Agent roster, models, skills, MCPs |
| `PROJECT_STATE.md` | project_state | Current branch, tests, known issues, recent commits |
| `DECISIONS.md` | decisions | ADR records |
| `SESSION_LOG.md` | session_log | Last session handoff context |
| `README.md` | knowledge_readme | KB architecture and protocols |

## When to Run

- After OpenCode Go reset (daily)
- At the start of a new session
- When switching between GMP and Granja projects
- When memory graph seems empty or stale

## Verification

After loading, verify by running `/health --quick` or checking memory_read_graph output.
