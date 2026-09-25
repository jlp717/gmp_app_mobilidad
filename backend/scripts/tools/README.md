# backend/scripts/tools — README (WS2, mv fisico ejecutado 2026-09-25)

> Estado 2026-09-25, rama `test`: `git mv` de `backend/scripts/<fichero>` →
> `backend/scripts/tools/<fichero>` EJECUTADOS (77 ficheros: 68 JS + 9 sh/bat,
> historia preservada; `verify_javier_mirror.js` era untracked → `mv + git add`).
> +3 post-WS2 verificados por listing: `tools/create_view.js` (canon ex-`legacy/create_view_final.js`),
> `tools/migrate-pin-hashes.js` (rename `scripts/migrate-pin-hashes.js` → `tools/`, FIXBLOCK-20260925),
> `tools/check-auth-pin-readiness.js` (git mv `scripts/` → `tools/`, FIXBLOCK-20260925).
> 1 TOOL-REUSABLE EXCLUIDO con motivo (§2bis). La tabla lista los scripts en
> `tools/` (proposito + args/env por script). `sql/`, `sql/migrations/`,
> `validation/` y los 16 UNCLEAR-RISKY NO se mueven (se quedan).
> Tras los mv, actualizar `backend/package.json` `scripts/*` de `scripts/X` a
> `scripts/tools/X` (solo refs vivas, §5) — EJECUTADO 2026-09-25
> (GMP-SCRIPTS-FINAL-VIEWS-REFS-20260925, 12 entradas vivas; 7 rotas no tocadas).
> No ejecutar nada contra DB2 sin aprobación.

Env común: `ODBC_DSN` (def. `GMP`), `ODBC_UID`/`DB2_UID`, `ODBC_PASSWORD`/`ODBC_PWD`/`DB2_PASSWORD`.
DDL writers exigen además `ALLOW_DB2_DDL=I_UNDERSTAND_THIS_MUTATES_DB2`.
`reparto-production-ddl-runner` y `deploy-cert-apt.sh` REQUIEREN aprobación explícita de Javier.

## JS en tools/ (68: 65 base + create_view.js + migrate-pin-hashes.js + check-auth-pin-readiness.js; ver §2bis + FIXBLOCK-20260925)

| script | propósito | args / env |
|---|---|---|
| agent1-dsedac-discovery.js | descubrimiento DSEDAC solo lectura (inventario WS) | env ODBC_* |
| agent3-column-mapping.js | mapeo columnas, solo lectura | env ODBC_* |
| align-javier-dsedac-additive.js | DDL aditivo solo JAVIER (nunca DSEDAC); pkg `db2:align-javier-dsedac[:additive,:apply]` | `--apply` / env ODBC_* + `ALLOW_DB2_DDL` |
| apply-test-talon-ddl.js | DDL acotado tablas TEST_* (talón) | env ODBC_* + `ALLOW_DB2_DDL` |
| audit-api-live-readonly.js | auditoría API readonly | — |
| audit-commercial-cobros-readonly.js | reconcilia DSEDAC.CVC en lectura; pkg `db2:audit-commercial-cobros` | `--vendors=..` / env ODBC_* |
| audit-keysets-readonly.js | readonly keysets | env ODBC_* |
| check-auth-pin-readiness.js | readiness PIN hashes (lectura + `--backfill-if-needed` via `migrate-pin-hashes`) | `[--json] [--backfill-if-needed]` / env ODBC_* |
| check-cpc-join.js | verificación joins CVC/CPC, lectura | env ODBC_* |
| check-firmas-columns.js | columnas firmas, lectura, env-only | env ODBC_* |
| check-vendor-05.js | check vendor 05, lectura | — |
| check_config_data.js | datos configuración, lectura | — |
| cleanup-repartidor-finance-test-data.js | borra solo datos TEST por `idempotency_token`; pkg `finance:cleanup` | `<idempotency_token> [--delete-delivery-status] [--delivery-id=<id>]` |
| commercial-readiness-battery.js | batería readiness (pool-first ODBC opcional) | env ODBC_* opcional |
| commercial-test-aux-tables.js | DDL acotado TEST_* (LIKE + PK/UNIQUE) | env ODBC_* + `ALLOW_DB2_DDL` |
| compare-javier-dsedac-alignment.js | genera ALTER aditivos JAVIER; pkg `db2:align-javier-dsedac` | env ODBC_* |
| compare-schemas.js | comparación schemas, lectura | env ODBC_* |
| create_view.js | vigente canon ex-`legacy/create_view_final.js` (recrea `JAVIER.VISTA_DEUDA_BASE`, filtro CPC canon) — NO ejecutar sin PROD + aprobación Javier | env ODBC_* + `ALLOW_DB2_DDL` |
| copy-comercial-erp-to-test.js | copia ERP→TEST (CREATE LIKE + INSERT SELECT + DELETE dest; nunca escribe DSEDAC) | env ODBC_* + `ALLOW_DB2_DDL` |
| copy-javier-prod-to-test.js | copia PROD→TEST buffers JAVIER, lectura ERP | env ODBC_* |
| db2-connection.js | helper conexión DB2 por env (requerido por generadores) | env ODBC_* |
| db2_inventory.js / db2_inventory2.js / db2_inventory3.js / db2_inventory4.js | inventarios DB2 lectura (v4: CRCB situación) | env ODBC_* |
| diagnose-cpc-join.js | diagnóstico join CPC, lectura | env ODBC_* |
| diagnose-ddl.js | diagnóstico DDL, lectura | env ODBC_* |
| diag_vendor05.js | diagnóstico vendor05, lectura | env ODBC_* |
| discover-dsedac-columns.js | descubrimiento columnas DSEDAC, lectura | env ODBC_* |
| discover-vista-unificada.js | descubrimiento vista unificada, lectura | env ODBC_* |
| ensure-comercial-test-ddl.js | asegura DDL comercial TEST | env ODBC_* + `ALLOW_DB2_DDL` |
| ensure-missing-reparto-ddl.js | asegura DDL reparto faltante | env ODBC_* + `ALLOW_DB2_DDL` |
| ensure-test-commission-tiers.js | asegura tiers comisión test | env ODBC_* |
| erp_cobros_inventory.js | inventario cobros ERP, lectura | env ODBC_* |
| erp_diff_condensed.js | diff ERP condensado, lectura | env ODBC_* |
| find-dsedac-equivalents.js | equivalentes DSEDAC, lectura | env ODBC_* |
| full-schema-audit.js | auditoría completa schema, lectura | env ODBC_* |
| generate_align_migration.js | genera migración alineamiento (emite SQL, no ejecuta) | — |
| generate-pedidos-schema-align-sql.js | genera SQL alineamiento pedidos; pkg `db2:align-pedidos-schema` | — |
| generate-vista-deuda-completa.js | genera vista deuda completa (emite SQL) | — |
| generate-vista-deuda-final.js | genera vista deuda final (filtro CPC canon; referencia de `legacy/create_view_final.js`) | — |
| generate-vista-unificada-sql.js | genera SQL vista unificada | — |
| list-all-tables.js | listado tablas, lectura | env ODBC_* |
| list-pedidos-families.js | familias pedidos, lectura | env ODBC_* |
| migrate-pin-hashes.js | crea `JAVIER.VENDOR_PIN_HASHES` + backfill bcrypt (requerido por `tools/check-auth-pin-readiness.js --backfill-if-needed`) | `--backfill [--dry-run] [--update-existing] [--vendor=X]` / env ODBC_* |
| pedidos_system_inventory.js | inventario sistema pedidos; pkg `pedidos:inventory-system` | env ODBC_* |
| probe-credentials.js | helper credenciales probe SOLO env (`GMP_PROBE_USER`/`GMP_PROBE_PASSWORD`), sin secreto | env `GMP_PROBE_USER`, `GMP_PROBE_PASSWORD` |
| recreate-test-commission-tiers.js | recrea tiers comisión test | env ODBC_* |
| repartidor_finance_db_inventory.js | inventario finanzas; pkg `finance:inventory-db` | env ODBC_* |
| reparto-isolated-ddl-manifest.js | manifiesto DDL isolated_test (emite, no ejecuta) | — |
| reparto-isolated-ddl-runner.js | runner DDL acotado isolated_test | env ODBC_* + `ALLOW_DB2_DDL` |
| reparto-production-ddl-runner.js | runner DDL producción — REQUIERE aprobación Javier | env ODBC_* + `ALLOW_DB2_DDL` + aprobación |
| run-020-migration.js | ejecuta migración 020 (match `sql/020_*`) | env ODBC_* |
| run-024-migration.js | ejecuta migración 024 (match `sql/024_*`) | env ODBC_* |
| run-migration-027.js | ejecuta migración 027 (match `sql/027_*`) | env ODBC_* |
| run-migrations.js | ejecutor genérico migraciones versionadas | env ODBC_* |
| run_026_migration.js | ejecuta migración 026 (match `sql/026_*`) | env ODBC_* |
| run_scan_local.js | scan local | — |
| scan_product_assets.js | scan activos producto | — |
| truck_route_driver_inventory.js | inventario reparto; pkg `pedidos:inventory-reparto` | env ODBC_* |
| validate_production_config.js | validador config producción (lectura) | — |
| verify-024-migration.js | verifica migración 024 | env ODBC_* |
| verify-migration.js | verificador genérico migraciones | env ODBC_* |
| verify-pf-columns.js | columnas PF, lectura | env ODBC_* |
| verify-repartidor-finance-schema.js | verifica schema finanzas; pkg `finance:verify-schema` | env ODBC_* |
| verify-team-80.js | verifica team 80 (match `sql/028_*`) | env ODBC_* |
| verify-vista-final.js | verifica vista final, lectura | env ODBC_* |
| verify_javier_mirror.js | verifica espejo JAVIER, lectura | env ODBC_* |

## Shell/BAT en tools/ (9 movidos)

| script | propósito | args / env |
|---|---|---|
| audit_server.bat | auditoría servidor Windows (ODBC/iSeries) | — |
| install_server.bat | instalador servidor | — |
| build.sh | build backend | — |
| audit_server_linux.sh | auditoría servidor Linux (unixODBC) | — |
| deploy-cert-apt.sh | despliegue certificado APT — requiere aprobación | — |
| diagnostic.sh | diagnóstico general | — |
| monitor-activity.sh | monitor actividad | — |
| log-rotation.sh | rotación logs | — |
| rollback.sh | rollback; pkg `rollback` (`bash scripts/rollback.sh`) | `[--force]` |

## §2bis Resuelto (2026-09-25, GMP-SCRIPTS-FINAL-VIEWS-REFS-20260925)

| script | resolución |
|---|---|
| `tools/migrate-pin-hashes.js` (restaurado de `archive/2026/` via `git mv`) | REUSABLE: exporta `createPinHashesTable` + `backfillVendorPinHashes`, requerido por `check-auth-pin-readiness.js --backfill-if-needed`. Requires internos reparados (`../config|middleware` → `../../config|middleware`); `Run:` actualizado a `tools/`. |
| `scripts/check-auth-pin-readiness.js` → `tools/check-auth-pin-readiness.js` (git mv, FIXBLOCK-20260925) | `require('./tools/migrate-pin-hashes')` → `require('./migrate-pin-hashes')`; `require('../services/auth-pin-readiness')` → `require('../../services/auth-pin-readiness')`; header TOOL añadido. Top-level queda con 15 `.js` + `db-indices.sql` = 16 UNCLEAR-RISKY. Cero acoplo tools→archive. |

## §3 Notas de verificacion del mv (2026-09-25)

Leidos los 75 candidatos (cabecera + patrones require/`__dirname` + ficheros
marcados completos: `audit-api-live-readonly.js`, `check-vendor-05.js`,
`check-auth-pin-readiness.js`, `run-migrations.js`, `reparto-isolated-ddl-runner.js`
§825-864). Hallazgos:

- `audit-api-live-readonly.js`: los `Buffer.from(..., 'base64')` decodifican a
  `username` / `password` / `/auth/login` (nombres de campo y path, NO secretos);
  credenciales via env `AUDIT_A`/`AUDIT_B`. Reusable readonly, movido.
- `check-vendor-05.js`: alcance estrecho (vendor 05, Ene/Feb 2026, snapshot
  `COMMISSION_SNAPSHOT_2026_0102`) pero lectura re-ejecutable; se mueve segun
  CLASSIFICATION.csv. `diag_vendor05.js` es la variante generica.
- Reparacion mecanica post-mv (misma semantica, un nivel mas de profundidad):
  `require('../...')` → `require('../../...')` en 18 ficheros (lista en hand-off);
  `run-migrations.js:8` `migrationsDir` +1 nivel (sigue `db/migrations` de raiz);
  `reparto-isolated-ddl-runner.js:825-826` (`sql`) y `:843-844` (`repositories`)
  +1 nivel (pins de seguridad intactos); `apply-test-talon-ddl.js:13` y
  `validate_production_config.js:13` `loadEnv` +1 nivel. Cero ejecucion (sin
  node/odbc); verificado por grep (cero `require('../` residuales).
- Deriva conocida NO tocada (seguimiento futuro, sin crash): `dotenv` con
  `__dirname, '..', '.env'` resuelve a `scripts/` en vez de `backend/` (no-op
  silencioso si falta; env suele venir inyectado; varios ficheros ya prueban
  `../../.env` primero, que ahora resuelve BIEN a `backend/.env`); dirs de
  salida `tmp/db-exploration`, `migrations/100_*.sql`, `docs/audits`,
  `VISTA_DEUDA_COMPLETA.md` ahora cuelgan de `tools/` en vez de `scripts/`.
- `deploy-cert-apt.sh:33,44` invoca `node scripts/execute-javier-dsedac-*.js` y
  `scripts/cert-matrix-audit.js` (ambos UNCLEAR, in place): refs relativas a cwd
  `backend/`, siguen validas. Refs de cron `/opt/gmp-api/backend/scripts/*.sh`
  en comentarios: se actualizan al desplegar, no aqui.
- Cada destino lleva header corto (proposito/uso/env/DB2 R|T|G|PROD) tras
  shebang/`@echo off` o en linea 1; insercion a nivel byte, resto intacto.

## §4 Consolidado legacy/create_view → tools/create_view.js (1, EJECUTADO 2026-09-25)

Vigente elegido: `legacy/create_view_final.js` → `tools/create_view.js` (sin sufijo).
Motivo: único con filtro CPC canon idéntico a `generate-vista-deuda-final.js`
(`DIADOC/MESDOC/ANODOC/HORADOC/CODIGOCL/ALBARAN/SITUACION/SUBEMPRESA/EJERCICIO/SERIE/TERMINAL/NUMERO/IMPORTETOTAL/PEDIDO/BULTO`,
alias `ALBARAN_*`, dedup `ROW_NUMBER()`), frente a `create_view.js` (depende de fichero
externo `database_backup_20260513/recreate_VISTA_DEUDA_BASE_COMPLETA.sql`, frágil),
`create_view_v2.js` (lista estática corta CVC+CPC sin CLI/CLC/CLP) y `create_view_full.js`
(filtro ancho con prefijo `CPC_*`, no canon). Los otros 3 → `archive/2026/` (git mv,
NO rm; comparativa por lectura: §3 INVENTORY.md + headers verificados; shell
bloqueado para sha256). EJECUTADO 2026-09-25 (GMP-SCRIPTS-FINAL-VIEWS-REFS-20260925):
`tools/create_view.js` (A, con header proposito/uso/env) + `archive/2026/create_view{,_v2,_full}.js`
(A, 1-línea ARCHIVE superseded c/u). Cero `require`/`package.json` vivos hacia
`legacy/create_view*` (solo docs históricos + CLASSIFICATION/INVENTORY, no tocar).
Vista muerta
`JAVIER.VISTA_DEUDA_BASE` (ver `legacy/README.md`); canon vivo =
`backend/services/debt-view-contract.js` (`FROM DSEDAC.CVC`). Gate propio
`ALLOW_DB2_DDL` en los 4; no ejecutar sin cadena PROD + aprobación Javier.

## §5 Refs a actualizar tras los mv (EJECUTADO 2026-09-25, GMP-SCRIPTS-FINAL-VIEWS-REFS-20260925)

Vivas en `backend/package.json` (`scripts/X` → `scripts/tools/X`, 12 entradas): `rollback.sh`,
`cleanup-repartidor-finance-test-data.js`, `repartidor_finance_db_inventory.js`,
`truck_route_driver_inventory.js`, `pedidos_system_inventory.js`,
`compare-javier-dsedac-alignment.js`, `generate-pedidos-schema-align-sql.js`,
`audit-commercial-cobros-readonly.js`, `align-javier-dsedac-additive.js` (x2 con `--apply`),
`verify-repartidor-finance-schema.js`. Rotas conocidas (7, no existen, no tocar en WS2):
`apply-db-optimizations.js`, `fullOptimizationPipeline.js`, `validation/pre-post-validator.js`,
`testing/chaos-engineering.js`, `rollback-manager.js`, `cache-cleanup.js`, `flutterTestRunner.js`.
`Makefile` y `.github/workflows/`: sin refs a `backend/scripts/` (verificado WS1/WS2).
Docs (`docs/`, auditorías) citan `backend/scripts/*.js` y `pilar2-*` históricos: NO tocar
(documentación histórica, fuera de alcance).
