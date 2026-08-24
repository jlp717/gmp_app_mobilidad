# AGENTS - GMP App Mobilidad - OpenCode v5.0
> 23 ago 2026 - Sustrato real: OpenCode. Fuente: opencode.json + .opencode/. Mapa (<50 lineas). Detalle: .opencode/AGENTS.md + docs/spec/gmp-app-mobilidad.md

## Stack
Flutter 3.24+/Dart (Riverpod/Dio), Node CommonJS+Express, DB2 for i DSN GMP (JAVIER/DSEDAC), PM2 3335 en 192.168.1.230:/opt/gmp-api

## Comandos
npm run test | dart test | dart run build_runner build --delete-conflicting-outputs | opencode run --format json | opencode serve --port 3090

## Reglas duras
- Lee antes de editar. No scratch en root. No md innecesarios en root (van a docs/).
- Rutero: rutero_detail_modal.dart (no albaran_detail_page.dart). Tabs: _getNavItems + _buildCurrentPage en main_shell.dart
- DB2: verifica QSYS2.SYSTABLES/SYSCOLUMNS antes de inventar columna; VISTA_DEUDA_BASE preferida; CPC ROW_NUMBER()
- Deploy: solo git pull origin test + pm2 restart gmp-api. Prohibido pm2 save/set/start/reload y entorno sin Javier
- Health: ssh gmp@192.168.1.230 curl -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready

## Equipo OpenCode
opencode.json + .opencode/agent/*.md (no .claude/). Plugins: .opencode/plugin/*.js (tool.execute.before throw=block). Skills: .opencode/skills/*/SKILL.md (bajo demanda).

## Pipeline
Javier -> Chief (manager) -> decision-router (playbook tiny/explore/build/sweep/secure/prod) -> workers como tools. BUILD: spec EARS -> maker (1 writer) -> Check-Reviewer (diff) -> Technical-Verifier -> code-quality-contract PASS.

## Memoria
Correccion Javier (aprende/te corrijo/no vuelvas) -> correction-capture antes de seguir. Sesion durable: .opencode/state/session-events.jsonl + TEAM_TRACE.jsonl
