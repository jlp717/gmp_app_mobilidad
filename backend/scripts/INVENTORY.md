# WS1 — Inventario backend/scripts (solo lectura)

- task: GMP-SCRIPTS-CLEANUP-20260925-WS1
- rama: `test` (verificada via `.git/HEAD` → `ref: refs/heads/test`)
- fecha: 2026-09-25
- alcance: inventario file-by-file + clasificación. CERO mv/rm. CERO ejecución contra DB.
- artefactos: `CLASSIFICATION.csv` (detalle 100% ficheros), este `INVENTORY.md` (resumen).

## 1. Conteo antes (documentado)

| nivel | entradas | detalle |
|---|---|---|
| `backend/scripts/` top-level (re-contado) | 286 | 281 ficheros + 5 dirs (`__pycache__/`, `legacy/`, `sql/`, `temp/`, `validation/`) |
| top-level por tipo | 281 | 244 `.js` (94 con prefijo `_`), 20 `.sh` (13 `_`), 3 `.ts`, 2 `.py`, 2 `.bat`, 2 `.json`, 4 `.txt`, 2 `.log`, 2 `.sql` |
| `legacy/` | 5 | `create_view.js`, `create_view_v2.js`, `create_view_full.js`, `create_view_final.js`, `README.md` |
| `sql/` | 30 ficheros + 1 dir | 28 `.sql` (001–042 + 2 vistas) + `opencode.json` + `orchestrator.md` + dir `migrations/` |
| `sql/migrations/` | 20 | 10 `.sql` + 10 `.json` (6 additive 2026-06-07/11/19 + 4 rutero 2026-08-27) |
| `temp/` | 2 | 2 `.json` (objetivos ago-dic) |
| `validation/` | 1 | `validate_invoice_amounts.js` |
| `__pycache__/` | 1 | `powerbi_export.cpython-311.pyc` |
| TOTAL recursivo | 340 ficheros | 281 + 5 + 30 + 20 + 2 + 1 + 1 = 340; `CLASSIFICATION.csv` cubre los 340 (100%) |

## 2. Resumen por bucket (1 bucket exacto por fichero)

| bucket | nº | % | destino propuesto (WS2+, NO ejecutado) |
|---|---|---|---|
| ARCHIVE-ONEOFF | 198 | 58.2% | `archive/oneoff/<nombre>`; `legacy/` y `sql/` se quedan donde están |
| TOOL-REUSABLE | 126 | 37.1% | `tools/<nombre>`; `sql/`, `sql/migrations/`, `validation/` se quedan |
| UNCLEAR-RISKY | 16 | 4.7% | `review/risky/<nombre>` — NO mover ni archivar hasta revisión 1-a-1 |
| TOTAL | 340 | 100% | cero `mv`/`rm` en WS1 |

Composición ARCHIVE-ONEOFF (198): 94 `_*.js` + 13 `_*.sh` + 4 `legacy/create_view*.js` + 1 `legacy/README.md` + 12 `hit-*` + 19 `mandato-v5-*` + 12 `pilar2-*` + 10 `inspect-*` + 11 one-offs sueltos (final-objectives, fix-agosto-2026, migrate-pin-hashes, find-*, benchmark, capture-*, javier-pre-ds, sync-vddx, test-*-view, pizarra-*) + 3 e2e/smoke sueltos + `run_create_view.sql` + 2 `.py` + 3 `.ts` + 13 artefactos (json/txt/log/pyc/temp/sql-misc).

Composición TOOL-REUSABLE (126): 68 `.js` top (10 refs package.json + 17 runners/ensure/verify + 35 readonly/diagnóstico + 4 generate-* + 2 copy-*) + 9 shell/bat (7 `.sh` incl. `rollback.sh` + 2 `.bat`) + 48 SQL versionado (`sql/` 28 + `migrations/` 20) + 1 `validation/`.

Composición UNCLEAR-RISKY (16): 15 `.js` + 1 `.sql` (`db-indices.sql` crea índice EN `DSEDAC.CPC`). Ver §5.

## 3. legacy/create_view x4 (vista muerta VISTA_DEUDA_BASE, archivados F4-02)

| path | header verificado | DB2-write? | guard | sha256 |
|---|---|---|---|---|
| `legacy/create_view.js` | `odbc` + `ALLOW_DB2_DDL` gate + lee `database_backup_20260513/recreate_VISTA_DEUDA_BASE_COMPLETA.sql` | YES (CREATE VIEW `JAVIER.VISTA_DEUDA_BASE`) | gate propio explícito, NO bypass | PENDIENTE (ver §6 warning W3) |
| `legacy/create_view_v2.js` | `odbc` + gate + `CREATE OR REPLACE VIEW JAVIER.VISTA_DEUDA_BASE` inline | YES | gate propio explícito | PENDIENTE (W3) |
| `legacy/create_view_full.js` | `odbc` + gate + `QSYS2.SYSCOLUMNS ... DSEDAC` (lee catálogo ERP) | YES | gate propio explícito | PENDIENTE (W3) |
| `legacy/create_view_final.js` | `odbc` + gate + filtro CPC canon (mismo que `generate-vista-deuda-final.js`) | YES | gate propio explícito | PENDIENTE (W3) |

`legacy/README.md` confirma: archivados como referencia histórica, NO ejecutar sin cadena PROD + aprobación Javier; fuente canon = `backend/services/debt-view-contract.js` (`FROM DSEDAC.CVC`); cero `require` productivo (verificado 2026-09-24).

## 4. Referencias encontradas (package.json / Makefile / workflows)

- `backend/package.json` `scripts`: 12+ refs `scripts/...` hacia `backend/scripts/`: `rollback.sh` ✅ existe; `cleanup-repartidor-finance-test-data.js` ✅; `repartidor_finance_db_inventory.js` ✅; `truck_route_driver_inventory.js` ✅; `pedidos_system_inventory.js` ✅; `compare-javier-dsedac-alignment.js` ✅; `generate-pedidos-schema-align-sql.js` ✅; `audit-commercial-cobros-readonly.js` ✅; `align-javier-dsedac-additive.js` ✅ (+ variante `--apply`); `verify-repartidor-finance-schema.js` ✅. ROTAS (no existen en `backend/scripts/`): `apply-db-optimizations.js`, `fullOptimizationPipeline.js`, `validation/pre-post-validator.js`, `testing/chaos-engineering.js`, `rollback-manager.js`, `cache-cleanup.js`, `flutterTestRunner.js` → 7 refs a ficheros inexistentes (anotar para WS3: actualizar o eliminar).
- `Makefile`: SIN referencias a `backend/scripts/` (solo `cd backend && npm ...`, docker, flutter).
- `.github/workflows/`: SIN referencias a `backend/scripts/` (solo `scripts/` raíz: `politec-quality-gate.ps1`, `verify.ps1`, `opencode-governance/*`, `check_domain_imports.mjs`, `generate-postman-collection.js`). Cero workflows tocan `backend/scripts/`.
- `.gitignore` líneas 198/202-224: `backend/scripts/_*.js`, `debug_*`, `test_*`, `check_*`, `verify_*`, `inspect_*`, `investigate_*`, `explore_*`, `diagnose_*`, `audit_*`, `analyze_*`, `find_*`, `list_*`, `temp_*`, `_temp_*`, `fix_*`, `godmode*`, `verificar_*`, `resumen_*`, `analizar_*`, `*.log`, `*.txt`, `*.json` → la mayoría del material ARCHIVE-ONEOFF ya está ignorado por git (los `_*.js` y artefactos pueden no estar versionados; verificar en WS2 con `git ls-files`).
- Guards: `backend/utils/dsedac-write-guard.js` (`assertNoDsedacWrite`, bloqueo `DSEDAC.*` WRITE + `SET SCHEMA`) y `backend/config/reparto-runtime.js` (`createRepartoWriteGuard`,_allowlist `JAVIER.TEST_*`/`TESTMOVIL`). Grep en `backend/scripts/`: **0 imports** de `assertNoDsedacWrite` / `createRepartoWriteGuard` → ningún script usa los guards; todo writer efectivo = bypass (columna `guard_bypass` del CSV).

## 5. UNCLEAR-RISKY — revisión 1-a-1 obligatoria (16)

| path | por qué es riesgoso |
|---|---|
| `cert-matrix-audit.js` | **MÁXIMO RIESGO**: `DELETE FROM DSEDAC.CRC WHERE ...` (línea 338) + `DELETE FROM JAVIER.COBROS`; escribe ERP sin `assertNoDsedacWrite` |
| `db-indices.sql` | `CREATE INDEX DSEDAC.CPC_COMMISSION_IDX ON DSEDAC.CPC` — DDL directo sobre schema ERP |
| `apply-laclae-monthly.js` | `DELETE FROM` + `DROP TABLE JAVIER.LACLAE_MONTHLY` + `INSERT` (grep) |
| `apply-objetivos-2026-ago-dic.js` | `UPDATE` + `INSERT INTO JAVIER.COMMERCIAL_TARGETS` (grep) |
| `apply-bolsa-pricing-config.js` | `CREATE TABLE JAVIER.BOLSA_PRODUCTO_PRECIO` + writes |
| `execute-javier-dsedac-alignment.js` | EJECUTA (no genera) alineamiento |
| `execute-vista-unificada.js` | EJECUTA vista en DB2 |
| `live-reparto-confirm-isolated.js` | write-path confirmación reparto |
| `certify-reparto-confirm-local.js` | posible write confirmaciones |
| `verify-repartidor-cierre-live.js` | nombre indica LIVE |
| `setup_production.js` | setup prod con writes |
| `import-bolsa-pricing-from-erp.js` | import con write a pricing |
| `create_v_dim_cliente.js` | CREATE VIEW en DB2 |
| `db_create_indexes.js` | crea índices (verificar schema target) |
| `cert-mandate-probe.js` | acceso DB2 (`odbcErrors`) sin guard, alcance incierto |
| `whatsapp-baileys-pair.js` | pairing Baileys (custodia sesión/credenciales) |

## 6. Warnings y límites del inventario

- W1 — shell bloqueado (`Permission denied: shell`): sin `git status/commit`, sin `stat` (columnas `size/mtime` = `n/a`), sin `sha256sum`, sin `node --check`. Lecturas solo vía `read/glob/grep`.
- W2 — NO HAY COMMIT. `CLASSIFICATION.csv` + `INVENTORY.md` creados SIN commitear. Comando pendiente para el orquestador (en rama `test`): `git add backend/scripts/INVENTORY.md backend/scripts/CLASSIFICATION.csv && git commit -m "WS1 inventory scripts"`. Sin `git diff --stat` ni commit sha (incluir al commitear).
- W3 — sha256 `legacy/create_view*.js` PENDIENTES (requieren shell). Sustituto: headers verificados en §3.
- W4 — `header`/`db2_write` en CSV: verificado por lectura directa solo en ~12 ficheros clave; resto = señal nombre + grep (`INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|odbc`). WS2 debe confirmar headers antes de cualquier `mv`.
- W5 — 7 refs rotas en `backend/package.json` (§4) apuntan a scripts inexistentes.
- W6 — secretos: grep de secretos hardcodeados NEGATIVO (solo `password="false/true"` como atributos UI en `hit-emulator-comercial-ui.js` y lecturas por env en `probe-credentials.js`/`create_view*.js`). Sin condición de parada activada.

## 7. Método (trazabilidad)

1. `.git/HEAD` → `ref: refs/heads/test` (rama correcta, sin checkout necesario).
2. `read backend/scripts/` → 286 entradas top; `glob` por extensión + subdirs → 340 ficheros.
3. `read` headers: 4 `legacy/create_view*.js`, `legacy/README.md`, guards, `package.json`, `Makefile`, `.gitignore`, `validation/*`, `probe-credentials.js`.
4. `grep`: `assertNoDsedacWrite|createRepartoWriteGuard` (0 en scripts), `odbc|ODBC` (60+), `INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE` (60+), `ALLOW_DB2_DDL|DSEDAC.(CRC|CVC|CPC)|DELETE FROM DSEDAC` (30), `scripts/` en workflows, refs `scripts/` en backend, secretos hardcodeados (negativo).
5. Clasificación determinista: `_`-scratch/`hit-`/épicos cerrados (mandato-v5, pilar2)/inspecciones puntuales/artefactos → ARCHIVE; refs package.json + runners/ensure/generadores/readonly/inventarios + SQL versionado → TOOL; writers ERP/prod/LIVE/sin-guard → RISKY.
6. Cero ejecución: ningún `node scripts/*`, ningún ODBC/ssh/curl/pm2. Solo lecturas.
