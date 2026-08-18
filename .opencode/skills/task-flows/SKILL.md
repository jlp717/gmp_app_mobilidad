---
name: task-flows
description: Meta-flujo del equipo: 30 flujos parametrizados por tipo de tarea (backend, db2, flutter, ui_ux, qa, seguridad, sre, datos, arquitectura, investigacion, docs, negocio, demo_mock, produccion_contrato, analisis_frio, refactor, bugfix, migracion, cache, rendimiento, monitoreo, accesibilidad, i18n, terceros, auth_pagos, testing, deuda, onboarding, handoff, incidentes, CI/CD, E2E, goal_loop). El Chief selecciona el flujo segun la intencion real.
---
# Task Flows (Meta-sistema 30 flujos)

## Principio
Toda peticion tiene un FLUJO que la convalida. El Chief: interpreta intencion, selecciona flujo del pilar, ejecuta con artefactos minimos, verifica con gates.

## Flujos (detalle en .opencode/config/task-flows.yaml)

### Producto y negocio (estrategia corregida 2026-08-12)
- validacion_mercado: entrevistar compradores del nicho (15 conv, 5 demos, filtro 8 semanas) ANTES de construir.
- demo_recorrido: solo el recorrido comercial decisivo, etiquetado DEMO-datos simulados, spikes tecnicos.
- contrato_seguro: SOW cerrado + anticipo 30-40% cobrado + PI/RGPD/SLA.
- desarrollo_sprints: entregas cada 1-2 semanas, cobro por hitos, aceptacion documentada.
- mantenimiento: soporte separado y obligatorio (ingreso recurrente).
- core_comun: auth/contratos/observabilidad/despliegue reutilizables; reglas de negocio aisladas.
- analisis_frio: business-critic evalua con evidencia (VIABLE/RIESGOSO/NO-VIABLE).

### Construccion
- backend, db2, flutter, ui_ux, datos, arquitectura.
- refactor: simplificar sin romper (Simplify-Reviewer + ponytail).
- bugfix_depuracion: root cause + fix minimo + test regresion (systematic-debugging).
- integracion_terceros: APIs externas con timeout/retry/validacion.
- auth_pagos: auth segura + pagos con idempotencia + webhooks verificados.
- migracion_datos: migracion incremental con rollback e idempotencia.

### Calidad y operacion
- qa, testing_estrategia (piramide + mutation), e2e_browser (Playwright).
- seguridad, rendimiento (P95<500ms), cache_redis, accesibilidad, i18n.
- monitoreo_alertas (SLOs), incidentes (SEV1/2/3 + postmortem), cicd_despliegue (staging-first).
- deuda_tecnica (ponytail-debt), onboarding_repo, handoff_sesion, goal_loop.

## Reglas
- Seleccionar flujo segun intencion real (no plantilla fija).
- Artefactos minimos necesarios: nunca por rellenar.
- Cada flujo termina con gates: elite-quality-gate, handoff-ledger, evidencia.
- Tareas multi-pilar: flujos en paralelo con workstreams disjuntos.
