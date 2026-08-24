# SDD Skill — Spec-Driven Development (5.4)

Invocable: `Skill("spec-driven-development")`

## Niveles
- **spec-first**: spec precede a codigo (default para features). Codigo es artefacto mantenido.
- **spec-anchored**: + gobernanza/constitucional + supervision humana antes de merge. Usar si trazabilidad regulatoria, multi-servicio, o IA necesita aprobacion.
- **spec-as-source**: spec es unica verdad, codigo derivado. Assess (ThoughtWorks), riesgo spec excesiva/big bang.

## Notacion EARS
```
WHEN <evento> THE system SHALL <respuesta>
IF <condicion> THEN THE system SHALL <respuesta>
WHILE <estado> THE system SHALL <respuesta>
WHERE <feature> THE system SHALL <respuesta>
```

## Herramientas
- GitHub Spec Kit: `/speckit.specify -> /speckit.implement` (30+ agentes)
- AWS Kiro (IDE nativo SDD)
- Esta skill: plantillas + convenciones + guardrails invocable bajo demanda

## Plantilla spec (usar en `docs/spec/<feature>.md`)
```md
# Feature: <nombre>
## Objetivo
## Criterios EARS (WHEN/IF)
## Arquitectura y contratos (OpenAPI si backend)
## Casos borde
## Dependencias y grafo de impacto (mitiga regresion 70% — 5.4)
## Plan de validacion ejecutable
```

## Regla
Escribe spec completo ANTES de invocar a backend/frontend-engineer. Sin spec, no hay codigo.
