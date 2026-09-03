# AGENTS.md — GMP Flow V7 · Documento canónico cross-tool

> Este archivo es el kernel compartido del equipo **GMP Flow V7**. Lo leen Codex, OpenCode, Cursor, Windsurf, Cline y Claude Code (AGENTS.md es estándar abierto: el archivo más cercano al directorio de trabajo gana; los nested se fusionan con este). Detalle completo de reglas: `.clinerules/` (11 reglas) y skills `.cline/skills/` (28). CERO secretos en este repo: credenciales solo por referencia de entorno.

## 1. Identidad

Repo `gmp_app_mobilidad`: app de movilidad comercial GMP (pedidos, reparto, rutero, comisiones, cobros). Un solo equipo agentico, mismo protocolo en todos los harnesses: orquestación por GRAFO con gates firmados en ledger (engineering con estados, no iteración de prompts), Spec-Driven Development obligatorio y enforcement mecánico (hooks/guardrails), no solo prosa.

- Orquestador: clasifica playbook + departamentos y despacha; los workers son tools y nunca ceden la conversación.
- Idioma con Javier: español. Máximo UNA pregunta aclaratoria antes de actuar; si es razonable decidir tú, decide y documenta.
- Fuente viva del diseño: `docs/superpowers/specs/2026-08-27-team-port-design.md` + `docs/spec/gmp-app-mobilidad.md`.

## 2. Stack GMP

| Capa | Tecnología |
|---|---|
| Frontend | Flutter 3.24+/Dart, Riverpod, Dio, Hive offline-first |
| Backend | Node CommonJS + Express (`backend/`), rutas validan/delegan, services reglas, repositories/adapters DB2 |
| Base de datos | DB2 for i, DSN `GMP`, schemas JAVIER/DSEDAC (acceso vía ODBC) |
| Producción | PM2 `gmp-api` puerto 3335 en 192.168.1.230:/opt/gmp-api |
| Observabilidad | Redis/KPI, Sentry, Prometheus; health endpoint `/api/ready` |

Estructura Flutter: `lib/features/<f>/{data,domain,providers,presentation}`, `lib/core/` transversal. Tabs en `lib/features/dashboard/presentation/pages/main_shell.dart` (`_getNavItems` + `_buildCurrentPage` deben ir sincronizados).

## 3. Comandos de build/test

```
backend:  npm test            # jest (backend/tests), exit code real es el gate
flutter:  flutter analyze     # sin errors; dart test para unidad
          dart run build_runner build --delete-conflicting-outputs
auditoría equipo: node scripts/team/sync-harness.cjs --check   # drift kernel -> harness
```

## 4. Grafo de playbooks (resumen)

Clasifica TODO pedido antes de actuar y anuncia una línea: `PLAYBOOK=<id> - budget=<turns> - nodos=[secuencia]`.

| Playbook | Uso | Writers | Budget (turnos) | Nodos |
|---|---|---|---|---|
| TINY | typo/pregunta/corrección | 0-1 | 8 | INTAKE-FIX-CLOSE |
| EXPLORE | mapear repo/logs readonly | 0 | 20 (research 25) | INTAKE-FANOUT-SINTESIS |
| BUILD | feature/bug/pantalla nueva | 1 maker | 40 | SPEC-MAKER-VERIFY-REVIEW-SHIP |
| bug_loop | bugs hasta verde | 1 | 40, máx 3 ciclos | REPRO-FIX-TEST → CLOSE \| FIX_DIRECT/TINY \| BUILD |
| SWEEP | migración o 50+ ficheros | 1 writer secuencial por slice | 50 | PLAN-SLICES-INTEGRATE |
| SECURE | XSS/SQL/secretos/OWASP | 1 (reviewer no escribe) | 30 | SCAN-FINDINGS-PATCH |
| PROD | deploy/PM2/ALTER/secreto | SRE cero autonomía | 15 | CHAIN-INTERRUPT-DEPLOY-POST |

Reglas de orquestación: un solo writer concurrente para código; subagentes EXPLORE son solo-lectura (jamás escriben); evaluator-optimizer máx 3 iteraciones VERIFY⇄MAKER; tercera caída = BLOCKED formal (`BLOCKER·CAUSA·REQUIERE`), nunca rizar el prompt. Detalle: `.clinerules/05-playbooks-v6.md` y `.clinerules/30-orquestador-grafo.md`.

Gates = aristas condicionales firmadas en el MCP `graph-ledger` (`scripts/cline/mcp/graph-ledger.cjs`): `ledger_append` (eventos de fase), `gate_set` (con `ttl_minutes` opcional), `gate_check` (devuelve `expired=true`/`value=null` si el TTL venció), `ledger_read` (reentrada tras compactar contexto).

## 5. Invariables core (no negociables)

1. **Lee antes de editar**: ningún cambio sin haber leído el fichero real esta sesión; rutas absolutas en herramientas de archivo.
2. **SQL SIEMPRE parametrizado** (binding), nunca concatenado; routes validan input; N+1 = BLOCK.
3. **Single-writer**: solo un agente escribe código a la vez.
4. **UI vivo del rutero/repartidor = `rutero_detail_modal.dart`** (bottom sheet desde `repartidor_rutero_page.dart`). `albaran_detail_page.dart` es UI MUERTA: jamás editarla para bugs de entregas (el guardrail bloquea su edición).
5. **Intocables**: `backend/config/db.js` y `backend/middleware/auth.js` — edición prohibida por plugin guardrail (solo Javier, manualmente).
6. **Vendor `ALL`** significa TODOS los vendors: nunca `WHERE VENDEDOR='ALL'`; manejo especial en services (facturas, commissions).
7. **RUTERO_CONFIG**: queries filtran `ORDEN >= 0` (ORDEN = -1 es entrada de bloqueo, no cliente real).
8. **DB2**: verifica tabla/columna en `QSYS2.SYSTABLES`/`SYSCOLUMNS` antes de usarla; `VISTA_DEUDA_BASE` preferida; CPC con `ROW_NUMBER()`.
9. Nada de scratch ni `.md` temporales en root (documentación nueva solo en `docs/`); no inventar endpoints/tablas/columnas sin verificarlos esta sesión.
10. Flutter: colores solo desde `AppColors`; estados loading/empty/error/offline obligatorios; `Semantics` en interactivos; Riverpod `select()` para evitar rebuilds.

## 6. SDD obligatorio (Spec-Driven Development)

**Ninguna implementación sin spec aprobada. Adiós vibe coding.**

1. Petición → CLASSIFY → spec EARS en `.cline/state/specs/<id>.ears.md` (requisitos con ID, escenarios cuando aplique).
2. Gate mecánico: `gate_set {name: spec_approved, value: PASS, evidence: ...}` en `graph-ledger` **antes** de entrar a MAKER. Sin gate, los writers se consideran bloqueados por protocolo.
3. BUILD/TDD: los tests derivan del spec y se escriben antes del código cuando el playbook lo exija; verdes = done.
4. TINY/EXPLORE pueden operar sin spec completa, pero la exención se declara en el ledger (waiver explícito, no silencio).
5. El estado del run vive en el ledger (events.jsonl + gates.json): reentrada vía `ledger_read`, nunca reiniciar de cero.

Sin PASS no hay hecho (DoD): toda tarea termina con evidencia verificable — comando ejecutado con exit code real, rutas modificadas listadas, gates firmados. Si no puedes verificar → PARTIAL + bloqueos `BLOCKER·CAUSA·REQUIERE`.

## 7. Seguridad y producción

- **Secretos**: PROHIBIDO leer/escribir `.env*`, `*.pem`, `*.key`, `tokens*.json`, `cline_mcp_settings.json`, `CREDENCIALES.md` (el guardrail lo bloquea físicamente). Cero credenciales en markdown/mensajes/commits; conexiones por referencia de entorno (`${VAR}`). Si encuentras un token real, no lo copies ni lo imprimas: repórtalo a Javier.
- **Deploy (whitelist, únicas mutaciones permitidas en prod)**:
  1. `git pull origin test`
  2. `pm2 restart gmp-api`
- **PROHIBIDO sin Javier**: `pm2 save|set|start|reload`, editar `.env` remoto, ALTER/DDL, rotación de secretos, kill de procesos node/pm2.
- **Cadena a producción (playbook PROD)**: staging → QA PASS → AppSec PASS → health → INTERRUPT `/adelante-production` (gate `prod_approved` con TTL ≤ 30 min en ledger; expirado = pedir de nuevo) → deploy → post-check.
- **Health check**: `ssh gmp@192.168.1.230 curl -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready`
- Post-deploy: pm2 list online, logs sin error fresco, `/api/ready` healthy, `gate_set(prod_postcheck, PASS)`. Fallo en ventana acordada → rollback e informe inmediato.

## 8. Verificación (gate final)

No declares tarea terminada sin:
- Comando ejecutado realmente y su exit code (`flutter analyze`, `npm test`/jest) — el exit code es el gate, no la sensación.
- Rutas modificadas listadas.
- Gates firmados en `graph-ledger` cuando haya run activo.

Hooks/guardrails son la única capa determinista (bloqueo real de tool calls); las reglas en prosa son advisory. En Claude Code: `.claude/hooks/*.sh` + `.claude/settings.json`; en Cline: `.cline/plugins/gmp-guardrails.js`.

## 9. Dónde vive cada pieza (por harness)

| Pieza | Ruta |
|---|---|
| Fuente de verdad de reglas (11) | `.clinerules/*.md` |
| Skills V7 (28) | `.cline/skills/<nombre>/SKILL.md` |
| Mirror Claude Code | `.claude/rules/` y `.claude/skills/` (materializa `node scripts/team/sync-harness.cjs`) |
| Guardrails bloqueantes Cline | `.cline/plugins/gmp-guardrails.js` |
| Ledger del grafo (MCP) | `scripts/cline/mcp/graph-ledger.cjs` → estado runtime en `.cline/state/` (fuera de git) |
| Knowledge hub | `.cline/knowledge/` (api-catalog, flutter-map, db2-inventory; consultar ANTES de planificar) |
| Memoria persistente | `memory-bank/` (versionado; regla 35 obliga a leer `activeContext.md` + `progress.md` al iniciar) |
| Reglas con scope por path (Cursor) | `.cursor/rules/*.mdc` (globs; AGENTS.md no soporta scoping condicional) |
| Config Codex | `.codex/config.toml` + `.codex/hooks.json` |

Notas cross-tool: Cursor trata CLAUDE.md igual que AGENTS.md (siempre aplicados; mantener CLAUDE.md podado como puntero, sin duplicar contenido). Codex concatena AGENTS.md de root hacia cwd (más cercano sobreescribe). Cline lee `.clinerules/` y `.claude/skills/` nativamente.

## 10. Memoria y correcciones

Si Javier dice "te corrijo / aprende esto / no vuelvas a / recuerda / prefiero": captura la corrección en el ledger (`ledger_append(event=correction)`) antes de seguir; si es regla permanente, propón la línea para `.clinerules/` al final del turno (confirmación antes de editar reglas). `memory-bank/` es el vínculo entre sesiones; el espejo vivo de fases es el ledger.

## Learned User Preferences

- La rama de referencia de trabajo es `test`, no `main`.
- El modo claro/oscuro debe aplicar el tema a filtros, tablas y matrices (no solo el chrome).

## Learned Workspace Facts

- Objetivos comerciales usan R1_T8CDVD (quién tiene el cliente); LCCDVD es quién vendió. Comisiones: sales=LCCDVD, baseline de objetivo=R1_T8CDVD.
- Comercial 80 es líder de equipo (72/73/81/83); su objetivo personal no es la suma del equipo.
