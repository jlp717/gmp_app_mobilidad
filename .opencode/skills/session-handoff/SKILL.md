---
name: session-handoff
description: Close a work session with git status, issue tracking, knowledge updates, verification evidence, and a concise user handoff.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  workflow: session-close
---

# Session Handoff Protocol

Cierra una sesiÃ³n de trabajo de forma estandarizada: issues, git, knowledge, verificaciÃ³n.

## CuÃ¡ndo usar

- Al finalizar una sesiÃ³n de trabajo
- Cuando el usuario dice "terminamos", "cierra sesiÃ³n", "hasta luego"
- DespuÃ©s de completar una tarea Tier 2/3

## Protocolo (6 pasos, en orden)

### Paso 1: Verificar estado actual

```bash
git status          # Â¿hay cambios?
git stash list      # Â¿hay stashes?
bd list --status in_progress  # Â¿issues sin terminar?
```

### Paso 2: Crear issues para trabajo pendiente

Para cada tarea no terminada o seguimiento necesario:
```bash
bd create "TÃ­tulo" --type task|bug|chore --priority 1-3
```

Si el proyecto usa beads:
- Tareas completadas â†’ `bd close <id>`
- Tareas en progreso â†’ dejar como `in_progress` con nota de dÃ³nde se quedÃ³
- Nuevos hallazgos â†’ crear issue

### Paso 3: Commit + Push

```bash
git add -A
git commit -m "feat(scope): descripciÃ³n [quality: X%]"
git pull --rebase
git push
git status   # MUST show "up to date" o "nothing to commit"
```

Reglas:
- Conventional Commits SIEMPRE
- Co-authored-by: OpenCode <ai@opencode.ai> SIEMPRE
- NO commitear si tests fallan
- NO force push

### Paso 4: Actualizar knowledge base

Actualizar `.opencode/knowledge/SESSION_LOG.md` con:
- Fecha y hora
- Resumen de lo que se hizo
- Archivos modificados
- Decisiones tomadas
- Estado de los issues
- PrÃ³ximos pasos

Si hubo decisiones arquitectÃ³nicas â†’ aÃ±adir a DECISIONS.md
Si cambiÃ³ el estado del proyecto â†’ actualizar PROJECT_STATE.md

### Paso 5: Limpieza

```bash
git stash drop      # limpiar stales
git branch --merged | %{ git branch -d $_ }  # limpiar branches mergeadas (con -d, no -D)
```

### Paso 6: Resumen al usuario

Formato obligatorio:
```
## âœ… SesiÃ³n completada

**QuÃ© se hizo**: [resumen 1-2 frases]
**Issues**: [creados/cerrados/en-progreso]
**Archivos modificados**: [lista]
**Commits**: [hash(es)]
**Estado**: [tests OK, lint OK, push OK]
**PrÃ³ximos pasos**: [sugerencia]

---
*Handoff completado. Contexto guardado en SESSION_LOG.md*
```

## Anti-patterns

- âŒ Decir "listo" sin verificar git status y tests
- âŒ Hacer commit sin push
- âŒ Omitir SESSION_LOG.md (se pierde contexto entre sesiones)
- âŒ No crear issues para trabajo pendiente (se olvida)
- âŒ Force push (peligroso en ramas compartidas)
