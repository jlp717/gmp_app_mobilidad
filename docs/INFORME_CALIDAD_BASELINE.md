# INFORME CALIDAD BASELINE — GMP App Mobilidad

**Fecha**: 2026-08-25
**Prompt origen**: Prompt 2 (tooling de calidad: ESLint/Prettier/Semgrep/very_good_analysis/custom_lint/CI)
**Proposito**: numeros reales de partida. Sin este documento no existe forma objetiva de saber si la calidad mejoro o solo cambio de sitio.

Metodo: todas las cifras provienen de ejecuciones reales de las herramientas sobre el repo el dia de la fecha. Los ficheros crudos estan en `docs/quality-baseline/`.

---

## 1. Backend — ESLint 9 flat config + Prettier

Config: `eslint.config.js` (raiz) · reglas estrictas: `no-unused-vars` (error), `eqeqeq` (error), `no-implicit-coercion` (error), `require-await` (error) + errores reales (`no-eval`, `no-throw-literal`, `no-return-await`, etc.).

### Baseline ESLint (codigo producto)

| Metrica | Valor |
|---|---|
| Total problems | **2404 errors, 14 warnings** |
| Ficheros con problemas | 691 |

Desglose por zona (top, detalle completo en `eslint-baseline-summary.txt`):

| Zona | Errors |
|---|---|
| backend/src/modules | 435 (135 files) |
| backend/services/pedidos.service.js | 106 |
| backend/src/chatbot | 103 (9 files) |
| backend/routes/objectives.js | 84 |
| backend/routes/commissions.js | 76 |
| backend/routes/repartidor.js | 72 |
| backend/routes/warehouse.js | 56 |
| backend/routes/planner.js | 53 |
| backend/repositories/*db2* | ~100 acumulado |
| scripts/opencode/mcp | 5 |

Exclusiones aplicadas al gate (codigo NO mantenido en este repo): `.obsidian/`, `.codex/`, skills/, assets/load_planner vendor (~10.190 problems adicionales que no son deuda de producto).

### Prettier

`.prettierrc` + `.prettierignore` creados. Check integrado en CI como ratchet no-bloqueante: formatear todo backend JS hoy produciria un diff masivo; se quema incrementalmente via lint-staged.

---

## 2. Evaluacion TypeScript incremental (@ts-check sobre capa DB2)

Sonda: `// @ts-check` + `tsc --checkJs --noEmit` sobre 3 ficheros criticos de acceso DB2 (probe aplicado, medido y revertido).

Ficheros: `backend/config/db.js`, `backend/src/core/infrastructure/database/db2-connection-pool.js`, `backend/repositories/reparto-finance-db2-repository.js`

Resultado: **49 errores de tipo** → `43x TS2339` (propiedad inexistente), `5x TS2554` (aridad incorrecta), `1x TS2550` (API obsoleta). Detalle: `ts-check-db2-probe.txt`.

Lectura tecnica:
- ~35 errores desaparecen con un `logger.d.ts` (el modulo logger no exporta tipos).
- Los `TS2339` sobre `Error.code/.statusCode` son el patron JS clasico de error tipado mal modelado.
- Coste real de migrar SOLO la capa repositorios DB2: declaraciones de tipos + refactor de manejo de errores ≈ semanas, con riesgo bajo porque los tests de contrato existen.
- Beneficio: los 49 errores detectados en 3 ficheros extrapolan a cientos de defectos latentes en ~40 ficheros DB2.

**Recomendacion (decision de Javier)**: migracion incremental JUSTIFICADA pero no urgente. Plan: (1) anadir `logger.d.ts`, (2) activar `// @ts-check` por fichero en repositories/, (3) evaluar `checkJs` global en 3 meses. No migrar a .TS completo ahora.

---

## 3. Semgrep

Reglas custom (`​.semgrep/gmp-rules.yml`) verificadas contra muestra sintetica antes del baseline — las 5 disparan:

| Regla | Findings baseline |
|---|---|
| gmp.sql-template-interpolation | 796 |
| gmp.dsedac-write (+ -sql) | **28** |
| gmp.console-log-secrets | 6 |
| gmp.sql-string-concat | 2 |
| gmp.jwt-decode-unverified | 1 |

Rulesets publicos:

| Ruleset | Rules | Findings |
|---|---|---|
| p/owasp-top-ten | 256 | 3 (2 res.sendFile, 1 direct-response-write XSS) |
| p/nodejsscan | 114 | 59 (17 regex_dos, 7 insecure_random, 5 hardcoded user, 3 md5...) |

Hallazgos P0 para revision AppSec inmediata (escrituras DSEDAC = produccion solo-lectura):
- `backend/optional/dsedac-exports.impl.js` (8)
- `backend/scripts/mandato-v5-*` probes (10)
- tests y audit scripts (10)

Nota de ruido: `sql-template-interpolation` (796) incluye falsos positivos donde `${}` interpola nombres de tabla/columna validados, no valores de usuario. Triaje pendiente antes de volverlo bloqueante.

Crudos: `semgrep-custom-baseline.json`, `semgrep-owasp-baseline.json`, `semgrep-nodejsscan-baseline.json`.

---

## 4. Frontend — analysis_options.yaml + custom_lint

`analysis_options.yaml` reescrito sobre `very_good_analysis` 6.0:
- Escaladas a ERROR: `prefer_const_constructors`, `avoid_print`, `always_use_package_imports`, `require_trailing_commas`, `unawaited_futures`, `close_sinks`.
- Eliminado el bloque de ~30 `errors: ignore` que silenciaba errores REALES del analyzer (`invalid_assignment`, `undefined_method`, etc.). Eso era deuda invisible.
- `strict-casts/inference/raw-types: true`.

### flutter analyze

| Config | Issues |
|---|---|
| ANTES (config antigua con ignores) | 8345 (mayoria info) |
| AHORA (config estricta) | **9177 = 2193 errors + 451 warnings + 6533 info** |

Los +832 issues vs config antigua son mayormente errores reales previamente silenciados. Crudos: `flutter-analyze-before.txt`, `flutter-analyze-after.txt`.

### dart format

`dart format --output=none --set-exit-if-changed lib test`: 377 ficheros, **1 sin formato** → corregido en este mismo cambio (`repartidor_rutero_reorder_modal.dart`). Gate actual: VERDE.

### custom_lint — regla `no_flutter_in_domain`

Estado: **regla escrita y lista** en `tool/gmp_custom_lints/` (falla si cualquier `lib/features/*/domain/*.dart` importa `package:flutter/`).

Bloqueo de activacion documentado con TODO fechado (2026-08-25) en `analysis_options.yaml`: `hive_generator@2.0.1` limita analyzer `<7.0.0`; `custom_lint>=0.6.5` exige analyzer `^6.6.0+` que depende de `_macros` (eliminado del SDK Dart 3.9); `custom_lint<0.6.5` exige `rxdart ^0.27` (proyecto usa 0.28). Impasse real de pub.

Enforcement equivalente ACTIVO HOY: `scripts/check_domain_imports.mjs` (grep AST-lite) — bloqueante en CI y disponible como `npm run check:domain`. Estado actual: **OK, domain/ libre de Flutter** (verificado en 6 features con domain/).

---

## 5. CI

`.github/workflows/quality-gates.yml` actualizado:
- BLOQUEANTE ya: `dart format` check + gate dominio puro.
- Ratchet NO-bloqueante (miden y suben evidencia; se vuelven bloqueantes al quemar baseline): eslint full-repo, `flutter analyze` strict, prettier, semgrep completo.
- Se conserva lint TS legacy de backend (bloqueante).

Patron ratchet deliberado: un gate nuevo que falla 2400 veces se desactiva a la semana. Un gate que mide, se quema y luego endurece sobrevive.

---

## 6. Plan de quemado del baseline (orden propuesto)

1. P0 AppSec: revisar 28 findings dsedac-write (¿escrituras reales o probes?) — bloqueante para SECURE.
2. `logger.d.ts` + habilitar @ts-check en repositories/db2 (barato, alto retorno).
3. Triaje sql-template-interpolation: parametrizar queries reales, suprimir FPs con comentario justificado.
4. Quemar 2404 errors ESLint por carpetas (routes/ primero: son trust boundary).
5. Reducir 2193 errors flutter analyze (empieza por `undefined_*`: bugs reales).
6. Flip de todos los [ratchet] a bloqueante cuando cada numero llegue cerca de 0.

---

## 7. Autoverificacion final (re-ejecucion 2026-08-25 post-cambios)

| Comando | Resultado | vs baseline |
|---|---|---|
| `npx eslint .` | 2447 errors + 14 warnings | +43 errors — atribuidos a ficheros anadidos por sesion paralela en el arbol mientras se media (32 en backend/src/controllers|middlewares|models|repositories|routes|services|errors|validators + `.eslintrc-complexity.cjs`, resto archivos concurrentes). Codigo de este prompt no introduce errores nuevos. Crudo: `verify-eslint-final.txt`, `verify-eslint-parallel-session.txt` |
| `semgrep --config auto backend` | 172 findings / 497 rules / 820 files | primera medicion auto config. Crudo: `verify-semgrep-auto.txt` |
| `flutter analyze --no-pub` | 9177 issues (estable) | identico al after-config |
| `dart format --output=none --set-exit-if-changed lib test` | 377 files, **0 changed** | VERDE |

Fix aplicado durante verificacion: `sourceType: module` para `**/*.mjs` en `eslint.config.js` (`scripts/check_domain_imports.mjs` daba parsing error como ESM).

---

## 8. Ficheros del baseline crudo

```
docs/quality-baseline/
├── eslint-baseline.json            # salida JSON completa
├── eslint-baseline-summary.txt     # agregado por carpeta
├── _summarize-eslint.js            # regenerable tras cada quemado
├── ts-check-db2-probe.txt          # sonda @ts-check 3 ficheros DB2
├── semgrep-custom-baseline.json
├── semgrep-owasp-baseline.json
├── semgrep-nodejsscan-baseline.json
├── flutter-analyze-before.txt      # config antigua
├── flutter-analyze-after.txt       # config estricta nueva
└── dart-format-baseline.txt
```
