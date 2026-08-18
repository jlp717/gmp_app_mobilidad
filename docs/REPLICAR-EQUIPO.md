# REPLICAR EQUIPO - Guia de Bootstrap para Apps Nuevas

> Documento operativo: replica el equipo completo de desarrollo senior en cualquier repo/carpeta nueva.
> Actualizado: 2026-08-12. Fuente original: gmp_app_mobilidad.

## 1. QUE ES ESTO

Un harness OpenCode completo (equipo senior de desarrollo) que se copia a cualquier proyecto nuevo:
- 43 agentes especializados (backend, DB2, Flutter, UI, QA, seguridad, SRE, producto, critico, business-critic)
- 190 skills propias + catalogo ECC (280 skills npm) disponibles
- 30 flujos de trabajo por tipo de tarea
- 16 pasos de pipeline (interpretar - disenar - ejecutar - TDD - verificar - metricas)
- 108 reglas deterministas de calidad/seguridad/arquitectura
- 17 plugins de hooks + 13 automatizaciones
- Capacidad de construir apps completas: demo mockeada - validacion - produccion real (backend, DB, pagos, dominio, internet)

## 2. METODO RAPIDO (recomendado)

### Opcion A - Doble clic (Windows)
1. Crear la carpeta/repo nuevo.
2. Copiar Iniciar_Equipo.cmd dentro (o ejecutarlo desde la fuente).
3. Doble clic: detecta si hay harness; si no, lo bootstrapea desde la fuente y arranca OpenCode Web.

### Opcion B - Script directo

    node <ruta>/scripts/opencode/bootstrap-team.mjs <repo-destino>

### Opcion C - Desde el Chief (dentro de OpenCode)
- Hablar: /port-team <destino>

## 3. QUE SE COPIA

- .opencode/ completo: config/ (55+), agents/ (43), skills/ (150) + skills-ecc/ (39), plugins/ (17), tools/, scripts/, rules.json (108 reglas), fallback-models.json (45 agents), memoria base (correcciones/lecciones/patrones).
- opencode.json (20 plugins, 63 commands, 16 MCPs, skills paths).
- AGENTS.md (reglas raiz del proyecto).
- docs/agent-compliance-matrix.md + docs/REPLICAR-EQUIPO.md + docs/ESTRATEGIA-NEGOCIO.md + docs/ESTRATEGIA-MERCADO.md.

## 4. QUE NO SE COPIA (estado local)

- state/, backups/, metrics/, sandbox/, TEAM_TRACE.jsonl, tokens.jsonl, same-error-tracker.jsonl.
- Informes/certificaciones puntuales del repo fuente.

## 5. VERIFICACION POST-COPY (obligatoria)

    cd <repo-nuevo>
    node -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8')); console.log('JSON OK')"
    node -e "JSON.parse(require('fs').readFileSync('.opencode/rules.json','utf8')); console.log('RULES OK')"
    ls .opencode/config | wc -l        # esperado 55+
    ls .opencode/agents/*.md | wc -l   # esperado 43
    ls .opencode/skills | wc -l        # esperado 150+
    ls .opencode/plugins/*.ts | wc -l  # esperado 17

- Arrancar OpenCode Web y ejecutar: /readiness, /quality, /models, /route-eval.
- Auditorias: agent-roster-audit, model-assignment-audit, workflow-state-audit, elite-quality-gate.

## 6. AJUSTES POR PROYECTO (despues del copy)

1. opencode.json: ajustar model/small_model y providers si el stack difiere.
2. .opencode/config/apps.yaml: registrar la nueva app (stack, spec, servers).
3. docs/spec/<app>.md: crear la living-spec del proyecto (o pedir /spec).
4. docs/design/: se genera por feature UI (design.md, funcionalidades.md, contenido.md).
5. Modelos: mantener openai/gpt-5.5 para criticos, deepseek-v4-flash para lectura (model-routing).

## 7. HOOKS ACTIVOS (plugins .opencode/plugins/*.ts)

- anti-doom-loop, anti-hallucination-guard, context-compaction, env-protection, execution-visibility,
  flow-observability, goal-loop-idle-hint, mobile-mode-detector, model-fallback-forward,
  production-safety-guard, rate-limit-handler, same-error-detector, session-lifecycle,
  session-resilience, task-metrics, task-tracer, user-correction-capture, ecc-hooks, ecc-tools.

## 8. AUTOMATIZACIONES (automation-schedule.json, 13 jobs)

- tech_radar (24h), github_watchlist (12h), mcp_tool_miner (48h), model_catalog, model_update_proposer,
  daily_digest, team_curator, morning_briefing, state_cleanup, memory_garbage_collector,
  hill_climbing_loop, benchmark_weekly (168h), harness_evolution_check (24h).

## 9. FLUJOS DISPONIBLES (task-flows.yaml, 30)

Construccion: backend, db2, flutter, ui_ux, datos, arquitectura, refactor, bugfix, migracion_datos,
integracion_terceros, auth_pagos, demo_mock, produccion_contrato.
Calidad/ops: qa, testing_estrategia, e2e_browser, seguridad, rendimiento, cache_redis, accesibilidad,
i18n, monitoreo_alertas, incidentes, cicd_despliegue, deuda_tecnica.
Producto/equipo: negocio, analisis_frio, investigacion, docs, onboarding_repo, handoff_sesion, goal_loop.

## 10. CAPACIDADES DEL EQUIPO (lo que resuelve)

- Apps moviles (Flutter), webs (NextJS/shadcn), APIs (Node/Express), DB2/AS400.
- Demo mockeada completa - validacion - produccion real (backend, DB, pagos, dominio, SSL, internet).
- Refactors, migraciones, auditorias, optimizacion, seguridad, accesibilidad, i18n, monitoreo.
- Analisis frio de negocio (business-critic) antes de decidir.
- Compresion de contexto (headroom) para sesiones largas.

## 11. REGLA DE ORO

TODO repo nuevo de Javier debe bootstrap del harness (correccion NEGOCIO_DEMO_MOCK_PRIMERO_PORTABLE).
Cualquier peticion - flujo del pilar - arquitectura-first - TDD - gates - evidencia.
