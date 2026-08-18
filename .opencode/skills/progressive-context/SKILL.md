---
name: progressive-context
description: >
  Contexto eficiente via Field Guide + indice Obsidian. Usar al cargar memoria.
  Nunca volcar el vault ni AGENTS.md + auditorias de golpe.
---

# Progressive context

Karpathy wiki + presupuesto de atencion.

## Orden

1. `.opencode/memory/FIELD-GUIDE.md` (siempre, corto).
2. `vault/09-index/index.md` — elige 1 seccion.
3. Abre como maximo 3 notas:
   - stack → `vault/02-wiki/entities/gmp-stack.md`
   - deploy → `vault/02-wiki/concepts/deploy-policy.md`
   - db2 → `vault/02-wiki/concepts/db2-access.md`
   - calidad → `vault/02-wiki/concepts/code-quality-contract.md`
   - web nueva → `vault/02-wiki/concepts/greenfield-web.md`
   - vulns → `vault/02-wiki/concepts/vuln-analysis.md`
   - secretos → `vault/02-wiki/concepts/secrets-policy.md`
   - correccion → `vault/04-lessons/corrections/` o `learned.yaml`
4. Codigo: `rg` + Read de archivos reales. RAG no sustituye lectura.
5. Sesion: `.opencode/state/session-events.jsonl` via Context-Manager `getEvents`. No reconstruir desde auditorias.
6. Graphify solo si existe `docs/graphify/GRAPH_REPORT.md` y la tarea es estructural.

## Prohibido

- Cargar AUDIT_STATE + LEDGER + ACI + AGENTS.md + learned.yaml + project-state en cada mensaje.
- Pegar el vault entero.
- Inventar entidades no leidas.

## Escribir al vault

Tras PASS o correccion: una nota con frontmatter (ver `vault/CLAUDE.md`), wikilinks, actualizar indice si es entidad nueva. Inbox si no esta claro el tipo.
