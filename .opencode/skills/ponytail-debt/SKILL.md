---
name: ponytail-debt
description: Recolecta todos los marcadores ponytail: (ceiling + upgrade) del codebase en un ledger de deuda para trackear atajos diferidos.
---
# Ponytail Debt

## Que recolecta
- Comentarios con marcador: ponytail: ceiling. upgrade: trigger.
- Dart: // ponytail: ... | JS/TS: // ponytail: ... | SQL: -- ponytail: ...

## Flujo
1. Buscar marcadores en el repo (grep ponytail).
2. Generar ledger de deuda (docs/debt/ponytail-ledger.md).
3. Priorizar por trigger (cuando aplicar la mejora).

## Salida
- Ledger actualizado: archivo, ceiling, trigger, estado.
