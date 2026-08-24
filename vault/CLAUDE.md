---
type: meta
status: active
summary: Vault maintenance schema and rules for AI agents
tags: [meta, schema, vault]
created: 2026-08-10
updated: 2026-08-10
---

# Vault Schema & Maintenance Guide

This document defines the rules AI agents must follow when creating, editing, or maintaining notes in this Obsidian vault.

## Purpose

This vault implements the **Karpathy LLM Wiki Pattern**: AI-generated, self-contained knowledge pages optimized for AI consumption first, human readability second. It follows **Synapse PKM principles**: every note must have clear connections, a single type, and an explicit status.

## Vault Architecture

```
vault/
├── 00-inbox/          Captures awaiting triage
├── 01-sources/        Immutable raw material
├── 02-wiki/           LLM-generated knowledge (PRIMARY)
├── 03-decisions/      Binding choices with rationale
├── 04-lessons/        Errors and corrections
├── 05-daily/          Session logs
├── 06-areas/          Ongoing responsibility domains
├── 07-archive/        Completed/superseded
├── 08-templates/      Note templates
├── 09-index/          Maps of Content
└── 10-canvas/         Visual maps
```

## File Naming Conventions

| Content Type | Pattern | Example |
|-------------|---------|---------|
| Source | `YYYY-MM-DD-<slug>.md` | `2026-08-10-flutter-riverpod-3-release.md` |
| Decision | `YYYY-MM-DD-<slug>.md` | `2026-08-10-offline-sync-strategy.md` |
| ADR | `NNNN-<slug>.md` | `0004-riverpod-migration.md` |
| Lesson | `YYYY-MM-DD-<slug>.md` | `2026-08-10-db2-connection-pool-exhaustion.md` |
| Daily | `YYYY-MM-DD.md` | `2026-08-10.md` |
| Entity | `<slug>.md` | `gmp-api.md` |
| Concept | `<slug>.md` | `offline-first.md` |

## Frontmatter Requirements

Every note MUST have valid YAML frontmatter with at minimum:

```yaml
---
type: source|wiki|decision|lesson|adr|daily|entity|concept|area|archived|template|index
status: active|draft|accepted|superseded|deprecated|planned|resolved|wontfix|archived
summary: One-line description of this note's content and purpose
tags: [domain-tag-1, domain-tag-2]
---
```

### Type-Specific Required Fields

| Type | Additional Required Fields |
|------|---------------------------|
| `source` | source-type, title, author, url, date-published |
| `decision` | decision-date, deciders, domain |
| `adr` | adr-number, date, deciders, domain |
| `lesson` | severity, source, date-learned |
| `daily` | date, session-id, agents-involved |
| `entity` | entity-type, owner |
| `area` | owner, last-reviewed |

## Linking Rules

1. **Use Wikilinks for all internal references**: `[[page-name]]` — never raw Markdown links for internal pages
2. **Use full names on first reference**: "DB2/AS400 server at 192.168.1.22" not "the database"
3. **Link related pages**: every page must have at least one `[[link]]` to another vault page
4. **No orphan pages**: if a page has zero inbound links, add relevant links from other pages
5. **Use sections for deep links**: `[[page-name#section-heading]]`

## Self-Containment Rule (Karpathy Pattern)

Every `02-wiki/` page MUST be readable and useful without following any links. The first paragraph must provide:
- What the entity/concept IS
- Why it matters to GMP App Mobilidad
- Key identifying details (URLs, versions, IPs, ports)

Pronouns are forbidden on first reference. Use full names: "The GMP backend API at 192.168.1.230:3335" not "it."

## Ingest Workflow

When new material enters the vault:

1. **Capture** → drop raw note in `00-inbox/`
2. **Classify** → determine type (source, lesson, decision, entity, concept)
3. **Template** → copy appropriate template from `08-templates/`
4. **Route** → move to correct folder
5. **Frontmatter** → fill in all required YAML fields
6. **Link** → add wikilinks to related existing pages
7. **Cross-link** → add backlinks from related pages to this new note
8. **Index** → update relevant map in `09-index/`

## Lint Rules

AI agents must verify before claiming completion:

- [ ] Valid YAML frontmatter with all required fields
- [ ] At least one outbound wikilink (`[[...]]`)
- [ ] First paragraph is self-contained
- [ ] No pronouns on first reference to an entity
- [ ] File naming matches the pattern for its type
- [ ] File is in the correct folder for its type
- [ ] Date fields use ISO format (YYYY-MM-DD)
- [ ] Tags include at least one domain-specific tag

## Query Patterns

### Find all active blockers before implementing:
```dataview
TABLE summary, severity, date-learned
FROM "04-lessons"
WHERE severity = "blocker" AND status = "active"
SORT date-learned DESC
```

### Find binding architecture decisions:
```dataview
TABLE summary, decision-date
FROM "03-decisions/adr"
WHERE status = "accepted"
SORT decision-date DESC
```

### Find orphan pages (no backlinks):
```dataview
TABLE file.folder, file.name
WHERE length(file.inlinks) = 0
AND file.name != "index"
SORT file.name ASC
```

### Find stale pages (not updated in 90+ days):
```dataview
TABLE updated, file.name
WHERE date(updated) < date(now) - dur(90 days)
AND status = "active"
SORT updated ASC
```

### Find Javier corrections:
```dataview
TABLE summary, date-learned
FROM "04-lessons/corrections"
WHERE source = "correction"
SORT date-learned DESC
```

## Vault Health Metrics

Target state:
- **Orphan rate**: < 10% (pages with zero backlinks)
- **Broken links**: 0 (use Obsidian's broken links panel)
- **Missing frontmatter**: 0
- **Stale active pages**: < 20% (not updated in 90+ days)
- **Inbox backlog**: < 5 notes older than 7 days

## AI Agent Responsibilities

| Agent | Vault Responsibility |
|-------|---------------------|
| Chief Engineer | Ensures vault is updated after each session |
| Prompt-Optimizer | Suggests new wiki pages from session context |
| Code-Autopilot | Creates lesson notes for bugs found and fixed |
| SRE-Engineer | Updates `06-areas/devops/` and area health pages |
| Architect-Planner | Maintains ADRs in `03-decisions/adr/` |
| Context-Manager | Runs vault health checks weekly |

## What NOT to Do

- Do NOT create notes in the vault root — always use the correct folder
- Do NOT edit `01-sources/` content after creation (immutable)
- Do NOT use Markdown links `[text](url)` for internal references — always wikilinks
- Do NOT create pages without frontmatter
- Do NOT leave pages without any outbound links
- Do NOT create duplicate pages — search first with `grep` or Obsidian search
- Do NOT use pronouns (it, they, this, that) for entities on first reference
