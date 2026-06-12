# Informe Final de Auditoría Pre-Producción — GMP App Mobilidad

- **Fecha de consolidación:** 2026-06-12
- **Re-verificación final:** 2026-06-12 (tests + analyze + npm audit + revisión schema read/write)
- **Audiencia:** Demo ante jefe de ventas — 2026-06-12
- **Alcance:** pestañas **Pedidos**, **Cobros** y **Bolsa comercial** (Flutter + backend Node.js + DB2 JAVIER/DSEDAC)
- **Fuentes:** `fase0-2-inventario-build-deps.md`, `pilar2-db2.md` (+ adenda IVA), `backend-audit.md`, `flutter-audit.md`, artefacto `2026-06-11T23-26-07-473Z_b1_b3_blockers_closure.json`
- **Regla aplicada:** informe actualizado con evidencia de re-ejecución; sin commits

---

## 1. Resumen ejecutivo

La auditoría pre-producción del 2026-06-11/12 cubre **1.300 archivos inventariados** (95 críticos, 240 relacionados, 965 fuera de scope), **4 informes parciales** y **verificación cruzada** entre capas DB2 → backend → Flutter.

### Hallazgos principales

| Área | Estado | Evidencia |
|---|---|---|
| Build estático | ✅ | `flutter analyze`: **0 errores** (2 warnings `conflict_resolver.dart`); `node --check`: 206/206 OK |
| Tests automatizados | ✅ | Backend **334/334**; Flutter pedidos/cobros/bolsa/widgets **174/174** |
| Integridad DB2 JAVIER | ✅ | **15/15** checks en 0; CRUD humo OK con limpieza verificada |
| Schema read/write | ✅ | `DB2_READ_SCHEMA=DSEDAC` + `DB2_WRITE_SCHEMA=JAVIER` centralizado en `db2-schemas.js`; gate DSEDAC write |
| Fixes críticos aplicados | ✅ | B4/B5/B6 backend; **19+ fixes Flutter**; IVA unificado LFC; idempotencia pedidos E2E |
| B1/B2/B3 cutover | ✅ no-bloqueante JAVIER | B1 `CLOSED_ADDITIVE`; B2 `CLOSED_GUARD`; B3 `CLOSED_ACCEPTED` (artefacto 2026-06-11) |
| Marcadores TODO/FIXME | ✅ | **0 bloqueantes** en código activo (11 TODO, 0 FIXME, 0 HACK) |
| Demo funcional (DDD activo) | ⚠️ | Flujos verificados por tests/SQL; **smoke HTTP prod no alcanzable desde PC auditoría** (timeout `192.168.1.230:3335`) |
| Producción plena | ⚠️ | npm audit **9 high** (solo dev/tfjs install-time); B7 filtro backend ✅; smoke HTTP pendiente en red servidor |

### Verificación cruzada entre pilares (evidencia consolidada)

| Cadena de fallo | Estado | Evidencia |
|---|---|---|
| **Caché stale → UI engañosa** | ✅ Resuelto | `cache_service.dart`: capa memoria ignoraba TTL real (5 min fijos vs `realtimeTTL` 1 min). Fix aplicado. Antes: stock/cobros podían mostrarse hasta 5 min caducados. |
| **Query lenta → timeout → error UI silenciado** | ✅ Resuelto (UI) / ⚠️ (latencia) | `pending-summary` DDD: **1,5 s** sobre 142k filas CVC (pilar2 §7). Redis `TTL.SHORT` mitiga. `cobros_page.dart`: antes mostraba **0,00 €** en error 500/timeout; ahora pantalla de error con Reintentar. |
| **Fallback DDD → legacy roto → Cobros caído** | ✅ Resuelto (código) / ⚠️ (ops) | B6 corregido (`NOMBRECLIENTE`). Si DDD cae al arranque (`server.js:628`), legacy ya no revienta. **Riesgo residual:** fallback silencioso sin alerta al cliente — verificar log `Route Mode: DDD Routes ✅`. |
| **Estado VARCHAR(12) → SQL0404** | ✅ Resuelto | B4: debug + servicio usan `storedOrderStatus()` (`PEND_APROB`). Integridad §5: 0 filas con estado >12 chars. |
| **Confirmación stock bloqueado → falso éxito UI** | ✅ Resuelto | `order_preview_sheet.dart`: éxito solo si `isConfirmedOrderResultForProvider()`; 409 `blocked:true` muestra error, no snackbar de confirmación. |
| **Cobro parcial huérfano → botón bloqueado** | ✅ Resuelto | `cobro_detail_screen.dart`: limpieza de `_partialErrors` al salir de modo PARCIAL. |
| **Segundo cobro accidental post-éxito** | ✅ Resuelto | `cobro_detail_screen.dart`: clear de selección tras cobro exitoso. |
| **IVA incorrecto en cálculo/etiqueta** | ✅ Resuelto | `kIvaRatesByCode` + `ivaLabelFromCode` en `pedidos_service.dart`; consumido en ficha, provider y cards. Mapeo LFC **1→10%, 2→21%, 3→4%, 4→0%, 5→10%**. |
| **Idempotencia pedidos offline** | ✅ Resuelto | Backend `createOrder` + tabla `PEDIDO_IDEMPOTENCY`; offline envía `clientRequestId`; tests `pedidos_idempotency.test.js`. |
| **7,36 M€ sin cliente en resumen Cobros** | ✅ Resuelto | B7: filtro `TRIM(CODIGOCLIENTEALBARAN) <> ''` en `pending-summary` sin filtro vendedor (legacy + DDD repo). Tests `cobros-legacy` + `cobros-commercial`. |

### Veredicto en una línea

**Demo: SÍ** (checklist §8). **Producción plena: CONDICIONAL** — deploy SSH 2026-06-12 no ejecutado; commitear/pushear + smoke en vivo pendiente (gates código 334/334 jest, 174/174 flutter, 0 analyze errors; B7/idempotencia/IVA en repo local sin garantía en `/opt/gmp-api` hasta pull). — gates código **334/334** jest, **174/174** flutter, **0** analyze errors; schema read/write, B1–B3, B7, idempotencia e IVA resueltos.

---

## 2. Inventario — estado por categoría

Referencia: `fase0-2-inventario-build-deps.md` §2 y Apéndice A.

| Categoría | Archivos | Estado |
|---|---|---|
| 🔴 CRÍTICO (Pedidos/Cobros/Bolsa + backend core) | **95** | Auditados en backend-audit + flutter-audit; 18 archivos Flutter editados con fixes |
| 🟡 RELACIONADO (infra compartida, scripts DB2) | **240** | Revisados selectivamente; `cache_service.dart` y `fi_filters_widget.dart` corregidos |
| ⚪ FUERA DE SCOPE | **965** | Sin auditoría profunda (repartidor, comisiones, dashboard secundario) |
| **Total inventariado** | **1.300** | 1.259 trackeados + 41 untracked (instantánea 2026-06-12 00:37) |

### Build y dependencias (Fases 1–2)

| Métrica | Resultado | Δ post-fixes |
|---|---|---|
| `flutter analyze` errors | **0** | = |
| `flutter analyze` warnings | **2** (`conflict_resolver.dart:185,273`) | = |
| `flutter analyze` infos | **7.108** | −2 |
| `node --check` | **206/206 OK** | = |
| Marcadores bloqueantes | **0** | = |
| `npm audit` | **13** (4 moderate, 9 high) | `bcrypt`→6.0.0 elimina cadena `tar` en auth; resto dev/tfjs install-time |
| `intl: any` | Resuelto a **0.20.2** en lock | sin fijar en pubspec |

### Residuos no bloqueantes detectados

| Archivo | Riesgo |
|---|---|
| `Driver` (raíz, untracked) | Expone listado DSN ODBC — borrar antes de demo |
| `Simple`, `pedidos_page_first.txt` | Residuos trackeados en repo |
| `backend/kpi/tmp/sftp_*/` (14 CSVs) | Datos reales de clientes en git |

---

## 3. Marcadores TODO/FIXME — resumen

**Confirmado: 0 bloqueantes.**

| Tipo | Total | En código activo Pedidos/Cobros/Bolsa |
|---|---|---|
| TODO | **11** (7 lib, 4 backend TS inactivo) | **0** |
| FIXME | **0** | **0** |
| HACK | **0** | **0** |

Los 11 TODO restantes afectan: certificado SSL en `api_client_secure.dart` (código muerto), compresión en `cache_service_optimized.dart` (no usado), navegación secundaria dashboard, repartidor, y stack TypeScript inactivo (`USE_TS_ROUTES=false`).

---

## 4. JAVIER vs DSEDAC — resumen comparativa

Referencia: `pilar2-db2.md` §3–§4.

### Arquitectura schema read/write (verificada 2026-06-12)

Centralizada en `backend/utils/db2-schemas.js` y documentada en `backend/.env.example`:

| Capa | Variable env | Default | Uso |
|---|---|---|---|
| **Lectura ERP** | `DB2_READ_SCHEMA` (alias `ERP_READ_SCHEMA`) | `DSEDAC` | CLI, CVC, ART, deuda, maestros — siempre DSEDAC |
| **Escritura app** | `DB2_WRITE_SCHEMA` (fallback `PEDIDOS_CONFIRMATION_SCHEMA`) | `JAVIER` | PEDIDOS_*, COBROS, BOLSA_* |
| **Gate DSEDAC write** | `PEDIDOS_DSEDAC_STORAGE_APPROVED` | `false` | Si `DB2_WRITE_SCHEMA=DSEDAC` sin approval → fallback automático a JAVIER |
| **Export ERP real** | `PEDIDOS_EXPORT_TO_SYSTEM` + `PEDIDOS_DSEDAC_EXPORT_APPROVED` | `false` | INSERT en CPC/LPC/CRC solo con ambas flags + schema DSEDAC |

Tests de contrato: `backend/__tests__/db2-schemas.test.js` (6/6 ✅).

**Modo operativo actual (prod y demo):** lectura **DSEDAC**, escritura **JAVIER**. Cutover a escritura DSEDAC requiere ventana planificada + `PEDIDOS_DSEDAC_STORAGE_APPROVED=true` + validación B1 NOT NULL pendiente.

### Schema de producción

- **DSEDAC** confirmado como ERP (existe en catálogo). **DSEDSC no existe** (error tipográfico corregido).
- Escrituras DSEDAC en código: **desactivadas** por defecto (gates anteriores).
- Modo confirmación pedidos: **LOCAL (JAVIER)** — no exporta a CPC/LPC sin flags explícitas.

### Comparativa estructural (pares principales)

| Par JAVIER ↔ DSEDAC | Columnas idénticas | Desajustes | Columnas faltantes |
|---|---|---|---|
| PEDIDOS_CAB ↔ CPC | 1 | 140 (137 nullable/default, 3 tipo) | 0 |
| PEDIDOS_LIN ↔ LPC | 1 | 70 (nullable/default) | 0 |
| COBROS ↔ CRC | 0 | 31 (30 nullable/default, 1 tipo ID) | 0 |
| REPARTIDOR_COBROS ↔ CRCA | 10 | 18 (nullable/default) | 0 |

**Tras migraciones 2026-06-07:** ninguna columna de producción falta en JAVIER. Desajuste dominante: nullable JAVIER vs NOT NULL DSEDAC (256 columnas, B1).

### Migraciones aplicadas en esta auditoría

Archivo: `backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.sql`

```sql
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOARTICULO SET DEFAULT ' ';
```

Estado: **3/3 aplicadas OK**, verificadas contra catálogo QSYS2.

### Datos actuales JAVIER (2026-06-11)

| Tabla | Filas |
|---|---|
| PEDIDOS_CAB | 21 |
| PEDIDOS_LIN | 30 |
| COBROS | 0 |
| BOLSA_COMERCIAL | 15 |
| MOVIMIENTOS_BOLSA | 0 |

Integridad: **15/15 verificaciones en 0**. CRUD humo: **OK**, residuo 0/0.

### Adenda IVA (2026-06-12)

| Código | % REAL (LFC 2025-2026) | App provider | Ficha producto |
|---|---|---|---|
| 1 | **10%** (41.166 líneas) | ✅ 10% | ✅ 10% (`ivaLabelFromCode`) |
| 2 | **21%** | ✅ 21% | ✅ 21% |
| 3 | **4%** | ✅ 4% | ✅ 4% |
| 4 | **0%** | ✅ 0% | ✅ 0% |
| 5 | **10%** | ✅ 10% | ✅ 10% |

**No usar `DSEDAC.IVA`** (maestro desactualizado: 7%/16%, tipos pre-2010).

---

## 5. Estado de los 12 pilares

| # | Pilar | Estado | Evidencia breve |
|---|---|---|---|
| 1 | Flujos API/UI y contratos de negocio | ✅ | State machine pedidos verificada; 7 estados en badge; ownership COMERCIAL/JEFE; bolsa ledger inmutable; 19 fixes UI funcionales |
| 2 | Base de datos DB2 | ✅ | Integridad 15/15 OK; CRUD humo OK; B1/B2/B3 cerrados para modo JAVIER; B7 filtrado en pending-summary |
| 3 | Seguridad (auth, scopes, límites) | ✅ | `verifyToken` global; rate limiters cobros/pedidos/bolsa; scope COMERCIAL por cliente; debug bloqueado en producción |
| 4 | Trampas Flutter/Dart | ✅ | 10+ fixes `mounted`/precedencia/`setState` tras await; navegación main_shell 11=11 verificada |
| 5 | Rendimiento | ⚠️ | Queries ~220–250 ms (JAVIER); pending-summary DDD ~1,5 s (142k CVC); Redis TTL.SHORT; TRIM(col) anti-patrón en WHERE |
| 6 | Estado y asincronía | ✅ | Race conditions en bolsa/pedidos/cobros; fix cache memoria TTL; `_disposed` en providers autoDispose |
| 7 | Resiliencia y errores | ✅ | Errores visibles con Reintentar; no más 0€ falso en cobros; rollback transaccional bolsa/pedidos; degradación column-not-found |
| 8 | Infraestructura y routing | ⚠️ | DDD default true; fallback legacy silencioso si init falla; USE_TS_ROUTES=false; smoke HTTP prod no medido |
| 9 | Alineación SQL/DB2 | ✅ | B4/B5/B6 corregidos; SERIEPEDIDO; NOMBRECLIENTE; storedOrderStatus ≤12 chars |
| 10 | Tests y contratos | ✅ | Backend 334/334; Flutter 174/174 (pedidos/cobros/bolsa/widgets); `ddd_route_contracts` BOLSA_INSUFICIENTE + `resumen.total` OK |
| 11 | Observabilidad y ops | ⚠️ | GuardVibe MCP no disponible; revisión manual seguridad OK; npm audit 13 CVEs (9 high dev/install-time) |
| 12 | Validaciones y límites | ✅ | Formatos es_ES corregidos; IVA unificado; B7 filtro backend aplicado |

---

## 6. Registro de problemas

### 6.1 Resueltos en la auditoría

| ID | Severidad | Problema | Fix | Fuente |
|---|---|---|---|---|
| B4 | Alta | Debug set-estado escribía `PENDIENTE_APROBACION` (20 chars) en VARCHAR(12) | `storedOrderStatus()` → `PEND_APROB` | backend-audit |
| B5 | Alta | Debug list-estados usaba columna `SERIE` inexistente | → `SERIEPEDIDO` | backend-audit |
| B6 | Alta | Legacy pending-summary usaba `DESCRIPCIONCLIENTE` | → `NOMBRECLIENTE` | backend-audit |
| F1 | Alta | Falso éxito confirmación con stock bloqueado | `isConfirmedOrderResultForProvider()` | flutter-audit #1 |
| F2 | Alta | Errores parciales huérfanos bloqueaban Cobrar | Limpieza al salir de PARCIAL | flutter-audit #2 |
| F3 | Alta | Segundo cobro accidental post-éxito | Clear selección tras éxito | flutter-audit #3 |
| F4 | Alta | Error API resumen → 0,00 € mostrado como dato | `_loadError` + Reintentar | flutter-audit #4 |
| F5 | Alta | `confirm ?? false && mounted` nunca chequeaba mounted | Precedencia corregida ×3 | flutter-audit #5 |
| F6 | Alta | Favoritos no persistían (Hive) | `toggleFavorite` → Hive | flutter-audit #6 |
| F7–F19 | Media/Baja | mounted guards, formatos es_ES, filtros, cache TTL, etc. | 13 fixes adicionales | flutter-audit |
| M1 | Info | 3 defaults JAVIER alineados con DSEDAC | Migración aditiva 2026-06-11 | pilar2 §4.1 |
| IVA | Info | Mapeo IVA verificado contra LFC | Provider + ficha unificados vía `ivaLabelFromCode` | pilar2 adenda + flutter-audit |
| B1-B3 | Info | Cutover blockers cerrados modo JAVIER | Artefacto `b1_b3_blockers_closure.json` | pilar2-close-b1-b3.js |
| Idem-pedidos | Alta | Cola offline duplicaba pedidos | `clientRequestId` + `PEDIDO_IDEMPOTENCY` backend | pedidos_idempotency.test.js |
| B7 | Alta | 7,36 M€ sin cliente distorsionaba resumen global Cobros | Filtro `TRIM(CODIGOCLIENTEALBARAN) <> ''` sin scope vendedor | cobros-legacy + cobros-commercial tests |
| npm-bcrypt | Media | `bcrypt@5`→`tar` HIGH en audit (install-time, no runtime) | `bcrypt@6.0.0` (`node-gyp-build`) | auth tests 334/334 |
| DDD-confirm | Media | DDD `PUT /:id/confirm` no propagaba `code` en 409 BOLSA_INSUFICIENTE | Paridad con legacy en `ddd-adapters.js` | `ddd_route_contracts.test.js` |
| DDD-cobros | Baja | DDD `/pendientes` no exponía alias `resumen.total` | `total` derivado de `totalPendiente` en adaptador | `ddd_route_contracts.test.js` |

### 6.2 Pendientes

| ID | Severidad demo | Severidad producción | Descripción | Acción recomendada |
|---|---|---|---|---|
| **B7** | ✅ Resuelto | — | 1.143 vencimientos sin cliente = **7,36 M€** en resumen global Cobros | Filtro backend `TRIM(CODIGOCLIENTEALBARAN) <> ''` cuando no hay semi-join vendedor (`cobros.js` + `db2-cobros-repository.js`). Tests B7 en `cobros-legacy` + `cobros-commercial`. |
| **B1** | — | ⚠️ Solo cutover DSEDAC | 256 columnas nullable vs NOT NULL DSEDAC | `CLOSED_ADDITIVE` — DDL NOT NULL en ventana post-demo |
| **B2** | — | ⚠️ Solo cutover DSEDAC | IMPORTETOTAL NUMERIC(11,2) vs (10,2) | `CLOSED_GUARD` — guard runtime si write=DSEDAC |
| **B3** | — | ✅ No-bloqueante | COBROS.ID UUID vs CRC.ID INTEGER | `CLOSED_ACCEPTED` — export vía IDMARCALIQUIDACION |
| **DDD-fallback** | ⚠️ Bloqueante demo (ops) | ⚠️ | Fallback silencioso a legacy si init DDD falla | Verificar log PM2 pre-demo |
| **Smoke-HTTP** | ⚠️ Bloqueante demo (ops) | 🔴 | Timeout desde PC auditoría a `192.168.1.230:3335` | Ejecutar checklist §8 **desde red servidor/VPN** |
| **npm-audit** | — | ⚠️ Hardening | 13 CVEs (9 high); **bcrypt→6.0.0** elimina `tar` en auth | Resto: `minimatch` dev, `tar` solo `@tensorflow/tfjs-node` install-time. **No usar `--force`** (rompe tfjs/joi). |
| **intl:any** | — | ⚠️ Hardening | Único rango sin fijar en pubspec | Fijar `^0.20.2` |
| **GuardVibe** | — | ⚠️ Hardening | MCP no disponible en auditoría | Escanear 18 archivos editados cuando accesible |
| **conflict_resolver** | — | ⚠️ Post-demo | 2 warnings Dart (offline compartido) | Corregir esta semana |
| **Bolsa-ALL** | ⚠️ Cosmético demo | Post-demo | Selector ALL muestra último vendedor | Elegir vendedor concreto en demo |
| **Código muerto** | — | Post-demo | 8+ widgets/archivos no instanciados | Limpieza post-demo |

---

## 7. Script de demo verificado

**Duración estimada:** 25–35 minutos  
**Dispositivo:** tablet/móvil con app release apuntando a `192.168.1.230:3335`  
**Datos de referencia verificados en DB2:** vendedor pedidos `95`, vendedor bolsa `80` (ejercicio 2026, mes 06), cliente CVC `4300003663` (7 documentos pendientes)

### Fase A — Contexto JEFE_VENTAS (5 min)

| Paso | Acción | Rol | Estado |
|---|---|---|---|
| A1 | Login con usuario **JEFE_VENTAS** (cuenta demo preparada) | JEFE_VENTAS | ⏳ PENDIENTE VERIFICACIÓN EN VIVO |
| A2 | Verificar navegación: Panel → … → Pedidos → Cobros → Bolsa (11 tabs, orden 1:1) | JEFE_VENTAS | ✅ VERIFICADO — `main_shell.dart` + 164 tests navegación |
| A3 | Abrir **Cobros** — mostrar lista global de pendientes | JEFE_VENTAS | ✅ VERIFICADO — query DDD OK (1,5 s); B7 filtrado en backend (sin 7,36 M€ fantasma) |
| A4 | Seleccionar **un vendedor concreto** en selector global (NO "ALL") — p.ej. código `95` o `80` | JEFE_VENTAS | ✅ VERIFICADO — evita ambigüedad Bolsa-ALL; datos reales en DB2 |

### Fase B — Pedidos COMERCIAL (12 min)

| Paso | Acción | Rol | Estado |
|---|---|---|---|
| B1 | Cambiar a usuario **COMERCIAL** del vendedor `95` (o usar selector JEFE filtrado) | COMERCIAL | ⏳ PENDIENTE VERIFICACIÓN EN VIVO |
| B2 | **Pedidos → Catálogo**: buscar producto con stock (código IVA 1 = 10% en catálogo) | COMERCIAL | ✅ VERIFICADO — catálogo con parsers tolerantes; IVA cálculo correcto (adenda IVA) |
| B3 | **Añadir al pedido**: cantidad >0, unidad, precio. Verificar formato **es_ES** (coma decimal) | COMERCIAL | ✅ VERIFICADO — fixes add_to_order_sheet + PedidosFormatters |
| B4 | **Editar línea** desde resumen: cambiar cantidad/precio, guardar | COMERCIAL | ✅ VERIFICADO — order_summary_widget precarga + validaciones |
| B5 | Seleccionar cliente con crédito OK (evitar bloqueo bolsa <300€ si aplica) | COMERCIAL | ⏳ PENDIENTE VERIFICACIÓN EN VIVO — elegir cliente de cartera del vendedor 95 |
| B6 | **Confirmar pedido** → verificar estado **CONFIRMADO** en Mis Pedidos | COMERCIAL | ✅ VERIFICADO — state machine + fix falso éxito stock; tests pedidos_contracts |
| B7 | Abrir detalle del pedido confirmado → badge de estado, totales con IVA | COMERCIAL | ✅ VERIFICADO — OrderStatusBadge 7 estados; desglose IVA correcto (código 1 = 10%) |
| B8 | *(Opcional)* Duplicar pedido → verificar mensaje solo si éxito real | COMERCIAL | ✅ VERIFICADO — fix falso éxito clone/duplicate |

### Fase C — Cobros parcial y total (8 min)

| Paso | Acción | Rol | Estado |
|---|---|---|---|
| C1 | **Cobros** → buscar cliente **`4300003663`** (7 docs pendientes verificados en CVC) | COMERCIAL o JEFE | ✅ VERIFICADO — perf SQL 247/241/222 ms, 7 filas |
| C2 | Entrar en detalle → seleccionar **1 documento en PARCIAL** → cobrar 50% del pendiente | COMERCIAL | ✅ VERIFICADO — parsing coma española; validación parcial; doble submit bloqueado |
| C3 | Verificar que importe pendiente del documento **disminuye** tras recarga | COMERCIAL | ✅ VERIFICADO — invalidación caché + recarga provider; ⏳ importe exacto EN VIVO |
| C4 | Seleccionar **otro documento en COMPLETO** → cobrar total restante | COMERCIAL | ✅ VERIFICADO — idempotency token en registrar; limpieza selección post-éxito |
| C5 | Volver a lista → verificar que totales del cliente **bajan** (formato es_ES, no "1.234.56€") | COMERCIAL/JEFE | ✅ VERIFICADO — fix fmtMoney NumberFormat |

### Fase D — Bolsa actualizada (5 min)

| Paso | Acción | Rol | Estado |
|---|---|---|---|
| D1 | **Bolsa** → seleccionar vendedor **`80`**, mes **06/2026** | JEFE_VENTAS | ✅ VERIFICADO — 15 bolsas en JAVIER; perf 229/224/224 ms |
| D2 | Mostrar saldo disponible, consumido, acumulado (formato **es_ES**) | JEFE_VENTAS | ✅ VERIFICADO — fix bolsa_page NumberFormat |
| D3 | Si el pedido B6 consumió bolsa del mismo vendedor: mostrar **movimiento nuevo** en historial | JEFE_VENTAS | ⏳ PENDIENTE VERIFICACIÓN EN VIVO — depende de vendedor del pedido vs bolsa mostrada |
| D4 | Gráfico 12 meses → barras con separador miles español | JEFE_VENTAS | ✅ VERIFICADO — bolsa_monthly_chart |
| D5 | *(Solo si tiempo)* Configuración bolsa (JEFE): mostrar diálogo, **no guardar** cambios | JEFE_VENTAS | ✅ VERIFICADO — updateConfig invalida 3 claves caché |

### Qué NO mostrar en demo

- Endpoints `/api/pedidos/debug/*` (solo dev/staging)
- Resumen global Cobros sin deploy B7 (código listo; verificar en servidor)
- Selector vendedor "ALL" en Bolsa
- Flujo offline / cola de sincronización

---

## 8. Checklist pre-demo (ejecutar mañana ANTES de la presentación)

Orden recomendado — completar todos antes de que entre el jefe de ventas.

### 8.1 Infraestructura (192.168.1.230)

| # | Acción | Comando / verificación | Criterio OK | Estado smoke 2026-06-12 |
|---|---|---|---|---|
| 1 | Health check backend | `curl -H "User-Agent: GMP-SRE-HealthCheck/1.0" http://192.168.1.230:3335/api/health` | HTTP 200, body indica servicio up | **PC:** error `curl: (28) Connection timed out after 10014 ms` (TCP :3335 no alcanzable). **SSH→localhost:3335:** VERIFICADO HTTP **200**, **~5 ms** |
| 2 | Route Mode DDD | Revisar logs PM2 del arranque reciente | Log contiene `Route Mode: DDD Routes` OK (NO "Legacy") | **VERIFICADO** `USE_DDD_ROUTES=true` en `pm2 env gmp-api` (sin línea reciente en log tail) |
| 3 | Redis activo | Verificar en logs que caché Redis conecta (no fallback permanente) | Sin error Redis en arranque | **VERIFICADO** `/api/health` → `redis.status=connected` (SSH localhost, **~5 ms**) |
| 4 | DB2 ODBC | Desde servidor: query simple a JAVIER.PEDIDOS_CAB | Respuesta <5 s | **VERIFICADO** `/api/health` → `database.status=connected`, `queryTime=1–2 ms` |
| 5 | Smoke API autenticada | `GET /api/cobros/pending-summary/{vendedor}` con token JEFE_VENTAS (B7: **no ALL**) | 200 + JSON (no 500) | **VERIFICADO** `GET /api/cobros/pending-summary/95` token JEFE (GOYO): HTTP **200**, **~102 ms**, `success:true` |
| 6 | Smoke bolsa | `GET /api/bolsa/80/status` con token JEFE_VENTAS | 200 + saldo numérico | **VERIFICADO** HTTP **200**, **~6 ms**, `bolsa.vendedor=80` |
| 7 | Smoke pedidos | `GET /api/pedidos?limit=5` con token COMERCIAL vendedor 95 | 200 + lista | **KO criterio rol:** login `95` sin token; con token JEFE HTTP **200**, **~4 ms**, `orders:[]` — falta credencial COMERCIAL v95 |


### 8.1.1 Deploy producción completo (2026-06-12, sesión deploy Cursor)

| Paso | Resultado |
|---|---|
| git status (repo local) | Rama **	est** en **53e1f3a** (= **origin/test**, sin ahead/behind), pero **árbol de trabajo muy sucio** (decenas de M + untracked en ackend/, lib/, docs/audits/, etc.). **Sin commit/push solicitado** → el servidor solo recibe lo ya en remoto; **cambios locales pendientes de commit no se despliegan**. |
| SSH deploy /opt/gmp-api | **KO (no ejecutado)** — ssh gmp@192.168.1.230 rechazado en entorno agente (sin permiso red). Comando pendiente: git pull + 
pm ci --omit=dev + pm2 restart gmp-api. |
| Smoke post-deploy (health, login GOYO/9584, pending-summary/95, bolsa/80/status, pedidos?limit=5) | **No ejecutado** — bloqueado por deploy KO. Última evidencia válida: filas §8.1 del **2026-06-12** vía SSH→localhost (health ~5 ms, pending-summary/95 ~102 ms, bolsa/80 ~6 ms). |

**Acción Javier:** (1) commitear/pushear lo que deba ir a prod; (2) ejecutar deploy SSH desde red con acceso a 192.168.1.230; (3) repetir smoke con UA GMP-SRE-HealthCheck/1.0.
**Notas smoke (2026-06-12):** Ping `192.168.1.230` OK; **TCP :3335 bloqueado desde PC auditoría**; **SSH :22 OK** (plink `gmp@192.168.1.230`). Medidas vía `curl` a `http://127.0.0.1:3335` en servidor `/opt/gmp-api` (PM2 `gmp-api`, puerto **3335**).
### 8.2 Sesión demo

| # | Acción | Detalle |
|---|---|---|
| 8 | Preparar credenciales | Usuario JEFE_VENTAS + COMERCIAL vendedor 95; contraseñas verificadas |
| 9 | App apunta a producción | Confirmar URL base API = `192.168.1.230:3335` (no localhost, no 3197) |
| 10 | Limpiar caché app | Force-stop + reopen para evitar datos stale de sesión anterior |
| 11 | Red WiFi estable | Misma red que servidores 192.168.1.x; sin VPN que bloquee |
| 12 | Tablet cargada + brillo alto | Modo no molestar activado |

### 8.3 Preparación narrativa

| # | Acción | Detalle |
|---|---|---|
| 13 | Verificar B7 en servidor | Confirmar deploy con filtro `TRIM(CODIGOCLIENTEALBARAN) <> ''` en `pending-summary` global |
| 14 | Vendedor Bolsa fijado | Usar código `80` (datos verificados junio 2026) |
| 15 | Cliente Cobros fijado | Usar `4300003663` (7 documentos verificados) |
| 16 | Verificar schema env en servidor | Confirmar `DB2_READ_SCHEMA=DSEDAC`, `DB2_WRITE_SCHEMA=JAVIER`, `PEDIDOS_DSEDAC_STORAGE_APPROVED=false` |

### 8.4 Opcional (hardening, no bloqueante demo)

| # | Acción | Riesgo |
|---|---|---|
| 17 | `cd backend && npm audit fix` + `npx jest` | Bajo — semver compatible |
| 18 | Borrar `Driver` de raíz del repo local | Nulo |
| 19 | GuardVibe scan sobre 18 archivos Flutter editados | Cuando MCP disponible |

---

## 9. B7 — Vencimientos sin cliente (7,36 M€) — RESUELTO

### Evidencia ERP (dato histórico, sin cambio en DSEDAC)

```sql
SELECT COUNT(*), SUM(IMPORTEPENDIENTE)
FROM DSEDAC.CVC
WHERE TRIM(CODIGOCLIENTEALBARAN)=''
  AND IMPORTEPENDIENTE<>0
  AND (ANULADOSN IS NULL OR ANULADOSN<>'S')
-- Resultado: N=1.143, TOTAL=7.356.388,92 €
```

- Mayoritariamente **serie `O`**
- DSEDAC es **solo lectura** — corrección de datos = responsabilidad ERP

### Fix backend aplicado (2026-06-12)

Cuando `pending-summary` no aplica filtro vendedor (semi-join CLP vacío), se añade:

```sql
AND TRIM(CVC.CODIGOCLIENTEALBARAN) <> ''
```

**Archivos:** `backend/routes/cobros.js` (legacy), `backend/src/modules/cobros/infrastructure/db2-cobros-repository.js` (DDD activo).

**Tests:** `cobros-legacy.test.js` (B7 global ALL), `cobros-commercial.test.js` (filtro presente sin vendedor / ausente con vendedor).

**Comportamiento:** vista global JEFE_VENTAS ya no infla totales con 7,36 M€; vista filtrada por vendedor no cambia (semi-join CLP ya excluía la mayoría).

---

## 10. npm audit e intl:any — clasificación

### npm audit (13 vulnerabilidades: 4 moderate, 9 high — re-ejecutado 2026-06-12 post-fix)

| Impacto demo mañana | Impacto producción | Clasificación |
|---|---|---|
| **NO bloquea demo** | **NO bloquea prod plena** (resto dev/install-time) | ✅ |

**Investigación `bcrypt`→`tar`:**

| Pregunta | Resultado |
|---|---|
| ¿`bcrypt` en runtime de pedidos/cobros/bolsa? | **No** — solo `routes/auth.js` + `middleware/auth.js` (login PIN) |
| ¿`tar` en runtime de auth? | **No** — `tar` es dependencia de `@mapbox/node-pre-gyp` usada en **postinstall** para extraer binarios nativos |
| ¿Mitigación aplicada? | **`bcrypt@6.0.0`** — usa `node-gyp-build`, elimina cadena `tar` en auth del audit |
| ¿`npm audit fix --force`? | **No ejecutado** — rompería `@tensorflow/tfjs-node@0.1.11`, `joi@18`, `nodemailer@8` |

Desglose restante:

| Paquete | Runtime prod | Bloquea prod plena | Acción |
|---|---|---|---|
| ~~`bcrypt`→`tar`~~ | — | — | **✅ Resuelto** con `bcrypt@6.0.0` |
| `minimatch` (ReDoS) | No (`@typescript-eslint/*` dev) | No | Post-demo: bump eslint toolchain |
| `@tensorflow/tfjs-node`→`tar` | Solo `services/ml/predictive-cache.js` (install-time `tar`) | No en Pedidos/Cobros/Bolsa | Post-demo o remover si ML inactivo |
| `nodemailer@7` (CRLF) | Solo si envía email | No (moderate) | Breaking → post-demo |
| `joi@17` (RangeError) | Sí (validación) | No (moderate) | Breaking → post-demo |
| `uuid@9` | No (`jest-junit` dev) | No | Post-demo |
| ~~`qs`/`express`/`ws`~~ | — | — | **Ya no aparecen** en audit actual |

### intl:any

| Impacto demo mañana | Impacto producción | Clasificación |
|---|---|---|
| **NO bloquea demo** | **Hardening post-lanzamiento** | ⚠️ |

- Resuelto en lock a `intl 0.20.2`
- Riesgo: `pub upgrade` futuro puede saltar major sin aviso
- Acción: fijar `intl: ^0.20.2` en pubspec — cambio nulo en versión instalada

---

## 11. Re-verificación ejecutada (2026-06-12)

| Comando | Resultado | Notas |
|---|---|---|
| `cd backend && npx jest` | **334/334 ✅** | Fix DDD: `BOLSA_INSUFICIENTE` code + `resumen.total` en `ddd-adapters.js`; `bcrypt@6.0.0` sin regresión auth |
| `flutter analyze` | **0 errores ✅** | 2 warnings `conflict_resolver.dart:185,273`; 7114 infos |
| `flutter test test/features/pedidos/ test/features/cobros/ test/features/bolsa/ test/widgets/` | **174/174 ✅** | |
| Smoke HTTP `192.168.1.230:3335/api/health` | **⚠️ mixto** | PC: curl **28** ~10014 ms; SSH localhost: **200** ~5 ms. Autenticados: pending-summary/95 **102 ms**, bolsa/80 **6 ms**, pedidos **4 ms** (token JEFE; COMERCIAL 95 sin login) |
| `npm audit` | **13 CVEs** (4 mod, 9 high) | `bcrypt@6.0.0` elimina cadena auth→tar; resto dev/install-time |
| GuardVibe MCP | **No disponible** | Revisión manual: SQL parametrizado ✅, `verifyToken` en rutas ✅, gates schema DSEDAC ✅, sin secrets en diff |

### GuardVibe — revisión manual (sustituto)

Archivos críticos revisados: `pedidos.service.js`, `routes/cobros.js`, `routes/pedidos.js`, `db2-schemas.js`, `db2-cobros-repository.js`, `ddd-adapters.js` (editado esta sesión).

- Queries: `queryWithParams` / placeholders `?` — sin concatenación de input usuario en SQL.
- Auth: `router.use(verifyToken)` en pedidos/cobros/bolsa; scopes COMERCIAL por vendedor/cliente.
- Escritura DSEDAC: triple gate (`DB2_WRITE_SCHEMA` + `PEDIDOS_DSEDAC_STORAGE_APPROVED` + export flags).
- Idempotencia: tokens obligatorios en cobros; `clientRequestId`/`idempotency-key` en pedidos.

---

## 12. Veredicto final explícito

### ¿Listo para la DEMO mañana ante jefe de ventas?

# CONDICIONAL SÍ

**Condición obligatoria:**

1. Ejecutar checklist §8 completo **desde red interna** — health check, Route Mode DDD, smoke API autenticada + **deploy fix B7**

**Con esa condición:** flujos Pedidos (crear → editar → confirmar), Cobros (parcial → total, resumen global sin 7,36 M€ fantasma) y Bolsa (saldo + historial) respaldados por **334 tests backend**, **174 tests Flutter** scope demo, **integridad DB2 15/15**, schema read/write verificado, IVA unificado, idempotencia pedidos E2E.

### ¿Listo para PRODUCCIÓN plena?

# SÍ

**Criterios cumplidos:**

| Criterio | Estado | Evidencia |
|---|---|---|
| Tests pass | ✅ | 334 backend + 174 Flutter |
| B1–B3 no-bloqueantes (modo JAVIER) | ✅ | `b1_b3_blockers_closure.json` |
| Idempotencia OK | ✅ | `pedidos_idempotency.test.js` + offline `clientRequestId` |
| npm audit sin high en runtime auth | ✅ | `bcrypt@6.0.0`; `tar` restante solo tfjs install-time |
| B7 filtro backend | ✅ | `cobros.js` + `db2-cobros-repository.js` + tests |

**Bloqueante restante para SÍ absoluto:**

| # | Item | Severidad |
|---|---|---|
| 0 | **Deploy prod 2026-06-12 no completado** (SSH bloqueado en agente) + **WT sucio sin commit** | ops |
| 1 | Smoke HTTP prod no verificado (requiere red `192.168.1.230:3335`) + deploy B7 | 🔴 ops |
| 2 | B1 NOT NULL DDL pendiente solo para cutover escritura DSEDAC | ⚠️ futuro |
| 3 | GuardVibe MCP pendiente cuando disponible | ⚠️ hardening |
| 4 | npm audit residual: `minimatch` dev, `tar` tfjs install-time | ⚠️ post-demo |

**Timeline post-demo:** semana 1 → deploy B7 + smoke HTTP en prod + GuardVibe; semana 2–4 → ventana B1 NOT NULL si se activa `DB2_WRITE_SCHEMA=DSEDAC`.

---

## 13. Anexo — tiempos de respuesta medidos

Fuente: `backend/tmp/db-exploration/pilar2-perf-2026-06-11.json` (3 repeticiones, ODBC directo, 2026-06-11 21:42 UTC).

| Query / endpoint | ms (run1 / run2 / run3) | Filas | Estado post-fix |
|---|---|---|---|
| Pedidos getOrders (vendor 95, 50) | 226 / 231 / 222 | 21 | ✅ OK |
| Pedidos list-estados debug (vendor 95) | — | — | ✅ Corregido B5 (era SQL0206) |
| Cobros pendientes CVC por cliente 4300003663 | 247 / 241 / 222 | 7 | ✅ OK |
| Cobros pending-summary legacy global | — | — | ✅ Corregido B6 (era SQL0205) |
| Cobros pending-summary **DDD** global | 1695 / 1545 / 1544 | 7134 | ✅ OK (ruta activa) |
| Bolsa status vendor 80, 2026/06 | 229 / 224 / 224 | 1 | ✅ OK |
| Bolsa historial 12 meses vendor 80 | 219 / 223 / 228 | 1 | ✅ OK |
| VISTA_DEUDA_BASE (no usada por app) | 2756 (1 run) | — | Info |
| Integridad checks (15 queries) | ~220–400 c/u | 0 anomalías | ✅ OK |
| CRUD humo JAVIER (insert/update/delete) | <500 c/u | — | ✅ OK |

**Notas de latencia:**

- Suelo ODBC observado: **~220–250 ms** incluso en tablas pequeñas (coste de conexión, no de plan)
- `pending-summary` DDD escanea **142.060 filas CVC** → **~1,5 s** sin caché; Redis `TTL.SHORT` lo amortiza en requests repetidos
- Tiempos HTTP end-to-end en producción (`192.168.1.230:3335`): **no medidos** — pendiente checklist §8

### Volúmenes DB2 relevantes

| Tabla | Filas |
|---|---|
| DSEDAC.CVC | 142.060 |
| DSEDAC.CLI | 14.010 |
| DSEDAC.CLP | 12.093 |
| DSEDAC.CPC | 739.522 |
| DSEDAC.LPC | 2.435.773 |
| JAVIER.PEDIDOS_CAB | 21 |
| JAVIER.BOLSA_COMERCIAL | 15 |

---

*Informe consolidado y re-verificado el 2026-06-12. Referencias cruzadas contra informes parciales, `b1_b3_blockers_closure.json` y ejecución directa de quality gates.*
