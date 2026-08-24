# FASE 6 — Evaluacion y Observabilidad (5.8 + 5.14)

## Metricas por clase decision (hipotesis a calibrar)
- Sesion: tarea completada? (pass/fail)
- Trayectoria: planifico y ejecuto eficiente? (steps vs optimal)
- Span: cada tool call correcta? (precision tool)
Umbral definido ANTES de medir, calibrado con datos reales, no cifra industria (Confident AI).

## OTEL gen_ai.*
Fijar version conv `gen_ai.*` experimental, aislar nombres tras capa mapeo propia (`lib/core/observability/otel-mapper.js`).
Traza por tarea: herramientas, tokens, coste, errores. Braintrust/Langfuse evaluacion.

## Fallo silencioso
Alerta si agente "exito" tecnico pero resultado incorrecto: evaluacion determinista basada en ejecucion (Sec 5.9) — aplica y comprueba estado final, no LLM judge. Reserva judge para tono/coherencia y calibra vs humano.

## Infra existente
`backend/middleware/prometheus-metrics.js` ya instrumentado. Anadir p50/p95/p99 exposure. k6 para carga (TestGuild 2026).

## Presupuesto notificaciones (Sec 7.6)
3-5 proactivas/dia por persona; agrupar baja prioridad en digest diferido.
