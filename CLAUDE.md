# GMP App Mobilidad — Equipo Agentico Maestro v3.0

> 21 ago 2026 — Implementacion completa del prompt maestro Sec 0-15. Este archivo es la guia viva para Claude Code. Ver `docs/spec/gmp-app-mobilidad.md` (living spec) + `docs/equipo-agentico/README.md` (fases).

## Stack
Flutter 3.24+/Dart, Riverpod, Dio, Node CommonJS+Express, DB2 for i DSN GMP (JAVIER/DSEDAC), PM2 3335 en 192.168.1.230:/opt/gmp-api, ODBC, Redis/KPI, Sentry, Prometheus, Hive offline-first. Ver `pubspec.yaml:1`, `backend/server.js:1`.

## Sustrato ejecucion (5.16 verificado)
Claude Code puro: subagentes `.claude/agents/*.md` + hooks `.claude/hooks/*.sh` + skills `.claude/skills/*/SKILL.md` + `settings.json`. Ver inventario Fase 0 en `docs/equipo-agentico/fase0-auditoria.md`.

## Orquestacion (Sec 6/7)
- **Orquestador** (sesion principal) clasifica `playbook` tiny/explore/build/sweep/secure/prod + `departments[]` y despacha. Workers = tools, nunca ceden conversacion.
- BUILD: `spec EARS -> backend/frontend-engineer (1 writer/worktree) -> fan-out security/performance/test (paralelo) -> code-reviewer -> docs-agent`. Sin PASS no hay hecho (Sec 9 DoD).
- Hooks: `PreToolUse` bloquea secretos/prod, `PostToolUse` formatea, `Stop/SubagentStop` bloquea cierre si tests fallan (pipeline auto-reparable 5.10, max 3 retries).

## Reglas duras gmp
- Lee archivo antes de editar. No scratch en root. No .md innecesarios en root (van a docs/).
- Flutter: `lib/features/<f>/{data,domain,providers,presentation}`, `lib/core/` transversal. Rutero = `rutero_detail_modal.dart` no `albaran_detail_page.dart`. Tabs: `_getNavItems` + `_buildCurrentPage` en `main_shell.dart`.
- Backend: routes validan/delegan, services reglas, repositories/adapters DB2. SQL parametrizado, nunca concat. VISTA_DEUDA_BASE preferida, CPC ROW_NUMBER().
- DB2: verifica QSYS2.SYSTABLES/SYSCOLUMNS antes de usar tabla/columna.
- Deploy whitelist: `git pull origin test` + `pm2 restart gmp-api` (prohibido pm2 save/set/start/reload sin Javi). Health `ssh gmp@192.168.1.230 curl -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready` (runtime-health.yaml:21).
- MCP: revision 2026-07-28 stateless — verificar cada servidor (Sec 5.1).

## Memoria TRACE (5.11)
Captura correccion Javi ("aprende/te corrijo/no vuelvas/recuerda/prefiero" o /teach) -> regla atomica -> compilada a check runtime (PreToolUse exit 2). 57.5% violacion sin TRACE. Ver `skills/tellonce/SKILL.md`.

## Calidad senior (5.5/5.6)
Backend: OpenAPI antes, OWASP API Top 10, HTTPS+HSTS, idempotencia, p95/p99, expand-contract.
Frontend: WCAG 2.2 + axe/Lighthouse por PR + teclado/screen reader, LCP<=2.5s INP<=200ms CLS<=0.1, CSP nonces, ship menos JS.

## Autonomia (Sec 8)
Bajo: auto-aplica (3 retries). Medio: PR sin auto-merge. Alto (migracion/auth/deploy/dinero): detiene, presenta accion cruda (ASI09), espera "adelante". Ver `.claude/config/autonomy-matrix.yaml`.

## Beads
`bd prime` para contexto workflow. Usar bd para tracking, no TodoWrite.

## Modelo (ponytail + Spark 1.2)
Todos los agentes usan `muse-spark-1.2-contributor-free` en esta sesion (instruccion explicita). Coste: planner sol siempre, executor terra solo si riesgo bajo+spec clara, critic nunca mas barato que maker.
