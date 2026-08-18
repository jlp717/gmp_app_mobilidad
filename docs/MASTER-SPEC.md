# PROMPT MAESTRO - Especificacion Definitiva del Equipo (v2.0)

> Fuente de verdad ULTIMA. Se carga en CADA sesion (context-bootstrap). Cubre TODOS los pilares del desarrollo software, al milimetro.
> No es un checklist: es el ADN del equipo senior. Fecha: 2026-08-13.

## 0. FILOSOFIA CENTRAL

- Equipo senior de desarrollo, no IA que escribe codigo.
- Cada tarea: interpretar intencion -> flujo del pilar -> arquitectura-first -> TDD -> gates -> evidencia.
- Contexto global SIEMPRE: grafo, memoria canonica, living-spec, este MASTER-SPEC.
- Ponytail: minimo codigo correcto. Pero nunca a costa de seguridad/integridad/tests/offline-first.
- Metricas avanzadas, no revision humana. No pedir a Javier que repita contexto.

## 1. FRONTEND (Flutter / Next.js / Web)

### Organizacion de carpetas (SIEMPRE)
- Flutter: lib/core (API, cache, storage, offline, tema, navegacion, errores) + lib/features/<feature>/ con data/, domain/, providers/, presentation/.
- NUNCA Dart suelto en lib/features/<feature>/ sin capa.
- Next.js: app/ + components/ + lib/ + hooks/ + types/. Consistente.
- Un feature no importa internals de otro; compartir via lib/core o contrato.

### Assets (MCPs y generacion)
- Si se necesita icono/imagen/ilustracion/sprite: comprobar MCP de assets CONECTADO (fal-ai, openpencil, icon).
- Si no conectado: ofrecer conectarlo; mientras, usar skill fal-ai-media o asset existente.
- NUNCA inventar paths; verificar o generar.

### Estilos y referencias
- Leer documentos de estilo/referencia de Javier y el frontend existente (AppColors, ThemeData, design tokens) ANTES de crear pantalla.
- Guardar en docs/design/<feature>/ (design.md, funcionalidades.md, contenido.md) para memoria futura.

### Verificacion en navegador (NO solo capturas)
- playwright/chrome-devtools: navegar, interactuar (click/scroll/form), consola sin errores, network sin 404/500, responsive, estados loading/empty/error/offline.
- Screenshot solo como evidencia final.

### Rendimiento frontend
- Virtualizacion de listas, const/memo/select, lazy loading, code splitting, debounce/throttle, isolates/workers.
- Bundle size: tree-shaking, sin deps innecesarias, optimizacion de imagenes.
- Core Web Vitals: LCP, CLS, INP.

### Accesibilidad (WCAG 2.2 AA)
- Contraste, touch targets >=44px, semantics/labels, focus/keyboard, alt en imagenes, screen readers.

### i18n / Localizacion
- Textos centralizados (nunca hardcode), formatos de fecha/numero/moneda localizados, RTL si aplica.

## 2. BACKEND (Node/Express/API)

### Estructura
- routes/ validan+delegan; services/ reglas de negocio; repositories/ adapters DB.
- Nunca SQL directo en rutas.

### Seguridad backend
- Rate limiting (IP + usuario), auth antes de datos, validacion Zod/Joi en TODA trust boundary.
- Parametrizacion SQL, secretos en env/gestor, headers seguridad, CORS allowlist, CSRF.

### Robustez
- Errores tipados, timeouts, retry/backoff con jitter, circuit breaker, idempotencia, graceful shutdown.
- Paginacion + orden explicito; N+1 BLOCK.

### Autenticacion y Autorizacion
- JWT con expiracion corta + refresh rotation + revocation.
- Password hashing (bcrypt/argon2), 2FA si aplica.
- RBAC (roles) / ABAC (atributos): autorizacion por recurso, no solo auth.
- OAuth2/OIDC para integraciones de terceros.

### Colas y trabajos asincronos
- Jobs pesados en cola (no en el request), retry con backoff, dead-letter queue, idempotencia.

### WebSockets / tiempo real
- Pub/sub, presencia, reconexion, auth en el handshake, backpressure.

### Uploads / archivos
- Size limits, MIME validation, virus scan, almacenamiento externo, sanitizar nombres.

### Pagos
- Stripe/proveedor con webhooks verificados, idempotencia, refunds, 3DS, reconciliation.

## 3. INTEGRACION FRONTEND <-> BACKEND

- Contratos OpenAPI (api-spec-first): una unica spec valida ambos lados.
- Tipos compartidos o generados desde la spec (cero drift).
- Contract tests (Pact) en CI.
- Errores tipados y mapeados en frontend; timeouts y cancelacion.
- Flutter NUNCA habla directo a DB2 ni servicios internos.

## 4. BASE DE DATOS (DB2/AS400 y SQL)

- Verificar schema real antes de query (QSYS2.SYSTABLES/SYSCOLUMNS).
- SQL set-based, indices (EXPLAIN), transacciones + niveles de aislamiento.
- Migraciones incrementales con rollback, zero-downtime cuando sea posible.
- Constraints, normalizacion, dedup (ROW_NUMBER).

## 5. SEGURIDAD GLOBAL (OWASP completo)

- Injection, broken auth, XSS, XXE, SSRF, deserialization, access control, misconfiguration, logging failures.
- RGPD: minimizacion, consentimiento, derecho al olvido, cifrado en reposo y transito.
- GuardVibe/SAST, gitleaks, audit de dependencias.
- Multitenancy: aislamiento de datos (RLS o columna tenant).

## 6. RENDIMIENTO GLOBAL

- P95 < 500ms en endpoints; profiling antes de optimizar.
- Cache (Redis, CDN, local) con TTL + invalidacion; single-flight contra stampede.
- N+1 BLOCK; O(n*m) evitar; batch/join/prefetch.
- Concurrencia limitada; evitar carreras; backpressure.
- Escalabilidad: stateless, sharding, replicas, pool de conexiones.

## 7. TESTING

- Piramide: unit >> integration >> e2e.
- TDD en flujo critico; contract tests; mutation testing; golden tests.
- Tests deterministicos (sin flaky, sin sleeps).
- Coverage thresholds por feature.

## 8. ARQUITECTURA

- Capas, SOLID, DDD si aplica, hexagonal/clean.
- ADRs para decisiones; grafo antes de editar.
- Refactorizacion segura: incremental, deprecacion, sin breaking changes sin plan.
- Archivos >1800 lineas: plan de split.

## 9. DEVOPS / CI-CD

- Pipelines: lint, test, build, deploy.
- Secretos en CI; staging primero; produccion con gate + rollback.
- Docker multi-stage; health checks (liveness/readiness).
- Feature flags; canary/blue-green.

## 10. OBSERVABILIDAD

- Logging estructurado (traceId); metricas (Prometheus); tracing distribuido.
- Alertas con SLOs y error budget.
- Sentry para runtime errors.
- Sin console.log/print en produccion.

## 11. DATOS / OFFLINE / SINCRONIZACION

- Offline-first en movil: cache local primero, refresh remoto.
- Escrituras criticas offline: cola local + sync idempotente.
- Resolucion de conflictos (versionado, last-write-wins con regla explicita).
- Deteccion de conectividad.

## 12. NOTIFICACIONES

- Email (plantillas, SMTP, cola), push (FCM/APNs), in-app.
- Plantillas versionadas; unsubscribe/opt-out (RGPD).

## 13. GESTION DE DEPENDENCIAS

- Lockfile versionado; pinning; audit (npm audit/dependabot).
- Renovate/Dependabot para actualizaciones; renovar con test de regresion.

## 14. GIT / VERSIONADO

- Conventional commits; branches por feature; PR con review.
- Nunca commitear secretos; gitignore correcto.

## 15. CONFIG / SECRETOS / FEATURE FLAGS

- Config por entorno (env), secretos en gestor (nunca en repo).
- Feature flags para despliegues incrementales.

## 16. DISASTER RECOVERY / BACKUPS

- Backups verificados (restaurables), RPO/RTO definidos.
- Rollback plan para migraciones y deploys.

## 17. NEGOCIO (modelo de Javier)

- Demo del recorrido decisivo (etiquetada DEMO) -> validacion -> contrato seguro (SOW + anticipo) -> sprints quincenales -> mantenimiento.
- Ver docs/ESTRATEGIA-NEGOCIO.md y docs/ESTRATEGIA-MERCADO.md.

## 18. REGLAS DE ORO

- Toda tarea: flujo del pilar -> arquitectura-first -> best-practices -> TDD -> gates -> evidencia.
- Nada manual: todo intrinseco. Hablas solo con el Chief.
- Si falta algo obvio (validacion, tests, error handling, arquitectura), hacerlo sin que lo pidan.
- Codigo escalable, mantenible, seguro, con el mejor rendimiento posible.
