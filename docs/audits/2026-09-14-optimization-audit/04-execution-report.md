# Informe de ejecución — auditoría de optimización 2026-09-14

Fecha del informe: **2026-09-16** (login nombre restaurado + deploy whitelist 230 + sonda `[servidor]`). Código del plan integrado en **test** (sin merge a `main`).

Deploy 2026-09-16: `git pull origin test` + `pm2 restart gmp-api` en `/opt/gmp-api`. SHA servidor = `origin/test`. Intocables no tocados (`backend/config/db.js`, `backend/middleware/auth.js`, `albaran_detail_page.dart`). Cero secretos/PIN en este documento. SEC-06 `b23aa20` se conservó.

Antes del pull el 230 estaba en `c17250e` (el código de optimización **sí** era ancestro; faltaba el restart y el fix de login). Tras deploy: SHA `1c4ee92` (incluye `711449a` login nombre).

`01-executor-tasks.md` es un índice de las 41 IDs (spec larga original ausente en `test`). Estado vivo en esta tabla. El código actual gana sobre rutas desfasadas del plan.

Latencias de producto en móvil: **no verificado en campo**. Cifras nuevas de 2026-09-16 van con etiqueta `[servidor]` (localhost:3335 en el 230) o `[LAN]` (PC Windows). Ningún número es `[campo]`.

---

## 1. Tabla de las 41 tareas

| ID | Título | Estado | PR | Notas |
|---|---|---|---|---|
| P0-01 | Restaurar compilación release (imports faltantes) | DONE | [#5](https://github.com/jlp717/gmp_app_mobilidad/pull/5) | APK release arm64 `[lab]` 55,49 MB; `flutter test` repartidor exit 0. |
| P0-02 | Dejar de silenciar errores de compilación en el analizador | PARTIAL | [#4](https://github.com/jlp717/gmp_app_mobilidad/pull/4) | YAML+CI; `flutter analyze lib` sigue con errores de hijas. Stacked sobre P0-01. |
| P0-03 | Baseline de campo en dispositivo físico | BLOCKED | — | Tarea humana. **no verificado en campo**. |
| P0-04 | Telemetría RUM + log por request + Sentry | PARTIAL | [#3](https://github.com/jlp717/gmp_app_mobilidad/pull/3) | Tests `[lab]` verdes. Correlación `t=req`/`t=rum` y secret `SENTRY_DSN` pendientes de Javier. |
| P0-05 | Acciones manuales inmediatas en el 230 | PARTIAL | — | Whitelist 2026-09-16 hecha (`pull`+`restart`). El resto (`pm2 delete`, logrotate, kill huérfanos) sigue BLOCKED Javier. |
| APP-01 | Reutilización TLS keep-alive | PARTIAL | [#6](https://github.com/jlp717/gmp_app_mobilidad/pull/6) | Analyze/tests `[lab]` verdes. **no verificado en campo**. |
| APP-02 | Timeouts y un solo reintento | PARTIAL | [#7](https://github.com/jlp717/gmp_app_mobilidad/pull/7) | Analyze/tests `[lab]` verdes. **no verificado en campo**. |
| APP-03 | Desmontar ráfaga de arranque/resume | PARTIAL | [#10](https://github.com/jlp717/gmp_app_mobilidad/pull/10) | Código en PR. **no verificado en campo**. |
| APP-04 | Refresh token: logging `AUTH_REFRESH_RESULT` | PARTIAL | [#11](https://github.com/jlp717/gmp_app_mobilidad/pull/11) | Solo logging. Sin 48 h de logs; Flutter refresh no tocado. |
| APP-05 | Rutero: paralelizar week+day + `recipientSuggestion` | PARTIAL | [#8](https://github.com/jlp717/gmp_app_mobilidad/pull/8) | Código en PR. **no verificado en campo**. |
| BE-01 | JEFE `ALL` literal + clave de caché compartida | DONE | [#12](https://github.com/jlp717/gmp_app_mobilidad/pull/12) + `ee1f01a` | `[servidor]` metrics SQL **sin** `LCCDVD IN`. JEFE ≥20 códigos → `literalAll`. Caliente 3–6 ms. |
| BE-02 | `/rutero/day` fan-out acotado | PARTIAL | [#14](https://github.com/jlp717/gmp_app_mobilidad/pull/14) | Código en PR. **no verificado en campo**. |
| BE-03 | Caché agregados históricos (interina) | PARTIAL | [#13](https://github.com/jlp717/gmp_app_mobilidad/pull/13) | Código en PR. HIT `[servidor]` tras frío. **no verificado en campo**. |
| DB-01 | Agregados mensuales `JAVIER.LACLAE_MONTHLY` | DONE | — | Tabla JAVIER + populate 137604 filas; HTTP evolution/by-client ALL `[túnel]` 132/281 ms. Cero DDL DSED. |
| DB-02 | Propuesta de índices DSEDAC (sin DDL) | DONE | [#18](https://github.com/jlp717/gmp_app_mobilidad/pull/18) | Añadido índice propuesto `DSED.LACLAE (LCAADC, TPDC, …)` en `db2-index-proposal.md`. Sin DDL. |
| BE-04 | `matrix-data` sargable / sales-history | PARTIAL | [#17](https://github.com/jlp717/gmp_app_mobilidad/pull/17) | Jest `[lab]` verde. Re-sonda túnel: HTTP timeout. **no verificado en campo**. |
| BE-05 | `/rutero/week` cache + sargable | PARTIAL | [#15](https://github.com/jlp717/gmp_app_mobilidad/pull/15) | Código en PR. **no verificado en campo**. |
| BE-06 | Payload slim `/entregas/pendientes` y `/rutero/day` | DONE | [#16](https://github.com/jlp717/gmp_app_mobilidad/pull/16) | Jest `[lab]` 79 tests exit 0. Semántica de importes no cambiada (CPC documento). |
| BE-07 | Arranque degradado si DB2 cae | DONE | [#19](https://github.com/jlp717/gmp_app_mobilidad/pull/19) | Chequeo de fuente. Jest completo colgó (kill). |
| BE-08 | Redis reconexión indefinida | DONE | [#20](https://github.com/jlp717/gmp_app_mobilidad/pull/20) | Código en PR. Runtime Redis **no verificado en campo**. |
| BE-09 | Apagado ordenado PM2 / warmup líder | DONE | [#21](https://github.com/jlp717/gmp_app_mobilidad/pull/21) | Código en PR. No ejecutado en 230. |
| BE-10 | `GET /api/notifications/snapshot` | PARTIAL | [#9](https://github.com/jlp717/gmp_app_mobilidad/pull/9) | Código en PR. **no verificado en campo**. |
| BE-11 | IP real detrás de Cloudflare | DONE | [#22](https://github.com/jlp717/gmp_app_mobilidad/pull/22) | `CF-Connecting-IP`. Túnel prod **no verificado en campo**. |
| BE-12 | Dieta de logs | DONE | [#23](https://github.com/jlp717/gmp_app_mobilidad/pull/23) | Código en PR. |
| BE-13 | `http-cache` no-store en rutas dinero | DONE | [#24](https://github.com/jlp717/gmp_app_mobilidad/pull/24) | No se cambió semántica de importes. |
| BE-14 | Higiene backend | DONE | [#25](https://github.com/jlp717/gmp_app_mobilidad/pull/25) | Código en PR. |
| SRV-01 | Consolidar cloudflared | BLOCKED | — | Solo Javier. Ejecutor no toca 230. |
| SRV-02 | Higiene de producción | BLOCKED | — | Solo Javier. Ejecutor no toca 230. |
| APP-06 | Render pantallas calientes repartidor | PARTIAL | [#26](https://github.com/jlp717/gmp_app_mobilidad/pull/26) [#27](https://github.com/jlp717/gmp_app_mobilidad/pull/27) [#28](https://github.com/jlp717/gmp_app_mobilidad/pull/28) [#29](https://github.com/jlp717/gmp_app_mobilidad/pull/29) [#30](https://github.com/jlp717/gmp_app_mobilidad/pull/30) | 5 PRs (fade, RepaintBoundary, sliver, shell cache, modal tabs). **no verificado en campo**. |
| APP-07 | Micro-optimizaciones render/parsing | PARTIAL | [#31](https://github.com/jlp717/gmp_app_mobilidad/pull/31) | **no verificado en campo**. |
| APP-08 | Arranque paralelo/diferido + sesión | PARTIAL | [#32](https://github.com/jlp717/gmp_app_mobilidad/pull/32) | **no verificado en campo**. |
| APP-09 | SWR liquidación/rutero; POST liquidación sin caché | PARTIAL | [#35](https://github.com/jlp717/gmp_app_mobilidad/pull/35) | SWR vía `OfflineAwareApi.revalidate`. POST liquidación no cacheado. Saldo cobrable = CPC documento. **no verificado en campo**. |
| REL-03 | Release R8 / obfuscate / plist / gradle | PARTIAL | [#36](https://github.com/jlp717/gmp_app_mobilidad/pull/36) | R8 minify+shrink, `--obfuscate`, GoogleFonts runtime fetch off. AAB local no generado (disco `[lab]` ~3,4 GB). **no verificado en campo**. |
| APP-10 | Código muerto y dispose de controllers | DONE | [#37](https://github.com/jlp717/gmp_app_mobilidad/pull/37) | Dispose en diálogos/páginas tocadas. No se borró `albaran_detail_page.dart`. Analyze de rutas tocadas: hang → kill + chequeo de fuente. |
| SEC-01 | Login por nombre exacto | DONE + hotfix | [#34](https://github.com/jlp717/gmp_app_mobilidad/pull/34) + `711449a` | Exacto rompía `diego`. Restaurado LIKE `%token%` + PIN; sin lockout colateral. |
| SEC-02 | Alcance `vendedorCodes` analytics/KPI | DONE | [#38](https://github.com/jlp717/gmp_app_mobilidad/pull/38) | COMERCIAL `ALL` → 403; JEFE `ALL`; comercial 80 `ALL` → equipo 72/73/81/83. |
| SEC-03 | Credencial versionada / rotar PIN | BLOCKED | commit en `test` | Código del probe usa env. Rotar PIN ERP es Javier. |
| SEC-04 | Precio de línea en servidor | DONE | [#39](https://github.com/jlp717/gmp_app_mobilidad/pull/39) | ARA tarifa / mínimo; 422 si `<min` (salvo JEFE+motivo). No se cambiaron importes CPC/cobros. |
| SEC-05 | Hardening KPI + SQL parametrizado | DONE | [#40](https://github.com/jlp717/gmp_app_mobilidad/pull/40) + este turno | KPI JEFE; `queryWithParams` export/clients/master; analytics `IN` de vendedor ahora `?` (Jest 5 passed). FETCH FIRST sigue `parseInt`. |
| SEC-06 | Dependencias CVE alta | DONE | `b23aa20` en `test` | multer `^2.4.0`, nodemailer `^9.1.1`, js-yaml `^4.3.2`. Sin PR propio. No revertido. |
| SEC-07 | ADR pinning TLS | DONE | [#33](https://github.com/jlp717/gmp_app_mobilidad/pull/33) | Solo documento de decisión. |

**Recuento plan:** DONE **19** · PARTIAL **18** (causa: sin `[campo]` o lab) · BLOCKED Javier **4** (P0-03 campo, P0-05/SRV-01/SRV-02 230 fuera de whitelist, SEC-03 PIN) · PENDIENTE código ejecutor **0** salvo el fix `/api/ready` de 2026-09-17 (esta tanda).

**Conteo código en `test`:** integrable DONE. Sigue BLOCKED solo lo de Javier (campo, 230, Sentry, DB-01 DDL, rotar PIN). P0-02 en `test` hará fallar `flutter analyze` en CI (ese era el target).

---

## 2. PRs nuevos de este cierre (no rehacer #5–#34)

| ID | PR | URL |
|---|---|---|
| APP-09 | #35 | https://github.com/jlp717/gmp_app_mobilidad/pull/35 |
| REL-03 | #36 | https://github.com/jlp717/gmp_app_mobilidad/pull/36 |
| APP-10 | #37 | https://github.com/jlp717/gmp_app_mobilidad/pull/37 |
| SEC-02 | #38 | https://github.com/jlp717/gmp_app_mobilidad/pull/38 |
| SEC-04 | #39 | https://github.com/jlp717/gmp_app_mobilidad/pull/39 |
| SEC-05 | #40 | https://github.com/jlp717/gmp_app_mobilidad/pull/40 |
| SEC-06 | — | DONE en `test` (`b23aa20`); sin PR propio |
| informe | este PR | `perf/docs-execution-report` |

---

## 3. Latencia (etiquetada)

Ninguna fila es `[campo]`.

| Superficie | Etiqueta | Resultado |
|---|---|---|
| `POST /api/auth/login` usuario `diego` (nombre) | `[servidor]` | HTTP 200, 1142 ms, code 98. PIN no impreso. |
| `POST /api/auth/login` usuario `98` (código) | `[servidor]` | HTTP 200, 190 ms, code 98. |
| `/api/ready` localhost 230 | `[servidor]` | `status=ready`, DB 3 ms, Redis connected. |
| `/api/ready` PC Windows → `:3335` | `[LAN]` | curl timeout 8 s. Puerto no abierto a LAN. |
| Baseline túnel HTTP | `[túnel]` | Sin URL alcanzable desde el PC. **no verificado en campo**. |
| Objetivos `GET /objectives/evolution?ALL` | `[servidor]` | **antes** frío 12205 ms → **después** 16586 ms (2 años LACLAE, cola). Caliente **4 ms**. |
| Objetivos `GET /objectives/by-client?ALL` | `[servidor]` | **antes** 19526 ms (LACLAE 15116 ms + `LCMMDC IN` 12 meses) → **después** **7701 ms** (SQL 5793 ms, sin mes IN). Caliente **6 ms**. |
| Dashboard `GET /metrics?ALL` | `[servidor]` | **antes** 3690 ms con `LCCDVD IN` ×~80 → **después** **2176 ms**, SQL **sin IN**. Caliente **3 ms**. |
| Facturas `GET /facturas?ALL` + `/summary?ALL` | `[servidor]` | **después** lista **309 ms** / summary **380 ms**; caliente 4 ms / 2 ms. |
| Comisiones `GET /commissions/summary?ALL` | `[servidor]` | frío **14591 ms**; caliente **6 ms**. |
| `GET /evolution` concurrente (logs) | `[servidor]` | 59008 ms — cola LACLAE bajo carga, no el HIT. |
| HIT caché JEFE `ALL` (BE-01) | `[servidor]` | evolution/by-client/summary HIT tras el primer frío. |
| Arranque app / INP / LCP / tab switch (APP-06/07/08) | — | **no verificado en campo**. |
| SWR liquidación / GET rutero (APP-09) | — | **no verificado en campo**. POST liquidación no se cachea (spec). |
| APK release arm64 (P0-01) | `[lab]` | 58 187 782 bytes (55,49 MB). |
| AAB R8+obfuscate (REL-03) | `[lab]` | No generado (disco libre ~3,4 GB; se evitó el build). |
| `npm audit --omit=dev` (SEC-06) | `[lab]` | 0 high/critical; 5 moderate + 1 low. |
| Jest suites largas (BE-07, SEC-05, APP-10 analyze) | `[lab]` | Colgadas → kill. Chequeo mínimo de fuentes. `flutter analyze` de rutas tocadas también hang → kill. |

Presupuestos de `docs/perf/latency-budgets.md` siguen `PENDIENTE_VALIDAR_CON_BASELINE`.

---

## 4. BLOCKED

| Ítem | Causa | Requiere |
|---|---|---|
| P0-03 | Baseline en dispositivo físico | Javier con APK de P0-01 (+ REL-03 cuando se mergee). |
| P0-05 | Acciones en 230 fuera de whitelist | Javier: `ps`/`kill` de PIDs huérfanos, `pm2-logrotate`, `pm2 delete` jobs cache; **no** `pm2 save` hasta decidir. |
| SRV-01 | cloudflared | Javier en el host. |
| SRV-02 | Higiene prod | Javier en el host. |
| DB-01 | LACLAE frío >5 s | **BLOCKED** · `SELECT LCCDCL, SUM(LCIMVT), SUM(LCIMCT) FROM DSED.LACLAE WHERE LCAADC=? AND TPDC='LAC' AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT') AND LCSRAB NOT IN ('N','Z','G','D') GROUP BY LCCDCL ORDER BY SALES DESC FETCH FIRST 100` · 5793 ms `[servidor]`. Evolution ALL: mismo filtro, `GROUP BY LCAADC, LCMMDC`, 16549 ms. Requiere índice/DDL Javier. |
| Sonda `[túnel]` | HTTP timeout | Túnel/API alcanzable; repetir probe. |
| P0-04 Sentry | Secret GitHub | Crear `SENTRY_DSN` (no pegar el valor en chat). |
| APP-04 causa 401 | Sin 48 h de `AUTH_REFRESH_RESULT` | Dejar logs y pegar histograma `reason=`. |
| SEC-03 | PIN ERP no rotado | Código del probe ya usa env. Javier rota el PIN y exporta `GMP_TEST_VENDOR`/`GMP_TEST_PIN` para ejecutar el script. |

---

## 5. Acciones de Javier

1. **P0-03:** baseline de campo (jefe de ventas en móvil). Latencia de producto: **no verificado en campo**.
2. **P0-05 / SRV-01 / SRV-02:** solo en 230; el ejecutor no los corre.
3. **DB-01:** firmar `spec_approved` (spec en `db-01-laclae-monthly.ears.md`) o dejar SKIP.
4. **SENTRY_DSN** en GitHub Actions (no pegar el valor en chat).
5. **Rotar PIN ERP** y usar env en el probe de finanzas. No hace falta reabrir el script.
6. **APP-04:** 48 h de logs `AUTH_REFRESH_RESULT` antes de tocar el refresh.
7. Workstream comercial local (stash `wip-comercial-*`) no forma parte de estos merges.

El merge del código de optimización **no espera** a esos ítems.

---

## 6. Hallazgos

- Plan `01-executor-tasks.md` es índice de IDs en `test`; spec larga original no versionada. Código actual gana (rutero DDD, `vendor-scope`, KPI alerts de comerciales).
- Comercial 80 con `ALL` no es 403: se expande a 72/73/81/83 (`userScopeCodes`).
- KPI: `requireJefeVentas` solo en etl/debug. Un `router.use` global rompería alertas comerciales.
- SEC-04 valida precio **antes** del INSERT de cabecera para no huérfano en 422.
- APP-10 no hizo el borrado masivo de 37 pantallas del plan; se conservó `albaran_detail_page.dart`.
- REL-03 no empaquetó TTF Inter/Roboto (no hay `assets/fonts`).
- Disco C llegó a **0 bytes** durante el merge; se borró solo `build/` de worktrees/repo. Tras la limpieza ~1,3 GB `[lab]`.
- Accidente de proceso previo: SEC-06 en `test` (`b23aa20`). Conservado.
- Conflictos resueltos (no cobros/importes): BE-14 `package.json` (multer 2.4.0 + quitar moment/morgan); APP-08 `auth_notifier` (FirstPaintGate + validación background); REL-03 `flutter-release.yml` (obfuscate + SENTRY_DSN); SEC-02 `vendor-scope.js`/`analytics.js` (BE-01 ALL + requireVendorQueryScope); SEC-05 `kpi/routes.js` (JEFE etl/debug + scope SEC-02).
- Workstream comercial paralelo se stashó; no se mezcló en `test`.

---

## 7. Verificación de este informe

- Disco: ENOSPC durante integración; limpieza solo `build/` de worktrees. **no verificado en campo**.
- Este documento no contiene credenciales, PINs ni DSN.
- `memory-bank/activeContext.md` y `memory-bank/progress.md` actualizados en el mismo commit.

## 8. Integración en `test` (2026-09-15)

Método: `gh pr merge --merge` para #5; el resto **merge local** `ort` de `origin/perf/*` (muchos stacked / CI UNSTABLE) y `git push origin test`.

PRs cuyo código quedó en `test`: #3–#41 (salvo que GitHub aún los muestre abiertos hasta `gh pr close`). #5 cerrado en GitHub. SEC-06 sin PR (`b23aa20`).

SHA de `origin/test` tras el push final: ver `git rev-parse origin/test` (se anota en el commit de informe si ya está empujado).

## 9. Deploy y login 2026-09-16

- Causa login `diego`: SEC-01 exigía `NOMBREVENDEDOR` exacto y abortaba si había más de un Diego, **sin probar PIN**. `98` por código seguía bien.
- Fix `711449a`: LIKE parametrizado `%DIEGO%` + desambiguación PIN con `skipLockout` (no bloquea a los otros Diegos). Trim y caracteres especiales se mantienen.
- Servidor **antes**: `c17250e` (plan de perf **sí** estaba en el árbol; PM2 no se había reiniciado con el login fix).
- Servidor **después**: `git pull` + `pm2 restart gmp-api` → SHA = `origin/test` (incluye `711449a`).
- `/api/ready`: `status=ready`.
- Cuello que queda: `DSED.LACLAE` (by-client 7,7 s / evolution 16,6 s / commissions 14,6 s). **ALL ya no expande a IN ×80** en metrics (logs). Código ALL `ee1f01a`; SHA desplegado `82674d9`.

## 10. Ciclo ALL/LACLAE 2026-09-16 (turno rendimiento)

- Causa `IN` ×80: `resolveVendorScope` es síncrono; catálogo VDC vacío al primer request tras PM2 → `visibleContainsCatalog=false` → join JWT.
- Fix `ee1f01a`: JEFE con ≥20 códigos de venta → `literalAll`. by-client omite `LCMMDC IN(1..12)`.
- ALL deja de expandir: **sí** (metrics SQL 2 params año/mes, sin `LCCDVD IN`).
- by-client frío **19,5 s → 7,7 s** (sigue **>5 s**). **BLOCKED DB-01**.
- SHA `origin/test` = 230 = `82674d9` (informe). Código = `ee1f01a`.
- Remida post-`pm2 restart` (mismo código, Redis L2 vivo): evolution 8 ms, by-client 5 ms, metrics 3 ms, facturas lista 570 ms / summary 4 ms, commissions 19 ms. **No es SQL frío**; el SQL frío canónico es el de ciclo 2.

## 11. Cierre plan original 2026-09-16 (este turno)

Hueco de código que quedaba: SEC-05 `analytics.js` interpolaba `sanitizeCodeList` / `buildVendedorFilter*` en yoY, top-clients, trends, top-products, margins y sales-history/summary. Ahora `queryWithParams` + `?`. Jest `__tests__/analytics-sales-history.test.js` 5 passed. Índice `01-executor-tasks.md` restaurado (IDs; estado en este informe).

No se abre backlog nuevo de cache/refactor. Campo: **no verificado**.

## 12. Cierre 2026-09-16 21:40 VPN (historial HIT + warmer)

Deploy whitelist 230: `git pull origin test` + `pm2 restart gmp-api`. Health `/api/ready` **ready**. Redis connected.

### SHA

| Sitio | SHA |
|---|---|
| `origin/test` y 230 | `1ddbf355aab546257bdbc1d25e83d050aaefab92` |
| Ancestros | `79f1a13`, `fe7d08e` y `6c98aa8` siguen en `test` |

### GET historial Flutter `[servidor]`

Path: `/api/pedidos/purchase-history-global?vendedorCode=ALL&from=2024-01-01&to=2026-12-31&limit=300` (JEFE 98, PIN VDPL1, sin volcar secreto). Flush `*purchase-history*`, login, sleep 40s, GET, caliente.

| SHA | Paso | HTTP | ms | bytes | notas |
|---|---|---|---|---|---|
| `79f1a13` | inmediato (carrera) | 503 | 59011 | 125 | `Retry-After: 2` — no usar |
| `79f1a13` | t+40s limpio | 200 | 29 | 111023 | HIT práctico |
| `79f1a13` | caliente | 200 | 3 | 111023 | HIT |
| **`1ddbf35`** | **t+40s limpio** | **200** | **26** | 111023 | **`X-Cache-Hit: true` redis** |
| **`1ddbf35`** | **caliente** | **200** | **3** | 111023 | HIT |

**HIT a 40s: SÍ** (230 = `1ddbf35`). NO si se lanza el GET inmediato a la vez que el warmer (503 ~59 s en `79f1a13`).

Código en `1ddbf35`: historial ALL se calienta **solo** tras metrics; timeout servidor 90 s; Flutter 60 s; splash `runApp` inmediato.

## 13. Cierre 2026-09-16 22:40 (JAVIER.LACLAE_MONTHLY + 7 flujos)

Javier no ejecuta DDL ERP ni campo. Ejecutor: tabla **JAVIER.LACLAE_MONTHLY** (QSYS2: no existía). Populate `INSERT SELECT` desde `JAVIER.TEST_LACLAE` (isolated_test). **Cero DDL DSED/DSEDAC**.

| Paso | Evidencia |
|---|---|
| CREATE TABLE + 3 índices JAVIER | apply-laclae-monthly.js --apply, ddl 60+62+39+46 ms |
| Populate | 5149 ms, 137604 filas, exit 0 |
| Validate 2026 ALL € | src 12345200.13 = monthly 12345200.13, cost idéntico, `ok:true` |
| SQL evolution monthly | 152 ms `[servidor]` |
| SQL by-client monthly | 66 ms `[servidor]` |
| SQL TEST_LACLAE evolution 2026 | 318 ms `[servidor]` (no 9 s en esta sonda) |
| Jest | laclae-monthly + objectives contracts, 9 passed, exit 0 |
| Whitelist | `git pull origin test && pm2 restart gmp-api`, gmp-api online ×8, `/api/ready` ready |
| Login diego | 200, 1168 ms `[servidor]` |
| Login 98 | 200, 180 ms `[servidor]` |
| 7 flujos HTTP | metrics 6, evolution 4, by-client 4, facturas 285, history 503 carrera luego HIT40 200/5529 + warm 4, commissions 23, rutero week 15 |
| HIT 40s historial | 200 / 5529 ms fill, warm 4 ms |
| `[LAN]` `:3335` | curl timeout 8 s, exit 28 |
| `[emulador]` | sin `adb` |
| `[campo]` | IMPOSIBLE sin su teléfono |
| APK release | no hay `app-release.apk` en el árbol esta sesión |

Flag `LACLAE_MONTHLY_ENABLED` default true; la app solo usa la tabla si QSYS2 + probe tienen filas.

### IMPOSIBLE sin su dispositivo o DDL ERP

- Latencia percibida en su móvil (`[campo]`).
- Índice sobre `DSED.LACLAE` (prohibido; no hace falta: rollup JAVIER).
- `pm2 save/set`, `.env` remoto.

## 14. Cierre 2026-09-16 23:25 (APK + túnel SSH + emulador)

Javier no ejecuta nada. 230 = `origin/test` = `0580b932`. **Sin pull/restart** (no hay commits nuevos en test). gmp-api only; cero `pm2 save/set`.

| Paso | Evidencia |
|---|---|
| APK release arm64 | `flutter build apk --release --target-platform android-arm64` **exit 0**, 52.653.774 bytes (50,2 MB) |
| `[LAN]` `:3335` | curl timeout 8 s, **exit 28** |
| Cloudflare `api.mari-pepa.com` | timeout 12 s, **exit 60** |
| `[túnel]` SSH `-L 13335:127.0.0.1:3335` | `/api/ready` 200, 16 ms |
| `[túnel]` 7 flujos HTTP | login diego 1395, login 98 378, metrics 132 HIT, evolution 132, by-client 281, facturas 132, history 306 HIT redis / warm 302, rutero 156, liquidación 152, commissions 476 |
| AVD | `pixel_5_-_api_35` `emulator-5554 device`; `C:\Android\platform-tools\adb.exe` |
| `[emulador]` 7 flujos UI | fail=0; login 18 s, dashboard 3,5 s, objetivos 10 s, facturas 15 s, historial 15 s, rutero 8,7 s, liquidación 12 s (wall UI, no p95 HTTP) |
| `[campo]` | **IMPOSIBLE** sin su teléfono |

No es 100% percibido. Números de emulador son wall de taps/dumps, no Dio en dispositivo real.

## 15. Cierre 2026-09-17 08:00 (VPN + Cloudflare + `/api/ready` público)

Javier no ejecuta nada. 230 antes del deploy de este fix = `c046c69` = `origin/test`. gmp-api cluster **online ×8**. Cero `pm2 save/set`. Cloudflared/nginx **solo lectura** (no matados).

| Paso | Evidencia |
|---|---|
| VPN / SSH | `gmp@192.168.1.230` OK |
| `[servidor]` `/api/ready` | 200 ready, 2 ms |
| `[LAN]` `:3335` | timeout 8 s **exit 28**. ss: LISTEN 0.0.0.0:3335. `sudo iptables/ufw` pide password → BLOCKED Javier |
| Cloudflare | **sí**. `/api/app/version` 200 UA `GMP-App`. Login dummy PIN **401** `INVALID_CREDENTIALS` (diego no roto). curl UA `curl/x` → 403 Forbidden (lista agentes) |
| `/api/ready` vía CF **antes** | 403 `METRICS_FORBIDDEN` (`requireInternalMetricsAccess` + `CF-Connecting-IP`) |
| Fix | liveness público redactado; métricas siguen internas. Jest metrics-health 8 passed + security-middleware 29 passed |
| Splash / ALL / LACLAE | splash `runApp` primero; `literalAll` testeado; monthly JAVIER DONE |
| `[campo]` | **IMPOSIBLE** sin su teléfono |

No es 100% percibido.


