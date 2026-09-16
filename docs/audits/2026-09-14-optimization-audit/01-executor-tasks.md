# Índice de las 41 tareas (plan 2026-09-14)

El spec completo original no estaba en `test`. Este índice es el catálogo de IDs. **Estado vivo y evidencia:** `04-execution-report.md`. No reabrir un backlog nuevo: si un ID está PARTIAL (sin `[campo]`) o BLOCKED (Javier), no hay código pendiente de ejecutor.

| ID | Título | Files touched (plan) |
|---|---|---|
| P0-01 | Restaurar compilación release | `lib/` imports faltantes |
| P0-02 | Analizador: no silenciar errores | `analysis_options.yaml`, CI |
| P0-03 | Baseline de campo | — (humano) |
| P0-04 | RUM + log por request + Sentry | app interceptor, Sentry |
| P0-05 | Acciones 230 fuera de whitelist | — (Javier) |
| APP-01 | TLS keep-alive | `lib/core/api/api_client.dart` |
| APP-02 | Timeouts y un reintento | `api_client.dart` |
| APP-03 | Ráfaga arranque/resume | providers arranque |
| APP-04 | Refresh token logging (+ 48 h) | `backend/routes/auth.js`; Flutter tras logs |
| APP-05 | Rutero week+day paralelo | `rutero_page.dart`, entregas |
| BE-01 | JEFE `ALL` literal + caché `:ALL` | `vendor-scope.js`, dashboard, planner |
| BE-02 | `/rutero/day` fan-out acotado | `planner.js`, `app.js` |
| BE-03 | Caché agregados históricos | objectives, dashboard, commissions |
| DB-01 | `JAVIER.LACLAE_MONTHLY` | migración (Javier DDL) |
| DB-02 | Propuesta índices DSEDAC | `db2-index-proposal.md` |
| BE-04 | `matrix-data` sargable | dashboard matrix |
| BE-05 | `/rutero/week` cache + sargable | planner week |
| BE-06 | Payload slim pendientes/day | entregas, rutero |
| BE-07 | Arranque degradado si DB2 cae | `app.js` / db init |
| BE-08 | Redis reconexión | redis-cache |
| BE-09 | Apagado ordenado PM2 | `app.js`, ecosystem |
| BE-10 | `GET /notifications/snapshot` | notifications |
| BE-11 | IP real Cloudflare | trust proxy |
| BE-12 | Dieta de logs | logger |
| BE-13 | `http-cache` no-store dinero | `http-cache.js` |
| BE-14 | Higiene backend | `app.js`, package.json |
| SRV-01 | Consolidar cloudflared | — (Javier) |
| SRV-02 | Higiene producción | — (Javier) |
| APP-06 | Render pantallas calientes | repartidor UI |
| APP-07 | Micro-optimizaciones render | parsing/UI |
| APP-08 | Arranque paralelo/sesión | `auth_notifier.dart` |
| APP-09 | SWR liquidación/rutero | OfflineAwareApi |
| REL-03 | Release R8/obfuscate | gradle, CI |
| APP-10 | Código muerto / dispose | controllers; no tocar `albaran_detail_page.dart` |
| SEC-01 | Login nombre | auth-claims, db2-auth (no `middleware/auth.js`) |
| SEC-02 | Alcance `vendedorCodes` | analytics, evolution, export, objectives, kpi |
| SEC-03 | Credencial versionada | `_deploy_finance_fix.sh` + rotar PIN (Javier) |
| SEC-04 | Precio de línea servidor | pedidos |
| SEC-05 | Hardening KPI + SQL params | kpi, export, clients, master, analytics |
| SEC-06 | Deps CVE alta | `backend/package.json` |
| SEC-07 | ADR pinning TLS | `docs/adr/0008-tls-pinning.md` |
