# H/I/J — Gobernanza, spec-code, audit trail

## H — Gobernanza reconstrucción (Sec 4)
Cada eliminación Fase 0 registrada en `fase0-auditoria.md:18` tabla Conserva/Refactoriza/Destruye/Crea con qué hacía, por qué, qué reemplaza. Decisión de bloque presentada en ese doc antes de ejecutar (Sec 4 exigencia). No se ejecutó `rm -rf` sin trazar.

## I — Spec-code sincronía (5.4)
Última feature en sesión: equipo agéntico mismo (esta entrega). Verificación: `docs/spec/gmp-app-mobilidad.md:1` actualizado con cabecera Sec 12 y arquitectura capas; comparar con `CLAUDE.md:1` y `AGENTS.md:1` — coinciden. No fiarse de informe: abrir archivo y diff.

Para próxima feature, `docs-agent.md:12` obliga update `docs/spec/<feature>.md` + README + ADR en mismo ciclo.

## J — Audit trail 12 campos (5.15, datos regulados financieros/GDPR) + HITL

Esquema implementado (parcial, ejemplo real pendiente):

Field list (EU AI Act 02-08-2026 + GDPR Art22 + DORA): timestamp UTC, decision_id, human_id, system_id+version, model_id+version, inputs+procedencia, factors, output, confidence, human_override_history, retention_period.

Ejemplo real HITL: `backend/routes/cobros.js` (si existe) debe tener `await requireApproval('adelante')` antes de `INSERT INTO JAVIER.CVC` cuando `amount > threshold`. Evidencia actual: patrón documentado en `compliance-agent.md:22` pero no verificado contra archivo vivo cobranza — estado: ❌ esquema en config, falta registro vivo 12 campos en log. Próximo PR debe crear `backend/logs/audit-trail.jsonl:1` con ejemplo.

HITL financiero: `release-agent` y `backend-engineer` escalan a humano si `risk Alto` (autonomy-matrix.yaml:15 `presenta accion_cruda`). Caso real pendiente demostrar con feature que toque cobro.

