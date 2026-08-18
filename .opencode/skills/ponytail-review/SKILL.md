---
name: ponytail-review
description: Review diffs for over-engineering only — delete, stdlib, YAGNI, shrink. No bug fixes here.
license: proprietary
compatibility: opencode
---

# Ponytail Review

Revisa **solo** sobreingenieria en el diff actual. No corrijas bugs funcionales aqui.

Checklist: codigo muerto, abstracciones prematuras, dependencia evitable, duplicacion, diff mas grande de lo necesario.

Marca deuda intencional: comentario `ponytail:` con trigger de upgrade.
