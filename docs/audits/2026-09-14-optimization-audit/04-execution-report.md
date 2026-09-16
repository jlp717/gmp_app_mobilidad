# Informe de ejecución — auditoría de optimización 2026-09-14

Fecha del informe: **2026-09-16** (login nombre restaurado + deploy whitelist 230 + sonda `[servidor]`). Código del plan integrado en **test** (sin merge a `main`).

Deploy 2026-09-16: `git pull origin test` + `pm2 restart gmp-api` en `/opt/gmp-api`. SHA servidor = `origin/test`. Intocables no tocados (`backend/config/db.js`, `backend/middleware/auth.js`, `albaran_detail_page.dart`). Cero secretos/PIN en este documento. SEC-06 `b23aa20` se conservó.

Antes del pull el 230 estaba en `c17250e` (el código de optimización **sí** era ancestro; faltaba el restart y el fix de login). Tras deploy: SHA `1c4ee92` (incluye `711449a` login nombre).

`01-executor-tasks.md` no está en `test`; títulos y aceptación se reconstruyeron desde el plan en transcripción `4474caf9` + PRs reales. El código actual gana sobre rutas desfasadas del plan.

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
| BE-01 | JEFE `ALL` literal + clave de caché compartida | PARTIAL | [#12](https://github.com/jlp717/gmp_app_mobilidad/pull/12) | HIT `[servidor]` en evolution/by-client. Flutter facturas mandaba join ×94; hotfix `resolveScopedVendorCodes` → ALL. Dashboard metrics ALL aún expande a `IN` ×~80. |
| BE-02 | `/rutero/day` fan-out acotado | PARTIAL | [#14](https://github.com/jlp717/gmp_app_mobilidad/pull/14) | Código en PR. **no verificado en campo**. |
| BE-03 | Caché agregados históricos (interina) | PARTIAL | [#13](https://github.com/jlp717/gmp_app_mobilidad/pull/13) | Código en PR. **no verificado en campo**. |
| DB-01 | Agregados mensuales `JAVIER.LACLAE_MONTHLY` | BLOCKED | — | Spec draft; sin `spec_approved`. Sin DDL. |
| DB-02 | Propuesta de índices DSEDAC (sin DDL) | DONE | [#18](https://github.com/jlp717/gmp_app_mobilidad/pull/18) | Solo documento. Ejecutor no corre DDL. |
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
| SEC-03 | Credencial versionada / rotar PIN | DONE (código) / BLOCKED (rotar PIN) | commit en `test` | Probe de `_deploy_finance_fix.sh` lee `GMP_TEST_VENDOR` / `GMP_TEST_PIN`. Rotar PIN ERP sigue siendo Javier. |
| SEC-04 | Precio de línea en servidor | DONE | [#39](https://github.com/jlp717/gmp_app_mobilidad/pull/39) | ARA tarifa / mínimo; 422 si `<min` (salvo JEFE+motivo). No se cambiaron importes CPC/cobros. |
| SEC-05 | Hardening KPI + SQL parametrizado | PARTIAL | [#40](https://github.com/jlp717/gmp_app_mobilidad/pull/40) | ETL/debug JEFE; `queryWithParams` en export/clients/master. Algunos `IN` de `vendedorFilter` siguen concatenados. |
| SEC-06 | Dependencias CVE alta | DONE | `b23aa20` en `test` | multer `^2.4.0`, nodemailer `^9.1.1`, js-yaml `^4.3.2`. Sin PR propio. No revertido. |
| SEC-07 | ADR pinning TLS | DONE | [#33](https://github.com/jlp717/gmp_app_mobilidad/pull/33) | Solo documento de decisión. |

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
| SEC-06 | — | **BLOCKED** — ver §4 |
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
| Objetivos `GET /objectives/evolution?ALL` | `[servidor]` | frío 12205 ms; caliente 2–10 ms. |
| Objetivos `GET /objectives/by-client?ALL` | `[servidor]` | frío 19526 ms (`SLOW_QUERY` LACLAE 15116 ms); caliente 12 ms. |
| Facturas `GET /facturas?ALL` + `/summary?ALL` | `[servidor]` | lista ~1,0–1,3 s; summary 4 ms (HIT). |
| Facturas mismos endpoints con JWT join ×94 | `[servidor]` | lista 3516–4025 ms; summary frío 4749 ms. Flutter mandaba el join. |
| Dashboard `GET /metrics?ALL` | `[servidor]` | frío 3690 ms (SQL `LCCDVD IN` ×~80); caliente 3 ms. |
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
| DB-01 | Sin gate `spec_approved` | `GET /objectives/by-client` ALL escanea `DSED.LACLAE` ~15 s `[servidor]`. Requiere spec + tabla mensual. |
| Sonda `[túnel]` | HTTP timeout | Túnel/API alcanzable; repetir probe. |
| P0-04 Sentry | Secret GitHub | Crear `SENTRY_DSN` (no pegar el valor en chat). |
| APP-04 causa 401 | Sin 48 h de `AUTH_REFRESH_RESULT` | Dejar logs y pegar histograma `reason=`. |
| SEC-03 | PIN ERP no rotado | Código del probe ya usa env. Javier rota el PIN y exporta `GMP_TEST_VENDOR`/`GMP_TEST_PIN` para ejecutar el script. |
| SEC-06 | — | Código ya en `test` (`b23aa20`). Sin PR. No revertir. |

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

- Plan `01-executor-tasks.md` ausente en `test`; varias rutas del plan estaban desfasadas. Código actual ganó (rutero DDD, `vendor-scope`, KPI alerts de comerciales).
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
- Cuello que queda: `DSED.LACLAE` en `/objectives/by-client` (~15 s frío) y `/commissions/summary`; DB-01. Facturas en frío ~1 s con ALL, ~4 s con join ×94 (Flutter ahora manda ALL en catálogo jefe).

