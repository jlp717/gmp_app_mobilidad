# T3 Lint+Audit — Informe 2026-09-25

Spec: `.cline/state/specs/T3-lint-audit-ears.md` (T3-01 + T3-02).
Modelo maker: Muse Spark 1.3. Alcance: `backend/routes`, `backend/services`, `backend/middleware`, `backend/utils`.
No-go respetados: sin tocar `backend/config/db.js`, `backend/middleware/auth.js`, dinero, DDL, prod. Sin `npm install` / `npm audit fix`.

## T3-01 — ESLint

Comando:

```powershell
cd backend
npx eslint routes services middleware utils --format stylish   # exit 1
npx eslint routes services middleware utils --format json      # exit 1 (conteo)
npx eslint routes services middleware utils --fix-dry-run --format json  # exit 1 (estimacion autofix)
```

Resultado:

- Total: **882 errores, 0 warnings** en **60/131 ficheros**. Exit 1.
- Conteo por regla:

| Regla | N | Autofixable | Accion |
|---|---|---|---|
| no-unused-vars | 359 | no (requiere juicio: imports muertos vs API usada fuera) | NO tocar en T3; limpieza por fichero con owner en T4 |
| radix | 285 | no (requiere `, 10` manual + test) | NO masivo; patron `parseInt(x, 10)` en proximo BUILD que toque cada ruta |
| require-await | 76 | no (cambiar async→sync altera contrato) | NO tocar; 2 en `middleware/auth.js` (intocable) |
| object-shorthand | 72 | sí (~seguro) | Diferido: toca ~20 ficheros incl. dinero (cobros/commissions); hacerlo con snapshot + jest scoped, no en T3 |
| prefer-const | 64 | sí (~seguro) | Diferido por mismo motivo |
| eqeqeq | 18 | no (== puede ser coercion intencional DB2 char/int) | Revisar caso a caso con tests |
| prefer-rest-params, import/*, no-undef-init, no-implicit-coercion, no-return-await | 8 | mixto | Puntual futuro |

- Estimacion `--fix-dry-run`: quedan 764 → **~118 autofixables**. No se ejecuto `--fix` real.
- Top ficheros: `services/index.js` 99, `routes/objectives.js` 83, `routes/repartidor-history-routes.js` 76, `routes/repartidor-document-routes.js` 60, `routes/commissions.js` 56, `routes/repartidor.js` 50, `services/repartidor-route-context.js` 42, `routes/clients.js` 39, `routes/warehouse.js` 35, `routes/planner.js` 34.
- Decision: **codigo intacto** (cero diffs T3). Motivos: (1) arbol ya dirty en `test` con ~20 ficheros de otros workstreams; (2) autofix masivo tocaria rutas de dinero (`cobros.js`, `commissions.js`, `facturas.service.js`) contra no-go; (3) spec ordena no reescribir todo si hay cientos de estilo; (4) `middleware/auth.js` tiene 2 `require-await` y es intocable por guardrail.
- Siguiente paso propuesto (requiere aprobacion): T4 con snapshot propio, `eslint --fix` solo `object-shorthand`+`prefer-const` excluyendo `middleware/auth.js` y rutas dinero, + `jest` scoped por fichero.

## T3-02 — npm audit (solo lectura)

Comando:

```powershell
cd backend
npm audit --omit=dev          # exit 0, 5 vulnerabilidades (1 low, 4 moderate)
npm audit --omit=dev --json   # exit 0, prod 400 / dev 387 / total 818
```

Resultado: **0 critical, 0 high, 4 moderate, 1 low**. Prohibido `npm install` / `npm audit fix` en T3 — no se cambio ninguna dependencia.

| Paquete | Severidad | Aviso | Via | Plan accion (requiere aprobacion Javier) |
|---|---|---|---|---|
| qs 2.2.5–6.15.3 | moderate | GHSA-x5fp-wj9c-mxmx array-limit bypass; GHSA-4mjr-xmp4-gh2g DoS isBuffer | directa (express/body-parser dependen de qs) | `npm audit fix` (no breaking) en ventana QA + `jest` scoped rutas + smoke `/api/ready`; dueña: cadena express→qs |
| body-parser 1.20.5–1.20.6 | moderate | depende de qs vulnerable | transitiva via qs | Se resuelve con fix de qs; verificar `package-lock` tras fix |
| express 4.22.2 | moderate | depende de qs vulnerable | transitiva via qs | Se resuelve con fix de qs; smoke completo Express |
| csv-parse <7.0.2 | moderate | GHSA-8cw4-87c7-c6xx prototype replacement via columns | directa | `npm audit fix --force` instala 7.0.2 **breaking** → NO ejecutar sin aprobacion; plan: rama aparte, revisar uso `columns` en import/export, tests `export`/`bolsa`, rollback `package-lock` |
| joi 17.1.1–17.13.5 | low | GHSA-6w3j-5fw6-r9vr proto pollution `__proto__`; GHSA-gg4h-3hg2-grpc rename+template | directa | `npm audit fix` (no breaking) en ventana QA + `jest` validacion scoped |

## Tests

Sin cambios de codigo → **jest omitido** segun spec ("jest scoped si tocaste codigo"). No se declara verde sin evidencia.

## Evidencia y estado

- `npx eslint ...` exit 1 (882 errores documentados arriba).
- `npm audit --omit=dev` exit 0 (5 vulns, 0 criticas/altas).
- `git status` previo ya dirty (workstreams ajenos); T3 añade solo `docs/audits/2026-09-25-T3-lint-audit/informe.md`.
- Intocables verificados sin diff: `backend/config/db.js`, `backend/middleware/auth.js`.
- Gate: informe en docs (aceptacion T3-02). T3-01 aceptacion alternativa "informe con conteo y plan" cumplida.
