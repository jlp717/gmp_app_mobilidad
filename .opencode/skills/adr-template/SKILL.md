---
name: adr-template
description: Architecture Decision Record template. Document significant technical decisions with context, options, decision, consequences.
---

# Skill: adr-template — Architecture Decision Records

ADRs son documentos cortos que registran decisiones arquitectónicas significativas. Permiten que el equipo entienda QUÉ se decidió y POR QUÉ, evitando re-litigation años después.

## Cuándo crear un ADR

✓ Decisiones que afectan estructura del sistema
✓ Trade-offs no obvios
✓ Choices entre tecnologías (Postgres vs MongoDB, REST vs GraphQL)
✓ Migraciones grandes
✓ Decisiones que el "futuro tú" se preguntará "¿por qué hicimos X?"

✗ Decisiones triviales (naming convention)
✗ Implementación de una feature simple
✗ Bugfixes

## Ubicación

`<repo>/docs/adr/NNNN-titulo-kebab.md`

Numerar secuencial (0001, 0002, ...). NO reusar números.

## Template

```markdown
# NNNN. [Title corto y específico]

Date: YYYY-MM-DD
Status: [Proposed | Accepted | Deprecated | Superseded by ADR-XXXX]
Authors: @autor1, @autor2

## Context

[Por qué estamos tomando esta decisión ahora.
- ¿Qué problema resolvemos?
- ¿Qué fuerzas (técnicas, de negocio, de equipo) estamos balanceando?
- ¿Qué constraints tenemos?
- 3-5 párrafos]

## Decision

[Qué decidimos. Una frase clara seguida de detalles si necesario.

Por ejemplo: "Usaremos PostgreSQL como base de datos primaria, con
pgvector para búsqueda semántica, en lugar de Postgres + Pinecone separados."]

## Options considered

### Option A: [Nombre]
- Pros: [lista]
- Cons: [lista]
- Estimación esfuerzo: [Sm/Md/Lg]
- Riesgo: [bajo/medio/alto]

### Option B: [Nombre]
- Pros: [lista]
- Cons: [lista]
- Estimación esfuerzo: [Sm/Md/Lg]
- Riesgo: [bajo/medio/alto]

### Option C: [Nombre]
[idem]

## Consequences

### Positive
- [Qué mejora con esta decisión]

### Negative
- [Qué se hace más difícil]
- [Trade-offs aceptados]

### Risks
- [Cosas que podrían salir mal]
- [Mitigaciones planeadas]

## Validation

Cómo sabemos que esta decisión fue correcta:
- [Métrica X medible en N meses]
- [Outcome Y observable]

## References

- [Link a research / benchmarks]
- [Issue #XXX]
- [PR #YYY]
```

## Lifecycle

1. **Proposed**: ADR escrito, en review por equipo
2. **Accepted**: equipo acepta, se implementa
3. **Deprecated**: ya no aplica (sin reemplazo)
4. **Superseded**: reemplazado por ADR-NNNN (link al nuevo)

NUNCA editar un ADR Accepted. Si la decisión cambia, crear ADR nuevo que supersede el anterior.

## Ejemplo real (gmp_app_mobilidad ficticio)

```markdown
# 0007. Use Riverpod 2.x with code generation, not 1.x ChangeNotifier

Date: 2026-03-15
Status: Accepted
Authors: @flutter-architect, @oracle

## Context

App tiene 80 providers, 35 con autoDispose, varios con timers. Provider 1.x
con ChangeNotifier requiere boilerplate manual + manual dispose, causa
memory leaks recurrentes (3 P1 bugs últimos 6 meses).

Riverpod 2.x con `@riverpod` annotation auto-genera providers, soporta
codegen, mejor type safety, syntax más limpia.

## Decision

Migrar a Riverpod 2.x con riverpod_generator. Mantener compatibilidad
durante migración gradual (3 sprints).

## Options considered

### A: Quedarnos en Provider 1.x
- Pros: cero migración. Devs ya conocen.
- Cons: deuda crece, leaks continúan, syntax verbosa.
- Esfuerzo: 0
- Riesgo: alto (techdebt cumulative)

### B: Migrar a Riverpod 2.x con codegen
- Pros: type-safe, menos boilerplate, ecosystem moderno
- Cons: 3 sprints migración, devs aprenden patterns nuevos
- Esfuerzo: Lg
- Riesgo: medio (gestionable con plan fasing)

### C: Migrar a BLoC
- Pros: arquitectura más estricta
- Cons: mucho más verbose, equipo no familiarizado, no resuelve problema raíz
- Esfuerzo: XL
- Riesgo: alto

## Consequences

### Positive
- Auto-dispose correcto reduce memory leaks
- Codegen elimina boilerplate
- Pattern matching en consumers más limpio

### Negative
- 3 sprints de migración
- Devs deben aprender `@riverpod` annotation patterns
- Mixed codebase durante migración

### Risks
- Migración fásica puede dejar features en estado mixto >planeado
- → Mitigación: deadline duro 3 sprints, weekly progress review

## Validation

- 0 P1 memory leak bugs en 6 meses post-migración
- Build runner times <30s
- Code review tiempo medio en providers reduce >30%
```

## Standards

- ADR <500 palabras (conciso)
- Una decisión por ADR
- Numerados sequencialmente
- Status visible al inicio
- Date inmutable
- En git, mismo repo del proyecto

## Coordinación

- Cuando @oracle toma decisión Tier 3 → ADR obligatorio
- @writer puede ayudar a redactar
- @planner referencia ADRs en roadmap

## Cuándo NO hacer ADR
- Cambio reversible sin coste
- Implementation detail dentro de patrón ya decidido
- Bugfix
- Refactor sin cambio de approach
