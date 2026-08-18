---
name: best-practices
description: Manual exhaustivo de mejores practicas por pilar. Se aplica INTRINSECAMENTE en cada tarea segun el pilar detectado. Cubre backend, frontend, db2, seguridad OWASP, rendimiento, testing, arquitectura, devops, observabilidad, datos, i18n, accesibilidad. Nunca omitir.
---
# Best Practices Exhaustivas por Pilar

> ADN del equipo. No se preguntan, se aplican automaticamente segun el pilar de la tarea.

## 1. BACKEND (Node/Express/API)

### Seguridad de endpoints
- Rate limiting: SIEMPRE en endpoints publicos (por IP y por usuario).
- Auth y autorizacion ANTES de cualquier acceso a datos.
- Validacion de entrada en TODA trust boundary (Zod/Joi), incluyendo body, query, params, headers.
- Sanitizar paths contra directory traversal.
- Content-Type y size limits en uploads.
- Headers de seguridad: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
- CORS configurado explicitamente (allowlist, no wildcard con credentials).
- CSRF protection en mutaciones con sesion/cookies.

### Datos y SQL
- Peticiones a BD SOLO en backend (repositories/adapters). NUNCA desde frontend.
- Parametrizacion SQL siempre; nunca concatenar (SQL injection).
- Transacciones para operaciones multi-step; manejar rollback.
- Paginacion + orden explicito en listados. N+1 es BLOCK.
- Connection pooling.

### Robustez y errores
- Errores tipados (clases de error, no strings).
- Timeouts en toda llamada externa (DB, API, redis).
- Retry/backoff con jitter, o no_retry_reason documentado.
- Circuit breaker para dependencias fragiles.
- Idempotencia en mutaciones externas (idempotency_key).
- Graceful shutdown (SIGTERM: cerrar conexiones, drenar requests).

### API y versionado
- Versionado de API (/api/v1).
- Status codes correctos (2xx/4xx/5xx).
- Error response estandarizado (codigo, mensaje, traceId).
- Contratos con OpenAPI (api-spec-first).

### Webhooks e integraciones
- Verificar firma de webhooks antes de procesar.
- Replay protection (timestamps, nonce).

## 2. SEGURIDAD (OWASP Top 10 y mas)

- Injection (SQL, NoSQL, command): parametrizar, sanitizar.
- Broken auth: sesion segura, JWT con expiracion, refresh rotation.
- Sensitive data exposure: cifrado en transito (TLS) y en reposo.
- XXE: deshabilitar entidades externas en parsers XML.
- Broken access control: autorizacion por recurso, no solo auth.
- Security misconfiguration: sin defaults inseguros, sin debug en prod.
- XSS: escapar salida, CSP, sanitizar HTML.
- Insecure deserialization: no deserializar datos no confiables.
- Vulnerable components: auditar dependencias (npm audit, gitleaks).
- Logging/monitoring failures: logging de eventos de seguridad.
- SSRF: allowlist de URLs en fetch server-side.
- Secretos: nunca en codigo; usar env/gestor de secretos; GuardVibe/gitleaks.
- Data protection: RGPD (minimizacion, consentimiento, derecho al olvido).

## 3. DB2 / AS400 / SQL

- Verificar tablas/columnas reales (QSYS2.SYSTABLES/SYSCOLUMNS) antes de query.
- SQL set-based; sin cursores ni bucles por registro.
- Indices: revisar EXPLAIN para queries lentas.
- N+1 es BLOCK: batch, join, prefetch en mapas.
- Transacciones y niveles de aislamiento correctos.
- Paginacion (FETCH FIRST / ROW_NUMBER) + orden explicito.
- VISTA_DEUDA_BASE antes que queries complejas de deuda.
- ROW_NUMBER() para deduplicar CPC.
- DDL/DML solo con db2-write-approval + rollback + idempotencia.

## 4. FRONTEND (Flutter / Next.js)

### Estados y UX
- Estados completos SIEMPRE: loading, empty, error, offline, retry.
- Feedback inmediato en acciones (spinner, disable boton).
- Estados vacios con accion (no pantalla en blanco).
- Errores legibles, no tecnicos, para el usuario.
- Romper loop AI: diseno con personalidad, jerarquia, no generico.

### Rendimiento frontend
- Listas virtualizadas (ListView.builder / react-window).
- const widgets / memo / useMemo para evitar rebuilds.
- select() para rebuilds acotados (Riverpod/ChangeNotifier).
- Lazy loading y code splitting (deferred imports / dynamic import).
- Debounce/throttle en inputs y busqueda.
- Trabajo pesado fuera del hilo UI (isolates / web workers).
- Sin llamadas repetitivas por frame/rebuild.
- Optimizar imagenes (lazy, resize, WebP).
- Bundle size: tree-shaking, sin deps innecesarias.

### Accesibilidad (WCAG 2.2 AA)
- Contraste suficiente (texto y no-texto).
- Touch targets >= 44x44px.
- Semantics/labels en componentes interactivos.
- Navegacion por teclado/focus.
- Alternativas en imagenes (alt).

### i18n / Localizacion
- Textos centralizados en archivos de traduccion (nunca hardcode).
- Formato de fechas, numeros, moneda localizado.
- RTL si aplica.

### Offline / Datos
- Offline-first en movil: cache local primero, refresh remoto.
- Escrituras criticas offline: cola local + sync con idempotencia.
- Deteccion de conectividad.

## 5. RENDIMIENTO (global)

- Objetivo P95 < 500ms en endpoints.
- Profiling antes de optimizar (Lighthouse, clinic.js, Flutter DevTools).
- N+1 es BLOCK: batch/join/prefetch.
- Cache donde aporte (Redis, CDN, cache local) con TTL e invalidacion.
- Medir antes/despues (benchmark).
- Evitar O(n*m), serializacion innecesaria, bucles con await.
- Concurrencia limitada; evitar carreras.

## 6. TESTING

- Piramide: unit >> integration >> e2e.
- TDD en flujo critico (Test-Writer antes, Test-Specialist despues).
- Contract tests (Pact) entre frontend y backend.
- Mutation testing para validar calidad de tests.
- Coverage thresholds por feature.
- Golden tests para UI.
- Tests de borde: null, vacio, max, error.
- No tests flaky: deterministicos, sin sleeps.

## 7. ARQUITECTURA

- Capas: routes validan/delegan, services reglas, repositories DB.
- Frontera cliente-servidor: frontend nunca habla a DB directo.
- SOLID; funciones pequenas; invariantes claras.
- Reutilizacion antes de duplicar (code-autopilot + RAG).
- Archivos >1800 lineas requieren split plan.
- ADRs para decisiones de arquitectura.
- Contexto con grafo (graphify/GRAPH_REPORT) antes de editar.
- Ponytail: minimo codigo correcto, stdlib/nativo primero.

## 8. DEVOPS / CI-CD

- Pipelines: lint, test, build, deploy.
- Secretos en CI (no en repo).
- Staging primero; produccion con gate y rollback.
- Health checks (liveness/readiness).
- Feature flags para despliegues incrementales.
- Canary/blue-green para releases seguras.

## 9. OBSERVABILIDAD

- Logging estructurado (JSON, traceId, level).
- Metricas (Prometheus): latency, errores, throughput.
- Tracing distribuido para correlacionar requests.
- Alertas con SLOs y error budget.
- Sentry para errores de runtime.
- Sin console.log/print en produccion.

## 10. GLOBAL (siempre, intrinseco)

- Contexto con grafo antes de actuar.
- Ponytail: menor diff correcto.
- Headroom: comprimir contexto en sesiones largas.
- Codigo escalable, mantenible, testado.
- Metricas avanzadas, no revision humana.
