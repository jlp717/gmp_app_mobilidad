# 01_AUDIT — Auditoría Profunda por 12 Pilares (2026-09-25, Europe/Madrid)

Base: auditoría previa 2026-09-18 (63 hallazgos + 57 paquetes backlog) verificada e incrementada. Verificación: 5 workers readonly, toda entidad citada file:line leída esta sesión. Rama test, commit base 0d0d806.

## PILAR 1 — Arquitectura y desacoplamiento
| Hallazgo | file:line | Sev | Esf | Ref previa | Propuesta |
|---|---|---|---|---|---|
| src/ TS zombie: ~90 ficheros .ts en disco pero PM2 solo ejecuta CommonJS (ecosystem.config.js:128 script server.js; USE_TS_ROUTES:false x4). Comentario app.js:48-50 dice "familia TS movida a docs/archive" pero src/ sigue activo en disco. BEGIN WORK persiste en src/core/infrastructure/database/db2-connection-pool.ts:81 (código muerto). | — | ALTO | M | H1/H2/C5 | Borrar src/ TS huérfano conservando src/modules DDD real (app.js:131 lo referencia con flag) |
| Lógica de negocio en routes: 203 SELECT inline en routes/. Ej: analytics.js:204-231 (predicción tendencia en handler), commissions.js 3073 LOC/32 SELECT, objectives.js 2886 LOC/29 SELECT | — | ALTO | XL | H1 | Extraer a services/repositories (patrón probado repartidor-rutero-orden-service.js) |
| DIP correcto en familia reparto (factory + assertPort fail-closed, reparto-confirmation-factory.js:41-48) pero pedidos/index.js 7122 LOC usa require directo config/db | — | MEDIO | L | nuevo | Extender factory/puertos a pedidos; split por caso de uso |
| Top ficheros: pedidos/index.js 7122, commissions.js 3073, objectives.js 2886, chatbot_tools.js 2842, ddd-adapters.js 2842 | — | ALTO | XL | H1 | Split por casos de uso |
| sequelize-cli NO instalado pero scripts db:migrate/db:seed en package.json:25-26 (comandos rotos); migrations/ usa .sql puro | — | MEDIO | S | H45 | Eliminar scripts rotos |
| Residuos tracked: repartidor-finanzas.js.tmp2, reparto-finance-db2-repository.js.repaired/.fromgit; backend/tmp/ con scripts exploratorios | — | MEDIO | S | H14/H49 | Borrar (REP-02) |
| Dualidad validadores: joi 306 usos vs zod 18 (5 ficheros nuevos). express-validator 0 | — | MEDIO | M | nuevo | Estandarizar zod con wrapper único; migrar joi por slices |

## PILAR 2 — Rendimiento
Backend:
- N+1 writes rutero: INSERT por fila reorden (repartidor-rutero-orden-db2-repository.js:124) y day-move (repartidor-rutero-day-move-db2-repository.js:272-290) | MEDIA | S | batch INSERT multi-row
- N+1 red: digest variance resuelve recipients 1 a 1 (reparto-variance-notification-service.js:768-775) | MEDIA | M | batch lookup
- Listados sin límite: cobros.js:210-253 portfolio scan, commissions.js:1818-1837,2637 agregados sin cap | MEDIA | S | FETCH FIRST + cursor
- Solape HTTP cache ↔ query cache sin contrato invalidación (query-optimizer.js:80 TTL 300s independiente; cobros.js:203-207 admite indeterminismo) | MEDIA | M | unificar invalidación o TTL corto + contrato test
Flutter:
- 4 derived providers sin select() sobre repartidorFinanzasProvider (repartidor_finanzas_providers.dart:601,608,620,627) | ALTA | S | select() por slice
- liquidacion_diaria_page.dart:163,170 watch full AsyncValue; main_shell.dart:2263 watch selectedVendorProvider completo; cobros_page.dart:292-300 rebuild total (página 1126 LOC) | MEDIA | S-M | Consumer por sección
- ListView sin virtualizar: products_history_page.dart:213, products_history_tab.dart:223, repartidor_panel_page.dart:194, repartidor_clientes_page.dart:252, pedidos_page.dart:2355,2500 | MEDIA | S | migrar a OptimizedListView (ya existe patrón)
- syncfusion_flutter_charts + syncfusion_flutter_calendar: 0 imports en lib/ → deps muertas (varios MB); fl_chart usado en 13 ficheros | MEDIA | S | eliminar de pubspec
- Image.network: solo 2, ambas con cacheWidth (OK)
Positivos: offline maduro, idempotencia dinero backend completa, optimistic locking real (baseRevision + LOCK TABLE, FOR UPDATE WITH RS), circuit breaker backend completo.

## PILAR 3 — Resiliencia red/estado
- Cola offline Hive persistente, maxAge 7d, backoff exponencial en policy, conflict resolution declarada LWW/FWW/merge/manual (sync_queue_service.dart:9,113-118; conflict_resolver.dart:8-23) | OK
- Retry Dio: delay FIJO 1s o Retry-After, sin exponential ni jitter (api_client.dart:1358-1453) | MEDIA | S | backoff+jitter en _retryDelayFor
- Circuit breaker Flutter: NINGUNO (0 matches; backend sí: circuit-breaker.js:20 + db.js:146) | MEDIA | M | wrapper Dio half-open por endpoint crítico

## PILAR 4 — Persistencia/concurrencia/DB2
- Outbox variance digest SIN lease: 2 workers pueden enviar email duplicado antes del UPDATE (reparto-variance-notification-service.js:711-743). Outbox liquidación SÍ tiene claim+token (repartidor-liquidacion-outbox-service.js:112,312-320) | ALTA | M | reusar patrón claim+token
- Dinero Flutter con double: 90 hits importe/precio/total en 18 ficheros domain (repartidor_finanzas_models 47, liquidacion_domain 11, rutero_delivery_validation 17); parseAmount double (liquidacion_domain.dart:160-187) | ALTA | L | céntimos int/Decimal en dominio; double solo render
- Idempotencia dinero: cobros token obligatorio + race 23505, confirmaciones unique key, liquidaciones/entregas/reverse, day-move, comercial-liquidación | OK
- Concurrencia: baseRevision+LOCK TABLE rutero, VERSION day-move, FOR UPDATE WITH RS cobros | OK (extender VERSION a más mutaciones)

## PILAR 5 — Seguridad (OWASP)
- CRÍTICO: cleartext HTTP permitido a 192.168.1.230 (IP producción) en network_security_config.xml:8 → APK release habla HTTP plano con prod | CRÍTICO | S | quitar del domain-config
- Chatbot sin schema: message ilimitado, clientCode/repartidorId sin ownership → prompt-injection + cross-tenant (chatbot.js:23-38) | ALTO | S | zod strict max 2000 + ownership cartera
- MANAGE_EXTERNAL_STORAGE innecesario (AndroidManifest.xml:14, Play Policy) | ALTO | M | eliminar, usar MediaStore/SAF
- Bypass cert dev retorna true sin guard kDebugMode (api_client.dart:262-267) | ALTO | S | envolver en if(kDebugMode)
- SQL interpolado con escape manual en VALUES CTE (cobros.js:136-159); identificadores tabla/columna interpolados (objectives.js:1577-1608, warehouse.js:112,245); SELECT dinámico (clients.js:1052, dashboard.js:269,280) | MEDIO | S-M | binds + whitelist identificadores + test estático
- facturas.js y entregas.js sin schema zod en query/params | MEDIO | M | zod params como clients.js:147-152
- Baileys WhatsApp no oficial: credenciales sesión en disco, supply-chain, ToS (whatsappBaileysService.js:25,86) | MEDIO | L | migrar a Cloud API; aislar tras flag
- ACCESS_BACKGROUND_LOCATION sin justificación visible (AndroidManifest.xml:7) | MEDIO | S | quitar o documentar para Play
- CORS dev return true (app.js:325-327) | BAJO | S | localhost explícito
Positivos: CSP/HSTS completos (security.js:399-423), login rate-limited (auth.js:38), globalLimiter, IDOR entregas con ownership (entregas.js:1675-1678), CORS prod whitelist estricta con throw, telemetry zod strict, pinning TLS fail-closed.

## PILAR 6 — Errores y observabilidad
- 3 serializadores error con shapes distintos: app.js:900-940 {error,id} vs src/middlewares/errorHandler.js:34-110 {success,code,error} | ALTA | M | unificar shape {success:false,code,error,requestId}
- ~100 clases extends Error ad-hoc pese a AppError+5 subclases (src/errors/AppError.js:8-54) | MEDIA | M | migrar gradual + guardrail "no new extends Error"
- 3 generadores requestId divergentes (uuid vs Date.now vs toString(36)) | MEDIA | S | unificar en addRequestId (security.js:742-744)
- sanitizeForLog no recursivo; logRequest loguea IP+UA (logger.js:39-61) | MEDIA | S | redacción recursiva DNI/email
- Sentry opcional try/catch (instrument.js:5-21) — decidir obligatorio o eliminar | MEDIA | S
- Observability: prometheus.yml REAL, 8 runbooks, pero stack no instalado, OTEL no-op sin deps (telemetry/otel.js:12,41) | MEDIA | L
Positivos: correlation ID con test, health live/ready separados (health-probes.js:41,46), stack nunca al cliente en prod (app.js:932-938).

## PILAR 7 — Código limpio/tipado
- CommonJS: no aplica TS strict. JSDoc @param/@returns = 0 en services clave | MEDIO | M | JSDoc APIs públicas
- 7 console.log fuera de logger (kpi/migrations, middleware/auto-cache.js:1) + ~27 en backend/tmp/ | BAJO | S | sustituir + purgar tmp/
- analysis_options.yaml:25-45 ignora unused_import, dead_code, unused_*, inference_failure_*, strict_raw_type | MEDIA | M | re-habilitar incremental
- dart analyze: 0 err / 4 warn / 6551 infos (auditoría previa) | MEDIA | L | plan deuda lint

## PILAR 8 — Testing
- 276 tests backend (23 tests/ + 238 __tests__/ + 15 TS) + 140 flutter | base razonable
- jest.config.js:43,54,55: collectCoverage:false, forceExit:true, detectOpenHandles:false | ALTA | M | forceExit solo tras cerrar pool; detectOpenHandles en CI; ratchet umbrales (32/25/31/33)
- npm test = jest --passWithNoTests (package.json:20) | MEDIA | S | quitar flag
- Integración DB2 opt-in GMP_TEST_DB2=1 read-only | OK by design
- E2E Android solo workflow_dispatch (flutter-tests.yml:29) | MEDIA | M | nightly schedule
- 1 test flutter rojo conocido: "serializa cobro+notificaciones" occurredAt futuro (FND-04) | ALTA | S | fix reloj/inyección clock

## PILAR 9 — a11y/i18n/UX
- Cobros: 1 solo Semantics en 1126 LOC (cobros_page.dart:954); offline=0 refs — sin estado offline | ALTA | M | Semantics acciones + banner offline (patrón pedidos)
- Commissions: 3000+ LOC, Semantics solo en chip | MEDIA | M
- i18n: 489 Text() literales, app ES-only B2B → YAGNI confirmado, no introducir ARB | BAJA | — | capa fina strings si futuro
- Tema: ThemeData global light+dark correcto, 0 Color(0x en features (AppColors ejemplar). Riesgo AppColors.isDark estático mutable (app_theme.dart:127) | BAJA | M | vigilar tablas custom que cacheen color
- Rutero/pedidos Semantics bien cubiertos; pedidos estados UI completos (loading 20/empty 18/error 54/offline 28 refs) | OK

## PILAR 10 — DevOps/CI/CD
- Drift Flutter: quality-gates.yml:17 y zero-trust-gates.yml:18 = 3.24.0 vs 3.35.6 en otros 7 workflows | ALTA | S | FLUTTER_VERSION única (composite action)
- skip_tests salta lint+tests+security (ci-cd.yml:13-16,105,179,244,315,378) | ALTA | S | restringir a dispatch con aprobación
- flutter-release.yml:166-169,191-194: Firebase/Telegram ausentes → exit 0 | ALTA | S | exit 1 si tag v* sin credenciales
- npm audit || true en zero-trust-gates.yml:74 | MEDIA | S | quitar || true
- Coverage placeholder echo (quality-gates.yml:114-116) | MEDIA | S | enforzar threshold o borrar step
- Tags mutables: rediscommander:latest (docker-compose.yml:101), GHCR tag branch (backend-ci.yml:92-94) | MEDIA | S | pin digest
- rollback.sh:41-49,57,73 edita .env con sed + pm2 start (PROHIBIDO) | ALTA | M | rollback = solo restart; env vía ecosystem
- Makefile:78-83 clean mezcla rm -rf + down -v (borra volumen redis) | MEDIA | S | separar clean / clean-volumes
- Versionado API: política ADR existe (/api/v1, Deprecation/Sunset, 90d) pero 0 rutas v1 montadas | MEDIA | L | próximo incompatible = primera v1
- backend-ci build-push solo main; test = checks-only | OK
- Deuda nueva sesión: 2 AAB 66MB en historial git (commit 0d0d806) | MEDIA | M | purgar historial (filter-repo) + gitignore AAB

## PILAR 11 — Cumplimiento/privacidad
- DNI + firma receptor + tracking ubicación persistidos (entregas.js:1876,1934,1988; repartidor-history-routes.js:810,951); CERO endpoint borrado/export GDPR. B2B interno pero DNI/firma de terceros = datos personales | MEDIA | L | registro tratamiento + política retención DNI/firma + minimización
- 4 XLSX datos ventas en docs/ root | MEDIA | S | mover fuera de docs/ o a datos privados

## PILAR 12 — Docs/gobernanza
- ADR numbering duplicado (2x 0001, 3x ADR-001, 2x 0002) | MEDIA | S | renumerar + índice
- Sin CHANGELOG activo (solo docs/archive/changelogs/) | MEDIA | S | CHANGELOG root o declarar tags
- CONTRIBUTING + 8 runbooks + ADR versionado API existen | OK
- Contradicciones auditoría previa resueltas: C1 (spec kernel vs gitignore → pendiente decisión Javier), C2 (README runtime TS ≠ npm start → README mal, runtime CommonJS), C3 (backend-ci main → OK by design, CERRADA), C4 (CI tolera fallos → confirmado, plan lote CI), C5 (TS vs CommonJS → runtime CommonJS confirmado, src/ zombie a borrar)
