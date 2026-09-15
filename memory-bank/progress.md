# Progress

## Funciona ✅
- Stack completo Flutter+Node+DB2 en producción (PM2 gmp-api :3335)
- Equipo IA: reglas/skills/guardrail/MCP-ledger instalados y verificados (exit codes reales)
- Memory Bank v1 creado
- Backlog de optimización 2026-09-14 **implementado en PRs abiertos** (#3–#40 salvo huecos BLOCKED). Informe: `docs/audits/2026-09-14-optimization-audit/04-execution-report.md`.

## En construcción 🔧
- PRs de optimización **sin merge** (Javier decide orden/rebase sobre `test`, que ya incluye `b23aa20` SEC-06).
- P0-03 baseline de campo, P0-05/SRV-01/SRV-02 en 230, sonda `[túnel]`, DB-01 `spec_approved`, secret `SENTRY_DSN`.
- SEC-03 SKIP hasta rotar PIN.
- SEC-06: código en `origin/test` (`b23aa20`) **sin PR**.
- APP-04: logging listo; causa del 401 refresh espera 48 h de logs.
- Workstream comercial (devoluciones/liquidación) paralelo, no mezclado con PRs de perf.
- Rutero GPS: pendiente activar flag en 230 + test en dispositivo (contexto 2026-08-31).

## Conocidos/issues 🐞
- SEC-06 se commiteó contra `test` por error de HEAD; no revertir/force-push sin Javier.
- Jest y `flutter analyze` de paquetes grandes cuelgan en esta estación (kill + chequeo de fuentes).
- `01-executor-tasks.md` no está en `test` (plan reconstruido desde transcripción).
- web_search tool de Cline sin créditos → usar fetch directo.
- PSReadLine rompe comandos shell multilínea largos → preferir editor / comandos cortos.

## Ideas back-burner 💡
- `-AllSkills` import masivo
- Schedules: health diario 9h L-V, resumen semanal lunes
- Kanban (usage/kanban) para planificación visual si crece el equipo
