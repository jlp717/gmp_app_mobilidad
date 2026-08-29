# Modo Offline Reparto — Confirmación de entregas sin cobertura

> Diseño arquitectónico. 2026-08-29. Estado: PENDIENTE DE APROBACIÓN (gate spec_approved antes de makers).

## 1. Objetivo

Un repartidor debe poder confirmar entregas (estado, líneas, receptor, firma, fotos, cobro) **sin cobertura**, con garantía de que los datos se persisten localmente de forma durable y se suben **automáticamente** al recuperar cobertura, sin duplicados ni pérdida.

## 2. Lo que YA existe (verificado file:line esta sesión)

El repositorio ya tiene una base offline-first madura. Esto NO es desde cero absoluto: el diseño reutiliza los cimientos y cubre el único hueco crítico.

| Pieza | Evidencia |
|---|---|
| Cola de mutaciones Hive persistente con backoff, reintento, auditoría y retención 7 días | `lib/core/offline/sync_queue_service.dart:113` |
| Envoltorio offline: online→API, offline→encolar con `clientRequestId` | `lib/core/offline/offline_aware_api.dart:190` |
| Diario por entrega: estados `draft→uploading→ready→submitting→acknowledged/manualReview`, fingerprint SHA-256, idempotencyKey estable, slots de evidencia (`signature`,`photo-0..2`) | `lib/features/repartidor/data/reparto_confirmation_journal.dart:305` |
| Confirmación canónica YA se encola offline y muestra "pendiente de sincronizar" | `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart:1905-1931` (`OfflineAwareApi.post(syncType:'confirm_delivery')` → `queued:true`) |
| Drenaje al recuperar red: app-resume (`lib/main.dart:200-228` → `OfflineSyncBridge.syncAll`) + reconciler que cierra el diario | `lib/core/offline/offline_sync_bridge.dart:35`, `lib/features/repartidor/data/reparto_confirmation_offline.dart:6` |
| Backend 100% idempotente: `Idempotency-Key`→`IDEMPOTENCY_TOKEN`, índice único `UX_REP_CONFIRM_KEY`, replay `created:false`, 409 `DELIVERY_ALREADY_CONFIRMED` con `confirmationId` para reconciliar | `backend/services/reparto-confirmation-contract.js:344`, `backend/services/repartidor-finance-service.js:1488-1554`, `backend/scripts/sql/036_reparto_confirmation_production_tables.sql:9-35` |
| DDL con fingerprint, CHECKs de conservación de cantidades, FK firma→evidencia | `backend/scripts/sql/036_reparto_confirmation_production_tables.sql` |
| Lecturas offline: cache-first + stale-while-revalidate 24h en ApiClient | `lib/core/api/api_client.dart:752-768` |
| Tarea Workmanager periódica 30 min (bootstrap completo en dispatcher) | `lib/core/notifications/notification_background.dart:30-75` |

## 3. El HUECO crítico (diagnóstico)

**Las evidencias binarias (firma PNG + fotos) exigen red EN EL MOMENTO de confirmar.**

Flujo actual (`rutero_detail_modal.dart:2485` → `reparto_evidence_upload_service.dart:267` `uploadThenConfirm`):

1. El coordinador sube firma/fotos al servidor ANTES de confirmar y obtiene `evidenceId` (`ev_...`).
2. Sin cobertura ese upload lanza `RepartoEvidenceUploadException` → **la confirmación completa se aborta**.
3. El diario reserva slot + fingerprint + idempotencyKey, pero **NO guarda los bytes**.
4. Además `_failClosedIfPendingEvidenceHasNoBytes` (`reparto_evidence_upload_service.dart:332`) fuerza `manualReview` si hay slot reservado sin bytes locales ni evidenceId.

Consecuencia: hoy un ENTREGADO/PARCIAL (que exige firma obligatoria, `reparto_confirmation_request.dart:264-274`) **no se puede confirmar sin cobertura**. Solo NO_ENTREGADO (sin firma) sobreviviría encolado. Esto rompe exactamente el caso de uso pedido.

Gaps secundarios:
- **G2**: no existe UI de gestión de pendientes/fallos (la cola tiene `failedCount`/`manualReview` sin pantalla para el repartidor).
- **G3**: la tarjeta de entrega no muestra estado "pendiente de sincronizar" consultando el diario.
- **G4**: el drain no corre en background (solo con app abierta: resume/transición online).
- **G5**: la validación `ENTREGADO exige firma` (`reparto_confirmation_request.dart:306-338`) rechazaría un payload offline sin evidenceId — la confirmación offline necesita su propia forma de referir evidencias aún no subidas.

## 4. Enfoques considerados

### Opción A — Evidence Inbox + resolución de evidencias en el drain (RECOMENDADA)
Los bytes de firma/fotos se persisten localmente (Hive cifrado) en el momento de confirmar sin cobertura; la confirmación se encola referenciando los slots del diario (por fingerprint/idempotencyKey), y el drenaje resuelve cada slot ANTES del POST: sube bytes→obtiene `evidenceId`→inyecta en payload→confirma. El backend NO cambia.

- ✔ Backend intacto (cero riesgo DB2, cero migraciones, cero endpoints).
- ✔ Reutiliza el diseño existente del diario (slots con key estable ya pensados para reanudar uploads: "a retry safely resumes the same upload", `reparto_evidence_upload_service.dart:139-142`).
- ✔ Idempotencia total: uploads con `Idempotency-Key` del slot; confirm con `Idempotency-Key` del diario; replay 409 reconciliado.
- ✖ `SyncQueueService` necesita una fase de pre-proceso por operación (resolver evidencias) — cambio en el procesador de la cola.

### Opción B — Evidencias inline en el payload de confirmación (base64)
Firma/fotos viajan embebidas en el POST; el backend las materializa en `REPARTO_EVIDENCIAS` dentro de la misma transacción.

- ✔ Un solo POST atómico.
- ✖ Payloads de varios MB en cola Hive y en el pipeline DB2 (CLOB/JSON por HTTP) — riesgo real de timeouts y presión de memoria en móviles gama baja.
- ✖ Cambio de contrato backend + tests + despliegue coordinado. Mayor riesgo global.

### Opción C — Solo firma offline (fotos requieren cobertura)
- ✖ No cubre el caso real: el repartidor documenta incidencias con foto. Incompleto a propósito = deuda inmediata.

**Decisión: Opción A.** Riesgo mínimo, reutiliza cimientos verificados, backend intacto.

## 5. Diseño (Opción A)

### 5.1 Evidence Inbox (nuevo)

`lib/features/repartidor/data/reparto_evidence_inbox.dart`

- Box Hive cifrado `reparto_evidence_inbox_v1` (vía `HiveSecureBox`, igual que el diario).
- Registro por slot: `deliveryId`, `slot`, `bytes` (Uint8List), `fingerprint` (SHA-256 de bytes), `idempotencyKey` (el MISMO que reserva el diario), `savedAt`, `kind` (FIRMA/FOTO), `mimeType`.
- Límites heredados de `RepartoEvidenceUploadService`: firma ≤1 MiB PNG, foto ≤4 MiB JPEG/PNG, máx 3 fotos. Validación de magic bytes ANTES de persistir (no se persisten archivos corruptos).
- Clave de box: `deliveryId\x00slot` → un registro por slot, sobrescribe (bytes nuevos = fingerprint nuevo = conflicto controlado por el diario).
- Purga: al `acknowledge` del diario (slots ya enlazados server-side) y en `_purgeStale` (registros >7 días sin confirmación → se marcan manualReview en diario y se eliminan bytes para no llenar el disco).

### 5.2 Coordinador offline (cambio en `RepartoEvidenceConfirmationCoordinator`)

`uploadThenConfirm` gana bifurcación:

- **Online** (hoy): sube y confirma igual.
- **Offline/limited** (`ConnectivityService.currentStatus != online`): por cada evidencia con bytes → `inbox.put(...)` tras `journal.reserveEvidence(...)` (que ya valida fingerprint y estabilidad). Devuelve al caller un `RepartoUploadedEvidence` con `pendingEvidence: true` y SIN `evidenceId`s; el payload de confirmación se construye en modo diferido (5.3).
- Fail-closed existente se conserva: slot reservado sin evidenceId y sin bytes en inbox → `manualReview`.

### 5.3 Payload diferido (cambio en `RepartoConfirmationRequest`)

Cuando hay evidencias pendientes, el payload queued NO lleva `firma: ev_...`; lleva un bloque nuevo **solo en la operación encolada** (nunca en el POST final):

```json
"delivery": { ..., "firma": null, "evidencias": [],
  "pendingEvidence": { "firma": {"fingerprint":"…","idempotencyKey":"…"},
                        "fotos": [{"slot":"photo-0","fingerprint":"…","idempotencyKey":"…"}] } }
```

- La validación EARS de `RepartoConfirmationRequest` acepta `pendingEvidence` como sustituto de firma/evidencias SOLO en construcción offline (flag interno `deferEvidence`); el diario sigue exigiendo receptor válido.
- `SyncQueueService._processOperation` para `type=='confirm_delivery'`: si `payload.delivery.pendingEvidence` existe → fase 1: para cada slot, leer inbox → upload idempotente → `journal.markEvidenceUploaded` → recopilar `ev_...`; fase 2: sustituir `firma`/`evidencias` en el payload y eliminar `pendingEvidence`; fase 3: POST canónico idéntico al online. Si un upload falla por red → la operación queda en cola con backoff (los uploads exitosos NO se repiten: slot ya tiene evidenceId).
- El fingerprint del diario se calcula sobre el payload FINAL (mismo material online/offline) → un mismo intento material mantiene su idempotencyKey aunque cambie la cobertura.

### 5.4 Triggers de drenaje (consolidar)

| Trigger | Hoy | Diseño |
|---|---|---|
| App resume | `OfflineSyncBridge.syncAll` (main.dart:200) | igual |
| Transición a online | suscripción conectividad | igual (verificar gate auth) |
| Background 30 min | NO drena | **añadir** `OfflineSyncBridge.syncAll(notify:false)` en el dispatcher de Workmanager tras bootstrap; con chequeo previo de `ConnectivityStatus.online` |
| Confirmación queued | — | intento inmediato best-effort (si hay señal intermitente) |

### 5.5 UI/UX

1. **Tarjeta de entrega** (`smart_delivery_card.dart` / badges en `rutero_stop_status_badges.dart`): badge ámbar "Pendiente de sincronizar" cuando el diario tenga estado `ready/submitting` para esa entrega (consulta asíncrona al abrir la página, cachear en memoria del provider).
2. **Panel de sincronización** (nuevo widget sheet `repartidor/presentation/widgets/sync_status_sheet.dart`): accesible desde la página rutero (chip con contador) — lista pendientes (tipo, entrega, intentos, último error truncado), fallidos/manualReview con acción "Reintentar" (resetea failedAt/backoff) y "Eliminar" SOLO para manualReview con confirmación.
3. **Mensajes**: el snackbar naranja actual se conserva; se añade notificación local al completar drain ("N entregas sincronizadas") — `OfflineSyncNotifier.reportSyncRun` ya existe (`offline_sync_notifier.dart:41`).
4. Estados Semantics/contraste AppColors obligatorios (regla Flutter GMP).

### 5.6 Qué NO cambia

- Backend: **cero cambios**. Endpoints, DDL, idempotencia intactos.
- Cobros: ya viajan inline en el payload confirmación (transaccional server-side).
- `PedidosOfflineService`: fuera de scope (cola propia ya funcional).

## 6. Requisitos EARS

### Evidencias offline
- **EARS-1**: Cuando el repartidor confirma una entrega sin conectividad verificada y adjunta firma/fotos válidas, el sistema persistirá los bytes en el Evidence Inbox cifrado junto al fingerprint y idempotencyKey del slot del diario, y encolará la confirmación en modo diferido, mostrando feedback explícito de "pendiente de sincronizar".
- **EARS-2**: Cuando se recupere conectividad y el drain procese una confirmación con `pendingEvidence`, el sistema subirá cada evidencia pendiente con su `Idempotency-Key` original ANTES de enviar el POST de confirmación, e inyectará los `evidenceId` resultantes en el payload final.
- **EARS-3**: Cuando un upload de evidencia del drain falle transitoriamente, el sistema conservará la operación en cola con backoff, sin repetir uploads ya completados (slots con evidenceId no se re-suben).
- **EARS-4**: Cuando el diario acknowledge una entrega, el sistema purgará los bytes del inbox de esa entrega.
- **EARS-5**: Cuando un registro del inbox supere 7 días sin confirmación acknowledge, el sistema marcará el diario en manualReview y eliminará los bytes.
- **EARS-6**: Cuando los bytes persistidos no validen límites/formato (PNG firma ≤1 MiB, foto ≤4 MiB JPEG/PNG, máx 3), el sistema rechazará el guardado con error accionable sin encolar nada.

### Confirmación y conflictos
- **EARS-7**: Cuando el repartidor reintente una entrega con material cambiado (fingerprint distinto al registrado), el sistema forzará manualReview y no enviará el payload anterior.
- **EARS-8**: Cuando el servidor responda 409 `DELIVERY_ALREADY_CONFIRMED` con `confirmationId` válido, el sistema reconciliará el diario como acknowledged (comportamiento existente, debe seguir pasando con evidencias diferidas).
- **EARS-9**: Cuando un POST de confirmación diferida sea aceptado, el sistema ejecutará el reconciler (`defaultConfirmDeliveryReconciler`) y refrescará cachés/proveedores igual que en flujo online.

### Drenaje
- **EARS-10**: Cuando la tarea Workmanager de 30 min corra con conectividad online verificada, el sistema drenará la cola completa (evidencias + confirmaciones + pedidos) en background sin interacción del usuario.

### UI
- **EARS-11**: Cuando existan operaciones en cola o en manualReview, la página rutero mostrará un indicador con contador y acceso al panel de sincronización; cada entrega afectada mostrará badge "pendiente de sincronizar".
- **EARS-12**: Cuando el repartidor abra el panel de sincronización, podrá ver pendientes/fallidos con su estado y reintentar operaciones en backoff (manualReview solo reintentable tras confirmación explícita).
- **EARS-13**: Cuando el drain complete operaciones, el sistema notificará al usuario el número sincronizado y fallido (notificación local / snackbar según foreground).

## 7. Edge cases cubiertos

| Caso | Comportamiento |
|---|---|
| App matada durante upload de evidencia en drain | Slot sin evidenceId + bytes en inbox → próximo drain re-intenta con MISMO key (upload idempotente; si el servidor ya lo aceptó, replay devuelve mismo evidenceId) |
| Señal intermitente entre uploads | Uploads completados persisten evidenceId en diario; el reintentó continúa donde estaba |
| Repartidor edita firma tras encolar | Fingerprint nuevo ≠ registrado → manualReview (EARS-7) — el usuario ve el estado en el panel |
| 3 fotos + firma offline, solo caben 2 al subir | Operación sigue en cola; fotos ya enlazadas no se re-suben; backoff reintenta la 3ª |
| Box Hive corrompido | Decoding estricto del inbox (igual que journal codec) → entrada corrupta purgada, operación pasa a manualReview |
| Multi-entrega en cola | Drain secuencial ya garantizado por SyncQueue (orden createdAt) |
| Cobro junto a confirmación offline | Va inline en el mismo POST confirm (atómico server-side); replay protegido por token |
| Espacio disco | Purga en acknowledge + TTL 7 días; peor caso ~13 MB/entrega pendiente |

## 8. Estrategia de tests

- **Unit (Dart)**: inbox persist/purga/TTL/límites; coordinador bifurcación offline/online; payload diferido + validaciones; drain resolve (orden uploads→confirm, no-repetir slots, fallo→backoff); journal conflictos con pending evidence. Transport offline reutilizable: `test/helpers/rutero_offline_transport.dart`.
- **Widget**: badge pendiente-sync en tarjeta; panel sincronización (estados 4: loading/empty/error/offline).
- **Contract**: `OfflineAwareApi.post` queue path con evidencias; `SyncQueueService.processAllWithResult` con pre-fase evidencias.
- **Backend**: sin cambios → suite jest existente como regresión (no nuevos tests obligatorios).
- Gates: `flutter analyze` + `flutter test test/<afectada>` exit 0.

## 9. Fuera de scope (documentado)

- Offline para pedidos comerciales (cola propia ya existe).
- Tracking GPS offline batch (cola `REPARTIDOR_RUTERO_TRACKING` server-side existe, el cliente no encola muestras).
- Resolución automática de manualReview (requiere criterio de negocio humano).
- Compresión de fotos (ya ≤4 MiB validado).
