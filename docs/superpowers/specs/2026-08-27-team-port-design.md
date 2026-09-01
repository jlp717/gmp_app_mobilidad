# Team Port V7 — Spec de Diseño (2026-08-27)

**Estado**: aprobado por Javi (4 decisiones + mandato SDD/automático).
**Objetivo**: un solo equipo ("GMP Flow V7"), mismo protocolo en Cline, Claude Code, Codex y OpenCode, con Spec-Driven Development obligatorio y enforcement mecánico (hooks/guardrails/ledger), no prosa.

## Decisiones fijadas
1. **Cline V7 = única fuente de verdad** (.clinerules/ 11 reglas + .cline/skills/ 28 skills + scripts).
2. **Mecanismo completo en los 3 harnesses destino**: ledger MCP + hooks nativos + guardrails, no solo reglas.
3. **Archivar sin borrar**: legado OpenCode (~2GB) y runtime Codex (398 files git) se apartan, nada se destruye.
4. **Gobernanza en git, runtime fuera**: reglas/skills/agentes/hooks/scripts versionados; state/ledgers/backups/secrets ignorados.
5. **SDD obligatorio**: ninguna implementación sin spec EARS aprobada; gate `spec_approved` en ledger antes de MAKER. Adiós vibe coding.
6. **Cross-tool**: AGENTS.md root es el documento canónico que leen Codex, OpenCode, Cursor y Windsurf; Claude/Cline cargan además `.clinerules/`/`.claude/rules/` nativamente.

## A. Kernel compartido (versionado)
- Paths existentes se conservan (menos piezas rotas): `scripts/cline/mcp/graph-ledger.cjs`, `scripts/opencode/mcp/{ibm-odbc-mcp.cjs, gmp-deploy-ssh-mcp.cjs}` se des-gitignorean y corrigen in-place. Nuevo: `scripts/team/sync-harness.cjs` (idempotente: kernel -> targets) y `scripts/cline/verify-team.ps1` v2.
- `.gitignore`: un-ignore `.clinerules/`, `scripts/cline/`, `scripts/opencode/mcp/`, `memory-bank/`; mantener ignorado runtime (`.cline/state|backups|data-runtime`, `.opencode-legacy/`, scratch Codex).
- Fix graph-ledger: `ledger_read` parsea JSON antes de filtrar; `gate_set`/`gate_check` con TTL mecánico (expira `prod_approved` >30min).
- Fix guardrail: protege `backend/config/db.js` + `backend/middleware/auth.js` (reales); SECRET_PATHS ampliado (settings MCP, `*.pem`, `*.key`, CREDENCIALES); `failureMode` documentado honesto.
- Fix reglas: grafo añade lane `bug_loop`; nombre único `/adelante-production`; SWEEP single-writer secuencial; README sin contradicción memory-bank.
- `memory-bank/` versionado (README decía "versionable", gitignore decía no).

## B. Harness: Claude Code
- `CLAUDE.md` podado (<200 líneas, apunta a reglas; cero duplicación).
- `.claude/rules/` <- 11 reglas (frontmatter `paths:` soportado nativo).
- `.claude/agents/` reconstruido: solo frontmatter válido (name/description/tools/model); roles V7 (writers únicos, readers read-only).
- `.claude/skills/` <- 28 skills adaptadas (tool names Claude Code; `use_subagents` -> subagentes nativos).
- Hooks corregidos en `settings.json`: `pipefail` en green-tests (jest fallo bloquea DE VERDAD), node en vez de jq, escaneo contenido secreto (.pem/.key/entropía), validate-prod cubre ALTER/TRUNCATE/DELETE + pm2 start|reload.
- `.mcp.json`: graph-ledger + ibm-db2 (script local ODBC, una sola implementación) + gmp-deploy-ssh + context7; eliminar `claude-flow` colgado; github solo vía `${GITHUB_TOKEN}`.

## C. Harness: Codex
- AGENTS.md root (del kernel) = instrucciones proyecto.
- `.codex/config.toml`: mcp_servers (graph-ledger, ibm-db2, context7) + hooks (schema eventos Claude-like + `commandWindows`) + `approval_policy` explícito.
- `.codex/hooks.json`: shape Windows (PowerShell/node, no `jq|xargs` Unix), guard bd-prime con fallback.
- `git rm --cached` de los ~398 archivos runtime + .gitignore efectivo.

## D. Harness: OpenCode
- `opencode.json` reescrito: `instructions` -> `.clinerules/*.md` + AGENTS.md; skills paths nuevas; plugins = guardrail V7 (`tool.execute.before`) + green-tests + correction-capture; permisos deny `.env/.pem/.key`; MCP github `${env.GITHUB_TOKEN}` (patrón ya correcto, conservar).
- `.opencode/{agents,commands}` regenerados desde V7 (roles + 28 slash commands como markdown).
- Legado -> `.opencode-legacy/` (backups/state/snapshots/logs/node_modules/doom-loops/skills viejas/comandos viejos).

## E. SDD (núcleo)
- Flujo: petición -> classify -> SPEC EARS en `.cline/state/specs/<id>.ears.md` -> gate ledger `spec_approved=PASS` (con evidencia) -> MAKER. Sin gate, writers bloqueados por protocolo (y por guardrail cuando aplique).
- Compatible con Spec Kit/OpenSpec: specs viven en el repo, son el contrato; tests derivan del spec antes del código cuando el playbook lo exija (BUILD/TDD).

## F. Seguridad
- Cero secrets plaintext en cualquier config portada. Rotación del PAT filtrado = acción manual de Javi.
- `CREDENCIALES.md` jamás un-ignored. Configs user-level (~/.claude/settings.json, ~/.codex/config.toml) fuera de alcance; se señalan sus secretos en el informe.

## G. DoD
- `verify-team.ps1` v2: thresholds estrictos, valida frontmatter, paridad, smoke de hooks (jest falla -> hook bloquea), smoke de ledger (TTL expira).
- Cada config target parsea (JSON/TOML) y no contiene secretos.
- Knowledge hub regenerado; informe final con fuentes research (Cursor/SDD/2026).

## H. Fuera de alcance
Prod, DB2 schema, app Flutter, borrados definitivos, configs user-level, commits (los deja listos Javi).
