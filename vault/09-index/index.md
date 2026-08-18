# 09-Index — Master Index

> [!index] Vault Master Index
> Entry point for AI agents. One-line description of every major section.

## V6 query order (obligatorio)

1. `.opencode/memory/FIELD-GUIDE.md` — ya cargado. No lo relengas.
2. Este indice — elige **una** seccion.
3. Abre como maximo **3** notas. Nunca el vault entero.
4. Sesion: `.opencode/state/session-events.jsonl` si hay tarea en curso.

| Si la tarea es... | Abre |
|---|---|
| Stack / Flutter / Node | [[gmp-stack]] |
| Subir a servidor / PM2 | [[deploy-policy]] |
| SQL / tablas / objetivos | [[db2-access]] |
| Cerrar un diff | [[code-quality-contract]] |
| Web desde cero | [[greenfield-web]] |
| Vulns / AppSec | [[vuln-analysis]] |
| Secretos / vault | [[secrets-policy]] |
| Cualquier tipo de pedido | `.opencode/config/capability-catalog.yaml` |

## Quick Navigation

| Section | Purpose | Key Files |
|---------|---------|-----------|
| [00-inbox/](00-inbox/) | Unprocessed captures | — |
| [01-sources/](01-sources/) | Immutable raw sources | articles/, papers/, transcripts/ |
| [02-wiki/](02-wiki/) | LLM-generated knowledge | entities/, concepts/, projects/ |
| [03-decisions/](03-decisions/) | Decisions | adr/, product/ |
| [04-lessons/](04-lessons/) | Learned lessons | errors/, corrections/ |
| [05-daily/](05-daily/) | Session logs | YYYY-MM-DD.md |
| [06-areas/](06-areas/) | Ongoing responsibilities | backend/, flutter/, db2/, devops/ |
| [07-archive/](07-archive/) | Completed projects | — |
| [08-templates/](08-templates/) | Note templates | 6 templates |
| [09-index/](09-index/) | Maps of Content | this file + 3 maps |
| [10-canvas/](10-canvas/) | Visual knowledge maps | — |

## Query Patterns

### Find a decision
1. Check `03-decisions/adr/` for architecture decisions
2. Check `03-decisions/product/` for product decisions
3. Use `wiki-query` skill for natural language search

### Find a lesson
1. Check `04-lessons/errors/` for error patterns
2. Check `04-lessons/corrections/` for Javier's corrections (highest priority)

### Find an entity
1. Check `02-wiki/entities/` for people, systems, concepts
2. Use graph view for connections

## Vault Health
- Total pages: <!-- count -->
- Orphan pages: <!-- count -->
- Broken links: <!-- count -->
- Last updated: 2026-08-15
