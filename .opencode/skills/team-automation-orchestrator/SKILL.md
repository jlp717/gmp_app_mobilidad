---
name: team-automation-orchestrator
description: Loop autónomo diario del equipo GMP. Encadena readiness, digest, mejora continua, retro y radar con reporte honesto y sin quemar tokens.
---

# Team Automation Orchestrator

Loop autónomo diario que cablea las capacidades ya existentes en una rutina real.
Sin stalls, sin reprocesar todo el repo, sin quemar tokens de proveedor.

## Secuencia diaria (no bloqueante)
1. `readiness-smoke` — preflight barato: proveedores, Cursor, MCP, skills, tools, comandos.
2. `daily-digest-summary` — estado operativo + traza reciente + git status (sin DB2/SSH/Telegram forzado).
3. `continuous-improvement-loop` — errores repetidos, fallback, radar; máx acciones acotado.
4. `retro-auto` — agrupa errores repetidos y genera retro accionable.
5. `tech-radar-fetch` — tendencias relevantes (HN, GitHub, MCP Registry, arXiv).

## Reglas
- Cada paso reporta su salida real; si un paso falla, se registra y se sigue (no aborta el loop).
- No re-ejecutar lo ya cubierto por `hill-climbing-loop` semanal.
- Máx acciones por `continuous-improvement-loop`: 8. Sin auto-instalar nada.

## Reporte
- Guardar resumen en Obsidian (`obsidian-capture`, kind `team`).
- Si hay novedad significativa, `telegram-notify` (level info) con máx 5 acciones.

## Honestidad
Estado final: PASS (todo verde) / WARN (degradación conocida) / BLOCK (fallo crítico de readiness).
Nunca afirmar salud sin evidencia del paso 1.

## Referencias
- tools: readiness-smoke, daily-digest-summary, continuous-improvement-loop, retro-auto, tech-radar-fetch
- .opencode/config/automation-schedule.json (jobs daily-digest, continuous-improvement, tech-radar, retro-on-error)
- skills/pr-zero-trust-gate/SKILL.md (mismo principio zero-trust para PRs)
