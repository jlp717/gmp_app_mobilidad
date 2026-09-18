# Evidencia de la auditoría

Snapshot: HEAD `0e3912abda4f27c261449440a4f52752429e96b7` más cambios locales concurrentes no publicados por esta tarea. Las líneas son localizadores de la sesión y pueden desplazarse; buscar también símbolo/claim. No todos los hechos pertenecen al commit limpio: revalidar cada archivo antes de implementar.

Cinco revisiones independientes de área, normalizadas a contrato y reducidas por código. Hay 63 hechos retenidos. Los hallazgos estáticos describen código/configuración; no son explotación demostrada ni certificación de producción.

## Controles que se conservan

Ya existen almacenamiento seguro y Hive cifrado, scope de cache, journal offline, ownership de reparto, transacciones/idempotencia, no-store financiero, límites de pool y firma Android. El plan los prueba y consolida. No ordena volver a implementarlos desde cero.

## Correcciones de interpretación

- Pinning: la lectura optimista inicial de un agente fue descartada. La [API oficial Dart](https://api.dart.dev/dart-io/HttpClient/badCertificateCallback.html) confirma que el callback se usa ante fallo de confianza, no para cada certificado válido. No se realizó MITM en dispositivo.
- Gobernanza: una spec de agosto y una decisión de ignore de septiembre discrepan. Resolver intención con Javier antes de añadir árboles enteros a Git.
- Pruebas: 123 archivos físicos bajo test no son 123 suites ni una cifra de cobertura; 25 archivos de backend/tests no eran el total backend. Los conteos no sustituyen tests.
- SQL/índices: tablas observadas en código no equivalen a catálogo QSYS2 verificado. Cifras históricas caliente/frío no son baseline actual.

## Hallazgos trazables

| ID | Observación y consecuencia | Fuente local de la sesión |
|---|---|---|
| BACKEND_DATA-01 | Conviven legacy JS, TypeScript y DDD según flags; inventariar montaje efectivo. | `backend/app.js:152` |
| BACKEND_DATA-02 | Pool alternativo TS usa BEGIN WORK; riesgo condicionado al modo, en código canónico se documenta rechazo IBM i. | `backend/src/core/infrastructure/database/db2-connection-pool.ts:81` |
| BACKEND_DATA-03 | Pool canónico ya tiene límites, adquisición, circuit breaker y timeout; no rehacer sin medición. | `backend/config/db.js:49` |
| BACKEND_DATA-04 | Timeout intenta conn.cancel; falta evidencia con driver real de liberación de locks. | `backend/config/db.js:385` |
| BACKEND_DATA-05 | Acceso general incluye protección de escritura DSEDAC; mantener y probar todas las rutas de acceso. | `backend/config/db.js:730` |
| BACKEND_DATA-06 | Confirmación canónica valida catálogo antes de transacción y bloquea clave/documento. | `backend/repositories/reparto-confirmation-db2-repository.js:370` |
| BACKEND_DATA-07 | Confirmación rechaza misma idempotency key con payload distinto. | `backend/services/reparto-confirmation-service.js:435` |
| BACKEND_DATA-08 | Liquidación bloquea día, marca fuentes y encola correo en transacción. | `backend/services/repartidor-liquidacion-service.js:615` |
| BACKEND_DATA-09 | Redis L1/L2/pubsub coexiste con SWR de hasta una hora. | `backend/services/redis-cache.js:70` |
| BACKEND_DATA-10 | HTTP cache y query cache se solapan; precisa contrato end-to-end. | `backend/middleware/http-cache.js:181` |
| BACKEND_DATA-11 | Se conserva exclusión de cache para rutas de dinero. | `backend/middleware/http-cache.js:63` |
| BACKEND_DATA-12 | Invalidación/notificaciones post-commit contienen best-effort; riesgo de consistencia diferida. | `backend/routes/repartidor-finanzas.js:1162` |
| BACKEND_DATA-13 | Outbox variaciones contiene PENDING/FAILED/SENT; lease distribuido no acreditado en alcance revisado. | `backend/services/reparto-variance-notification-service.js:718` |
| BACKEND_DATA-14 | Copias .repaired/.fromgit requieren clasificación de referencias, no borrado automático. | `backend/repositories/reparto-finance-db2-repository.js.repaired:1` |
| FLUTTER-01 | Cifrado Hive por caja y claves en almacenamiento seguro; conservar y probar recuperación. | `lib/core/storage/hive_secure_box.dart:14` |
| FLUTTER-02 | Cache segmentada por sesión/rol/vendedores; existe stale-if-error hasta 24h, requiere política por dato. | `lib/core/cache/cache_service.dart:62` |
| FLUTTER-03 | Cola offline conserva comandos y deriva operaciones antiguas a revisión; no sustituirla sin contratos. | `lib/core/offline/sync_queue_service.dart:214` |
| FLUTTER-04 | MainShell concentra navegación/UI; separar por responsabilidad conservando sincronía tabs/páginas. | `lib/features/dashboard/presentation/pages/main_shell.dart:114` |
| FLUTTER-05 | ApiClient concentra red/sesión/telemetría; extraer componentes con fachada compatible. | `lib/core/api/api_client.dart:20` |
| FLUTTER-06 | Analizador ignora diagnósticos de código/imports sin usar. | `analysis_options.yaml:25` |
| FLUTTER-07 | Importes usan double: riesgo a caracterizar con casos de redondeo, no corrupción demostrada. | `lib/features/liquidacion_comercial/domain/liquidacion_domain.dart:184` |
| FLUTTER-08 | Android main declara localización background y almacenamiento global. | `android/app/src/main/AndroidManifest.xml:7` |
| FLUTTER-09 | Android main permite HTTP a host LAN; separar debug y release. | `android/app/src/main/res/xml/network_security_config.xml:4` |
| FLUTTER-10 | WebView almacén tiene JS y canal Dart: validar mensajes y navegación, sin bypass demostrado. | `lib/features/warehouse/presentation/widgets/load_canvas.dart:42` |
| FLUTTER-11 | Tema central usa Riverpod select; requiere pruebas de todas las superficies claro/oscuro. | `lib/main.dart:385` |
| FLUTTER-12 | Linux conserva identificador de plantilla; decidir soporte antes de invertir en builds. | `linux/CMakeLists.txt:9` |
| QUALITY_OPERATIONS-01 | E2E principal en CI manual; ampliar cierre REPARTIDOR con fixtures aisladas. | `.github/workflows/flutter-tests.yml:29` |
| QUALITY_OPERATIONS-02 | Integración DB2 opt-in; hosted CI no certifica ODBC real. | `backend/tests/README.md:4` |
| QUALITY_OPERATIONS-03 | Jest collectCoverage=false, forceExit=true y detectOpenHandles=false. | `backend/jest.config.js:43` |
| QUALITY_OPERATIONS-04 | npm test permite cero pruebas; CI usa script distinto. | `backend/package.json:20` |
| QUALITY_OPERATIONS-05 | Workflows fijan distintas versiones Flutter. | `.github/workflows/quality-gates.yml:17` |
| QUALITY_OPERATIONS-06 | Workflow calidad incluye placeholder de gate de cobertura. | `.github/workflows/quality-gates.yml:116` |
| QUALITY_OPERATIONS-07 | Zero-trust relaja npm audit con \|\| true. | `.github/workflows/zero-trust-gates.yml:74` |
| QUALITY_OPERATIONS-08 | CI principal permite omitir tests y tolerar fallo de codegen. | `.github/workflows/ci-cd.yml:498` |
| QUALITY_OPERATIONS-09 | Signing Android rechaza debug signing para release; conservar control. | `android/app/build.gradle.kts:16` |
| QUALITY_OPERATIONS-10 | Distribución opcional no realizada puede acabar exit0; distinguir build/distributed/promoted. | `.github/workflows/flutter-release.yml:166` |
| QUALITY_OPERATIONS-11 | Prometheus/Loki/Tempo/dashboards y k6 contienen placeholders mínimos; no acreditan observabilidad/carga. | `observability/prometheus.yml:1` |
| QUALITY_OPERATIONS-12 | Sentry es opcional por DSN y evita PII por defecto; activación/símbolos pendientes de evidencia. | `backend/instrument.js:11` |
| QUALITY_OPERATIONS-13 | Compose usa tags mutables; revisar digest y superficie auxiliar. | `docker-compose.yml:101` |
| QUALITY_OPERATIONS-14 | Rollback legacy puede editar configuración sensible e iniciar PM2: incompatible con autonomía autorizada. | `backend/scripts/rollback.sh:37` |
| REPOSITORY-01 | Spec agosto pide kernel versionado; ignorados septiembre declaran una decisión posterior distinta. | `docs/superpowers/specs/2026-08-27-team-port-design.md:16` |
| REPOSITORY-02 | Ignore de árboles agente/gobernanza debe reconciliarse con reglas actuales y clean checkout. | `.gitignore:307` |
| REPOSITORY-03 | README documenta runtime TS/arranque distinto de npm start real. | `README.md:55` |
| REPOSITORY-04 | Makefile incluye rm y down -v: separar comandos de rutina y administrativos. | `Makefile:83` |
| REPOSITORY-05 | Scripts package mezclan desarrollo con migración/optimización/rollback. | `backend/package.json:25` |
| REPOSITORY-06 | Guard Dart domain existe y pasa; alcance limitado, ampliar contratos backend. | `scripts/check_domain_imports.mjs:9` |
| REPOSITORY-07 | Politec contiene regla sobre outputs históricos y secretos; reutilizar controles existentes. | `scripts/politec-quality-gate.ps1:120` |
| REPOSITORY-08 | Hay múltiples copias de skills; decidir fuente única y generación, no borrado por antigüedad. | `.agents/skills:1` |
| REPOSITORY-09 | Temporales tracked incluyen copia de ruta y resultados scripts; clasificación privada antes de publicación. | `backend/routes/repartidor-finanzas.js.tmp2:1` |
| REPOSITORY-10 | Docs vivos e históricos no tienen una única taxonomía de vigencia. | `docs/spec/gmp.md:31` |
| REPOSITORY-11 | Publicación backend en main coexiste con rama de trabajo test; documentar cadena de promoción. | `.github/workflows/backend-ci.yml:46` |
| SECURITY-01 | verifyToken protege /api tras rutas auth en montaje legacy. | `backend/app.js:783` |
| SECURITY-02 | Token comprueba sesión activa/revocable; proteger esta garantía en cualquier migración. | `backend/middleware/auth.js:457` |
| SECURITY-03 | Formato MAC propietario exige revisión de claims/protocolo; no se demostró bypass. | `backend/middleware/auth.js:169` |
| SECURITY-04 | badCertificateCallback no obliga pin para certificados aceptados por raíces confiables; confirmado con documentación oficial Dart. | `lib/core/api/api_client.dart:247` |
| SECURITY-05 | Android main amplía permisos de almacenamiento y ubicación. | `android/app/src/main/AndroidManifest.xml:14` |
| SECURITY-06 | Reparto aplica ownership en detalle; ampliar matriz de pruebas, no presumir IDOR existente. | `backend/routes/entregas.js:1677` |
| SECURITY-07 | Rutas de PDF/envío exigen matriz objeto/acción/scope y destinatario. | `backend/routes/facturas.js:520` |
| SECURITY-08 | CORS productivo exige orígenes explícitos y proxy loopback; mantener límites según topología real. | `backend/app.js:354` |
| SECURITY-09 | Ruta chatbot pasa mensaje/historial/contexto al orquestador sin schema estricto visible en ruta. | `backend/routes/chatbot.js:23` |
| SECURITY-10 | RUM acepta endpoint suministrado por cliente; normalizar y evitar PII en logs. | `backend/routes/telemetry.js:19` |
| SECURITY-11 | Gates SAST/lint tienen continue-on-error en workflow de calidad; uniformar required checks. | `.github/workflows/quality-gates.yml:54` |
| SECURITY-12 | HTTP cache usa scope y no-store; inventario sensible debe ser contractual. | `backend/middleware/http-cache.js:76` |

## Alcance no certificado

No se ejecutaron pentest, DAST, SSH, producción, DB2, DDL/DML, pruebas de red hostil, perfilado físico, restauración ni build release en este run. Ninguna ausencia de hallazgo prueba ausencia de vulnerabilidades. Los 31 archivos protegidos se trataron solo por metadatos; no se abrieron. La lectura de contenido fue selectiva por riesgo, no línea a línea de 220.997 archivos.

Las comprobaciones ejecutadas y sus códigos de salida están en [09-verification-report.md](09-verification-report.md).
