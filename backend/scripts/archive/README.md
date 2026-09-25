# archive/ — scripts one-off archivados (solo lectura)

- task: GMP-SCRIPTS-FINAL-ARCHIVE-20260925. Rama: `test`. CERO ejecución contra DB. CERO deletes (todo via `git mv` o move+`git add` para ficheros nunca trackeados).
- Origen: `backend/scripts/CLASSIFICATION.csv` (340 filas; 200 `ARCHIVE-ONEOFF`). Movidos 190 top-level. Desviación documentada: CSV proponía `archive/oneoff/<fich>`; se implementó `archive/<año>/<fich>` según alcance del task (tabla año→nº abajo).
- Año por fichero: `git log --diff-filter=A` (100 ficheros) o `mtime` (90 ficheros nunca trackeados, gitignored `_*`). 0 fallbacks.
- Cabecera: cada fichero destino lleva 1 línea header (`qué/juicio CSV + año/fuente + NO EJECUTAR`), resto intacto. Excepción: 2 `.json` (`scan_results.json`, `_verify-report.json`) sin header — JSON no admite comentarios; no romper el formato.

## Regla NO-EJECUTAR

Nada bajo `archive/` debe ejecutarse (ni `node`, `bash`, `odbc`, `ssh`, `curl`, `pm2`). Son probes, HITs, E2E, migraciones puntuales ya aplicadas o diagnósticos desechables. Re-ejecutar puede escribir en DB2 (incl. DSEDAC-PROD en 5 ficheros marcados `AVISO: ESCRIBE DSEDAC-PROD`).

## Contenido año → nº (verificado por listing 2026-09-25, GMP-SCRIPTS-FINAL-FIXBLOCK-20260925)

| año | nº | criterio |
|---|---|---|
| 2025 | 3 | `explore_tables.ts`, `find_comerciales.ts`, `find_vendedores.ts` |
| 2026 | 189 | resto (gitlog o mtime) incl. 3 `create_view{,_v2,_full}.js`; 190 antes de eliminar duplicado `migrate-pin-hashes.js` |
| **total** | **192** | 3+189 |

- Nota duplicado (2026-09-25, FIXBLOCK): `archive/2026/migrate-pin-hashes.js` era duplicado exacto post-`mv` fallido (conflict markers `Updated upstream/Stashed changes` en ambas copias); eliminado vía `git rm backend/scripts/archive/2026/migrate-pin-hashes.js`. Historia preservada en `backend/scripts/tools/migrate-pin-hashes.js` (rename `backend/scripts/migrate-pin-hashes.js` → `backend/scripts/tools/migrate-pin-hashes.js`, conflicto resuelto, `node --check` OK). Verificación: `glob migrate-pin-hashes =1` solo en `tools/`.

## Excluidos (no movidos, motivo)

- `legacy/` (5: 4 `create_view*.js` + `README.md`) — dir excluido; `proposed_path` = quedarse.
- `sql/opencode.json`, `sql/orchestrator.md` — dir `sql/` excluido.
- `temp/` (2 `.json`) — dir `temp/` excluido.
- `__pycache__/powerbi_export.cpython-311.pyc` — bytecode compilado, no fuente.
- 16 `UNCLEAR-RISKY` con guard — no tocar (ver CLASSIFICATION.csv).
- `INVENTORY.md`, `CLASSIFICATION.csv`, `validation/`, `tools/` — fuera de alcance.

## Ficheros con AVISO DSEDAC-PROD (5)

`mandato-v5-commit-probe.js`, `mandato-v5-cpc-cols-probe.js`, `mandato-v5-cpc-insert-test.js`, `mandato-v5-pool-tx-probe.js`, `mandato-v5-tx-probe.js` — INSERT/LOCK sobre `DSEDAC.CPC`. Cuarentena: archivados + header reforzado, jamás re-ejecutar.
