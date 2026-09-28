# 05_BACKLOG_PENDIENTE — priorizado con justificación

## P0 (bloquean próximo deploy)

| ID | Pendiente | Justificación |
|---|---|---|
| B-P0-1 | Fijar `SENTRY_DSN` en servidor prod ANTES del próximo deploy | L10 fail-fast tumba el arranque sin DSN. Sin código. |
| B-P0-2 | Validación legal GDPR (bases, plazos, DPD, texto a receptores) por asesoría | Propuesta pendiente; antes de borrar nada. |

## P1

| ID | Pendiente | Justificación |
|---|---|---|
| B-P1-1 | Money swap total | Lista exacta L8a: ~45 campos models, 9 liquidación, consumidores presentation/data, validación rutero 17 hits, entregas/facturas/cobros/bolsa. |
| B-P1-2 | Batch layer commissions + `/matrix` + `/by-client` a services | Tanda 2 L8c. |
| B-P1-3 | Split pedidos refinamiento (≤500, dedup consts, DIP config/db, stubs con impl real) | — |
| B-P1-4 | Conversión lint nº1: `repartidor-history-routes` (91 warns), `routes/objectives` (83), `services/pedidos/index` (79) | — |
| B-P1-5 | Coverage ratchet (`collectCoverage` + thresholds por encima de 32/25/31/33) + cazar handles (`test:diagnose`) + teardown pool ODBC | — |
| B-P1-6 | Verificar PDFs/firma/tracking en dispositivo → decidir `MANAGE_EXTERNAL_STORAGE` y background location | — |

## P2

| ID | Pendiente | Justificación |
|---|---|---|
| B-P2-1 | Purga historial AAB 66MB (`filter-repo` + force-push COORDINADO con Javier) | — |
| B-P2-2 | Migrar baileys → WhatsApp Cloud API (aislar tras flag primero) | — |
| B-P2-3 | Job purga GPS-90d (dry-run primero) + resto retenciones | — |
| B-P2-4 | Desplegar stack `observability/` + OTEL real (instalar deps entonces) | — |
| B-P2-5 | Servidor a Node 24 LTS → bump `engines` + lockfiles (FND-02 original) | — |
| B-P2-6 | Pin digest `docker-compose` (H39: `redis-commander:latest`, GHCR tag branch) | — |
| B-P2-7 | `resetMetrics` no limpia `httpEndpointDuration` (bug conocido) | — |
| B-P2-8 | Flutter full suite: fallos entorno liquidación widget (`HttpClient` 400 bajo `TestWidgetsFlutterBinding`) — verificar/fijar | — |
| B-P2-9 | Circuit breaker Flutter (wrapper Dio half-open) — backend ya lo tiene | — |
| B-P2-10 | Rutas `/v1/` cuando llegue primer cambio incompatible (ADR-0009 existe) | — |
| B-P2-11 | Unificar validadores joi→zod completo (hecho en rutas tocadas; resto incremental) | — |
| B-P2-12 | Endpoint requeue/manual-clear claims huérfanos variance (paridad liquidación) | — |

## Cerrados sin acción (justificado)

i18n ARB (YAGNI), H28/H51/C3 (by design), E2E nightly (hecho), XLSX (movidos), 4 hallazgos P2 falsos positivos.
