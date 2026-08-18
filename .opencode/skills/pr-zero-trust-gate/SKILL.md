---
name: pr-zero-trust-gate
description: Gate de revisión PR independiente zero-trust. Exige maker≠checker, ejecuta verificadores y bloquea merge si hay BLOCK/WARN.
---

# PR Zero-Trust Gate

Gate de revisión independiente a nivel PR. Objetivo: que ningún código se fusione
sin verificación real y separada del autor (maker ≠ checker).

## Regla dura
- El agente que abre/actualiza el PR NO puede ser quien lo verifica.
- Maker nunca se autoevalúa. Secuencia obligatoria: maker → critic → verifier.

## Al abrir o actualizar un PR
1. `Technical-Verifier` — verifica evidencia contra `.opencode/config/quality-rubric.yaml`.
   Debe producir PASS/WARN/BLOCK con evidencia concreta (tests, lint, security, perf, rollback).
2. `Check-Reviewer` — revisa diff buscando N+1, SQL inseguro, async loops, secretos,
   regresión de rendimiento y borde de trust boundary.
3. `elite-quality-gate` — gate determinista sobre los archivos del PR.
   Detecta N+1, SQL inseguro, async loops y patrones frágiles.

## Decisiones
- PASS (sin BLOCK/WARN): permite merge.
- WARN: bloquea merge salvo nota explícita de revisión humana documentada.
- BLOCK: bloquea merge. No se sortea. Se devuelve al maker con causa exacta.

## Registro
- Registrar todo en `handoff-ledger` (operation `record_handoff` + `record_output`)
  con context_packet y specialist_output, graph_id/node_id propagados.
- Citar `verification-loop` y `release-evidence-gate` como contratos de evidencia.

## Reporte honesto
Responder SIEMPRE con veredicto real: PASS / WARN / BLOCK + evidencias + gates pendientes.
Nunca afirmar éxito sin evidencia. Si falta evidencia, el veredicto es BLOCK.

## Referencias
- skills/verification-loop/SKILL.md
- skills/elite-quality-gate (tool elite-quality-gate)
- tools: handoff-ledger, technical-verifier, check-reviewer, truth-teller
- skills/release-evidence-gate/SKILL.md
- .opencode/config/quality-rubric.yaml
