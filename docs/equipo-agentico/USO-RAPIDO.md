# USO RÁPIDO — Equipo Agéntico GMP Flow V7

> Guía para Javi. El equipo trabaja en 4 harnesses: **Cline, Claude Code, Codex, OpenCode** (Cursor/Windsurf leen el `AGENTS.md` de la raíz). Todo lo importante es automático: no tienes que configurar nada cada día.

## Qué pasa SOLO al abrir cada harness

| Harness | Reglas | Bloqueos (hooks) | Ledger |
|---|---|---|---|
| Cline | `.clinerules/` carga sola | plugin `gmp-guardrails` | graph-ledger MCP |
| Claude Code | `.claude/rules/` carga sola | `.claude/hooks/` (secretos, prod, tests verdes) | graph-ledger MCP |
| Codex | `AGENTS.md` raíz + `.codex/` | `.codex/hooks.json` | graph-ledger MCP |
| OpenCode | `opencode.json` apunta a `.clinerules/` | `.opencode/plugins/` | graph-ledger MCP |

Nadie puede: tocar `backend/config/db.js` ni `backend/middleware/auth.js`, leer/escribir `.env*`, `.pem`, `.key`, `CREDENCIALES.md`, hacer `pm2 save/set/start/reload`, ni DDL en producción.

## Tu día a día: solo habla normal

No necesitas comandos. El equipo clasifica lo que pides y arranca el flujo correcto:

- «arregla esto que falla» → bucle de bug (reproducir → fix → tests, máx. 3 ciclos)
- «quiero una pantalla que...» → **SDD obligatorio**: el equipo escribe primero una **spec EARS** (`.cline/state/specs/`), te la enseña, y SOLO cuando la apruebas escribe código. Adiós al vibe coding.
- «revísalo» → revisión adversarial (seguridad + rendimiento + tests)
- «sube a producción» → cadena completa y se DETIENE esperando tu `/adelante-production` (válido 30 min)

Comandos opcionales útiles: `/chief`, `/health-check`, `/adelante-production`.

## Lo automático (3 tareas programadas — registrar UNA sola vez)

Abre PowerShell y ejecuta una vez:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\team\register-scheduled.ps1
```

También una vez, los hooks de git (bloquean commits con secretos):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\team\install-git-hooks.ps1
```

Con eso queda programado:

| Tarea | Cuándo | Qué hace |
|---|---|---|
| `GMP-Daily-Health` | laborables 09:03 | chequeo de salud → `logs/ai-daily.log` |
| `GMP-Knowledge-Refresh` | lunes 09:33 | regenera catálogos `.cline/knowledge/` |
| `GMP-Team-Verify` | lunes 10:03 | verifica el equipo → `logs/ai-verify.log` |

Comprobar: `schtasks /Query /TN "GMP-Daily-Health"`.

Al abrir Claude Code además corre `scripts/team/session-start.cjs`: avisa si el knowledge hub está viejo (>7 días), si `gates.json` está roto, y te recuerda la regla SDD.

## Si algo falla

- **Verificación completa**: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cline\verify-team.ps1`
- **Salud diaria**: mira `logs/ai-daily.log` (últimas líneas).
- **Sincronizar reglas/skills entre harnesses**: `node scripts/team/sync-harness.cjs` (con `--check` solo avisa del drift).
- **Catálogos viejos**: `node scripts/cline/gen-knowledge.cjs`.

## Seguridad — 2 acciones tuyas

1. **Rota el PAT de GitHub que quedó expuesto** en `.cline/data-runtime/cline_mcp_settings.json`: GitHub → Settings → Developer settings → Personal access tokens → borra el filtrado y crea uno nuevo; luego actualízalo en los settings MCP y en la variable de entorno `GITHUB_TOKEN`. Ninguna config portada lo copia.
2. **Nunca commitees secretos**: el hook pre-commit ya lo bloquea si ejecutaste `install-git-hooks.ps1`, pero no confíes — revisa siempre el diff antes de `git commit`.
