# Informe de ejecución — auditoría de optimización 2026-09-14

Fecha del informe: **2026-09-15**. Rama de documentación: `perf/docs-execution-report`. Base: `test`.

Ningún PR de este backlog se ha mergeado en este turno. Ningún deploy. Ningún `pm2`/`kill` en `192.168.1.230`. Intocables no tocados (`backend/config/db.js`, `backend/middleware/auth.js`, `albaran_detail_page.dart`). Cero secretos en este documento.

`01-executor-tasks.md` no está en `test`; títulos y aceptación se reconstruyeron desde el plan en transcripción `4474caf9` + PRs reales. El código actual gana sobre rutas desfasadas del plan.

Latencias de producto: **no verificado en campo**. Donde hay cifra de laboratorio (APK, Jest, sonda túnel) se etiqueta explícitamente `[lab]`, `[túnel]` o `[DB2]`. Ningún número de este informe es `[campo]`.

---

## 1. Tabla de las 41 tareas

| ID | Título | Estado | PR | Notas |
|---|---|---|---|---|
| P0-01 | Restaurar compilación release (imports faltantes) | DONE | [#5](https://github.com/jlp717/gmp_app_mobilidad/pull/5) | APK release arm64 `[lab]` 55,49 MB; `flutter test` repartidor exit 0. |
| P0-02 | Dejar de silenciar errores de compilación en el analizador | PARTIAL | [#4](https://github.com/jlp717/gmp_app_mobilidad/pull/4) | YAML+CI; `flutter analyze lib` sigue con errores de hijas. Stacked sobre P0-01. |
| P0-03 | Baseline de campo en dispositivo físico | BLOCKED | — | Tarea humana. **no verificado en campo**. |
| P0-04 | Telemetría RUM + log por request + Sentry | PARTIAL | [#3](https://github.com/jlp717/gmp_app_mobilidad/pull/3) | Tests `[lab]` verdes. Correlación `t=req`/`t=rum` y secret `SENTRY_DSN` pendientes de Javier. |
| P0-05 | Acciones manuales inmediatas en el 230 | BLOCKED | — | Comandos para Javier. **No ejecutados en 230.** |
| APP-01 | Reutilización TLS keep-alive | PARTIAL | [#6](https://github.com/jlp717/gmp_app_mobilidad/pull/6) | Analyze/tests `[lab]` verdes. **no verificado en campo**. |
| APP-02 | Timeouts y un solo reintento | PARTIAL | [#7](https://github.com/jlp717/gmp_app_mobilidad/pull/7) | Analyze/tests `[lab]` verdes. **no verificado en campo**. |
| APP-03 | Desmontar ráfaga de arranque/resume | PARTIAL | [#10](https://github.com/jlp717/gmp_app_mobilidad/pull/10) | Código en PR. **no verificado en campo**. |
| APP-04 | Refresh token: logging `AUTH_REFRESH_RESULT` | PARTIAL | [#11](https://github.com/jlp717/gmp_app_mobilidad/pull/11) | Solo logging. Sin 48 h de logs; Flutter refresh no tocado. |
| APP-05 | Rutero: paralelizar week+day + `recipientSuggestion` | PARTIAL | [#8](https://github.com/jlp717/gmp_app_mobilidad/pull/8) | Código en PR. **no verificado en campo**. |
| BE-01 | JEFE `ALL` literal + clave de caché compartida | PARTIAL | [#12](https://github.com/jlp717/gmp_app_mobilidad/pull/12) | Jest `[lab]` verde. HIT en pre/campo **no verificado en campo**. |
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
| SEC-01 | Login por nombre exacto | DONE | [#34](https://github.com/jlp717/gmp_app_mobilidad/pull/34) | Código en PR. |
| SEC-02 | Alcance `vendedorCodes` analytics/KPI | DONE | [#38](https://github.com/jlp717/gmp_app_mobilidad/pull/38) | COMERCIAL `ALL` → 403; JEFE `ALL`; comercial 80 `ALL` → equipo 72/73/81/83. |
| SEC-03 | Credencial versionada / rotar PIN | SKIP | — | Skip hasta que Javier rote el PIN. No se tocó `_deploy_finance_fix.sh`. |
| SEC-04 | Precio de línea en servidor | DONE | [#39](https://github.com/jlp717/gmp_app_mobilidad/pull/39) | ARA tarifa / mínimo; 422 si `<min` (salvo JEFE+motivo). No se cambiaron importes CPC/cobros. |
| SEC-05 | Hardening KPI + SQL parametrizado | PARTIAL | [#40](https://github.com/jlp717/gmp_app_mobilidad/pull/40) | ETL/debug JEFE; `queryWithParams` en export/clients/master. Algunos `IN` de `vendedorFilter` siguen concatenados. |
| SEC-06 | Dependencias CVE alta | BLOCKED | — | Bump multer `^2.4.0`, nodemailer `^9.1.1`, js-yaml `^4.3.2`. `npm audit --omit=dev`: 0 high/critical `[lab]`. Commit `b23aa20` **empujado a `origin/test`**; no hay PR (cero commits entre rama y `test`). |
| SEC-07 | ADR pinning TLS | DONE | [#33](https://github.com/jlp717/gmp_app_mobilidad/pull/33) | Solo documento de decisión. |

**Conteo:** DONE 18 · PARTIAL 15 · BLOCKED 6 · SKIP 1 · APP-06 cuenta como 1 tarea / 5 PRs. SEC-06 es el único ítem de código de este cierre **sin PR**.

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
| Baseline túnel HTTP (`POST /auth/login` y resto) | `[túnel]` | Socket timeout. `PROBE_EXIT=1`. **no verificado en campo**. |
| Lookup PIN `DSEDAC.VDPL1` (sonda 2026-09-14) | `[DB2]` | ~6,3 s (no es login de producto). PIN no impreso. |
| `/api/ready` LAN/túnel (re-sonda BE-04) | `[túnel]` | No responde. **no verificado en campo**. |
| HIT caché JEFE `ALL` (BE-01) | `[lab]` | Tests unitarios. HIT pre/prod **no verificado en campo**. |
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
| DB-01 | Sin gate `spec_approved` | `gate_set { name: spec_approved, value: PASS, evidence: "DB-01 LACLAE_MONTHLY EARS 2026-09-14" }`. |
| Sonda `[túnel]` | HTTP timeout | Túnel/API alcanzable; repetir probe. |
| P0-04 Sentry | Secret GitHub | Crear `SENTRY_DSN` (no pegar el valor en chat). |
| APP-04 causa 401 | Sin 48 h de `AUTH_REFRESH_RESULT` | Dejar logs y pegar histograma `reason=`. |
| SEC-03 | PIN no rotado | Javier rota PIN; **después** SEC-03. No tocar `_deploy_finance_fix.sh`. |
| **SEC-06 PR** | Commit `b23aa20` (`fix(sec): bump multer nodemailer and js-yaml for high CVEs`) está en `origin/test`. `gh pr create` falló: *No commits between test and test*. | Javier decide: dejar el bump en `test`, o revertir `test` y reabrir `perf/SEC-06-audit-deps`. **No force-push** sin orden explícita. |

---

## 5. Acciones de Javier

1. **SEC-06:** decidir destino de `b23aa20` en `origin/test` (único fallo de proceso de este cierre).
2. **P0-05 / SRV-01 / SRV-02:** solo en 230, con sus comandos; el ejecutor no los corre.
3. **P0-03:** baseline de campo (jefe de ventas en móvil). Hasta entonces toda latencia de producto es **no verificado en campo**.
4. **DB-01:** firmar `spec_approved` o dejar SKIP permanente.
5. **SENTRY_DSN** en GitHub Actions (REL-03 ya referencia el secret).
6. **Rotar PIN** antes de cualquier trabajo SEC-03.
7. **Merge:** ninguno hecho. Orden sugerido: apilar/rebase sobre `test` (varios PRs stacked). Incluye decidir si `b23aa20` ya cubre SEC-06.
8. Workstream comercial sucio en el working tree (`comercial-devoluciones*`, `comercial_liquidacion*`) **no** entra en este PR.

---

## 6. Hallazgos

- Plan `01-executor-tasks.md` ausente en `test`; varias rutas del plan estaban desfasadas. Código actual ganó (rutero DDD, `vendor-scope`, KPI alerts de comerciales).
- Comercial 80 con `ALL` no es 403: se expande a 72/73/81/83 (`userScopeCodes`).
- KPI: `requireJefeVentas` solo en etl/debug. Un `router.use` global rompería alertas comerciales.
- SEC-04 valida precio **antes** del INSERT de cabecera para no huérfano en 422.
- APP-10 no hizo el borrado masivo de 37 pantallas del plan; se conservó `albaran_detail_page.dart`.
- REL-03 no empaquetó TTF Inter/Roboto (no hay `assets/fonts`).
- Disco C: ~3,4 GB libres `[lab]`; no se limpió `build/` (umbral era <2 GB).
- Accidente de proceso: SEC-06 commit+push a `test` porque HEAD era `test` al hacer commit. No se revirtió.
- Jest y `flutter analyze` de paquetes grandes cuelgan en esta estación: kill + chequeo de fuentes; no se declara PASS de suite completa en esos casos.
- Workstream comercial paralelo (devoluciones/liquidación) coexistió en el árbol; no se mezcló en PRs de optimización.

---

## 7. Verificación de este informe

- Disco: `Get-PSDrive C` en el turno de ejecución ~3,4 GB libres; umbral de limpieza `build/` no cruzado.
- Este documento no contiene credenciales, PINs ni DSN.
- `memory-bank/activeContext.md` y `memory-bank/progress.md` actualizados en el mismo commit.
