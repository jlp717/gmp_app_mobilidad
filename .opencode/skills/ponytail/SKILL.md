---
name: ponytail
description: Senior simplicity gate — YAGNI, stdlib/native first, reuse before new deps, smallest correct diff.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  portable: true
---

# Ponytail (portable)

Criterio senior minimalista para GMP y CI (GitHub `/oc`). Complementa el plugin global en `~/.config/opencode/ponytail` cuando existe.

## Antes de implementar

1. **YAGNI** — ¿Resuelve un requisito real de Javier o del checklist del goal?
2. **Reuse** — ¿Existe codigo, tool o patron en el repo? (`rag-query`, `code-autopilot`)
3. **Stdlib / nativo** — ¿Node `fs`, Dart stdlib, Express built-ins, OpenCode tools nativos?
4. **Menor diff** — Cambio minimo verificable; sin refactors colaterales.
5. **Deuda marcada** — Si acortas a proposito, comentario `ponytail:` con trigger de upgrade.

## En goal-loops

Cada iteracion con cambios de codigo debe pasar Ponytail antes de `tick`:
- No anadir dependencias npm/pub sin justificar en evidence.
- No crear archivos nuevos si basta editar uno existente.
- Preferir tests que demuestren el criterio del goal, no suites genericas.

## En GitHub Actions

El workflow `.github/workflows/opencode.yml` no carga el plugin `file://` de Windows. Esta skill es la fuente portable: aplicar estos criterios en cada respuesta `/oc`.

## Comandos internos

- `/ponytail` — modo full en implementacion
- `/ponytail-review` — solo sobreingenieria en el diff
- `/ponytail-audit` — auditoria de repo (team-curator)
