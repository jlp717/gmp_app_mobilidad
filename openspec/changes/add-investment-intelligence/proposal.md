## Why

La aplicación no dispone de un dominio de inversión ni conoce sesiones, festivos, cierres anticipados, zonas horarias, cutoffs de fondos o frescura de datos. Tratar esos estados con horarios fijos produciría avisos incorrectos; la oportunidad es añadir una plataforma de contexto financiero verificable que mejore las decisiones sin prometer resultados ni mezclarla con la Bolsa Comercial GMP.

## What Changes

- Añadir un dominio independiente de inteligencia de mercados en backend y Flutter, aislado de `bolsa` comercial y de DB2.
- Resolver el estado temporal de cada mercado por MIC, zona IANA, fecha efectiva, fase de sesión, excepciones y próxima transición, conservando instantes UTC.
- Normalizar identidad de instrumento/listing/venue y procedencia, licencia, edad y confianza de cada observación; ante evidencia insuficiente devolver `UNKNOWN` o `DEGRADED`, nunca inferir `OPEN`/`CLOSED` silenciosamente.
- Modelar fondos tradicionales mediante calendario de valoración, NAV y cutoff propios; los ETF siguen el contexto de su mercado, pero precio y NAV se muestran por separado.
- Integrar alertas configurables y deduplicadas de aperturas, cierres, cambios, incidencias y eventos, reutilizando quiet hours, snooze y notificaciones locales existentes.
- Incorporar progresivamente watchlist/cartera informativa, eventos corporativos y macro, riesgo, escenarios y explicaciones con datos y supuestos trazables.
- Introducir adaptadores intercambiables de proveedores, cache single-flight, timeout, rate-limit, fallback acotado y telemetría, manteniendo credenciales y licencias exclusivamente en backend.
- Entregar primero un vertical slice para XMAD: endpoint autenticado, festivos/cierre anticipado, frescura, estados degradados, pantalla Flutter y aviso previo al cierre.
- Excluir de este cambio órdenes reales, auto-trading, conexión directa Flutter-broker, promesas de rentabilidad, despliegue/PM2, producción y cambios DB2.

## Capabilities

### New Capabilities

- `market-session-context`: Estado multidimensional de sesiones y próximas transiciones por MIC, zona IANA, calendario, excepciones e incidencias.
- `investment-instrument-identity`: Identidad canónica y vigente de instrumentos, listings y venues sin usar ticker como clave global.
- `fund-valuation-context`: NAV, valoración, dealing calendar y cutoffs de fondos tradicionales, diferenciados de acciones y ETF.
- `market-data-resilience`: Adaptadores de proveedor, procedencia/frescura, cache, conflictos, degradación, observabilidad y protección de credenciales/licencias.
- `market-alert-orchestration`: Alertas relevantes, configurables, deduplicadas y auditables para transiciones y eventos de mercado.
- `investment-decision-support`: Contexto de cartera, eventos, riesgo, escenarios y explicaciones con guardrails de idoneidad, sin ejecución automática.

### Modified Capabilities

- Ninguna. No existen specs OpenSpec previas y la Bolsa Comercial GMP conserva íntegramente su comportamiento.

## Impact

- Backend: nuevos módulos bajo `backend/src/modules/market-intelligence/`, una route fina y un mount mínimo autenticado en `backend/server.js`.
- Flutter: nueva feature bajo `lib/features/market_intelligence/`; integración mínima con navegación y con la infraestructura de notificaciones/cache/API existente.
- Contratos: nuevos endpoints versionables, errores tipados, metadatos de procedencia/frescura y estados `DEGRADED`/`UNKNOWN`.
- Operación: selección y revisión contractual de proveedor, token solo en backend, límites de uso, atribución y métricas de disponibilidad/edad.
- Calidad: tests deterministas de MIC, DST, festivos, cierres anticipados, sesiones nocturnas, timeout, conflicto, stale/unknown, NAV/cutoff, alertas y estados Flutter.
- Riesgo: cualquier recomendación personalizada posterior requiere frontera legal, perfil/idoneidad, explicación durable, privacidad y revisión AppSec/QA antes de habilitarse.
