# 05_BACKLOG_PENDIENTE — priorizado con justificación

## P0 (bloquean próximo deploy)

| ID | Pendiente | Justificación |
|---|---|---|
| B-P0-1 | Fijar `SENTRY_DSN` en servidor prod ANTES del próximo deploy | SSH inalcanzable x2 el 2026-09-28. Javier debe confirmar DSN. L10 fail-fast tumba arranque sin DSN. |
| B-P0-2 | Validación legal GDPR (bases, plazos, DPD, texto a receptores) por asesoría | Propuesta pendiente; antes de borrar nada. |

## P1 (pendiente restante)

| ID | Pendiente | Justificación |
|---|---|---|
| B-P1-1-futuro | Swap total de tipos Money en widgets | Núcleo aditivo hecho. Swap total rompería widgets fuera de jaula. Futuro. |
| B-P1-6 | Verificar PDFs/firma/tracking en dispositivo → decidir `MANAGE_EXTERNAL_STORAGE` y background location | Requiere dispositivo físico. |

## Completado post-Fase 3 (2026-09-28)

| ID | Completado | Commit |
|---|---|---|
| B-P1-3 | Split pedidos: hojas ≤500 + consts single-source | 4789f03 |
| B-P1-2 | Tanda 2: batch layer commissions + `/matrix` + `/by-client` a services | 302e542 |
| B-P1-1 | Núcleo Money aditivo + paridad | 8185f6f |
| B-P1-4 | Top-3 lint a strict 0/0 | 1bbde97 |
| B-P1-5 | Coverage ratchet 57/47/56/59, medido 59.5/49.3/64.4/61.4 | 5f5b0df |

Cobertura medida real post-Fase 3: 59.5/49.3/64.4/61.4 sobre ratchet 57/47/56/59.

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
