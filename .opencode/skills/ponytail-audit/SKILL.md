---
name: ponytail-audit
description: Auditoria de deuda tecnica: detecta bloat, dependencias evitables y complejidad innecesaria en el repo. Read-only, propone acciones.
---
# Ponytail Audit

## Que busca
- Dependencias nuevas que podrian ser stdlib/nativo.
- Abstracciones con una sola implementacion (YAGNI).
- Config para valores que nunca cambian.
- Archivos grandes (>1800 lineas) sin plan de split.
- Codigo duplicado (reutilizar/refactorizar).

## Flujo
1. Inventario de dependencias (package.json / pubspec).
2. Buscar duplicacion (grep/rag).
3. Marcar hallazgos con severidad y accion.
4. Proponer, no editar (read-only; cambios requieren plan aprobado).

## Salida
- Lista priorizada: archivo, hallazgo, severidad, accion.
