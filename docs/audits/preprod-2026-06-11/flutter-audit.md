# Auditoría Frontend Flutter — Pre-producción 2026-06-11

**Alcance:** pestañas Pedidos, Cobros y Bolsa Comercial + core compartido (`lib/` y `test/`).
**Pilares:** 1 (flujos UI), 4 (trampas Flutter/Dart), 6 (estado y asincronía), 7 (resiliencia UI), 12 (validaciones y límites).
**Método:** lectura línea a línea de los 61 archivos del alcance, fixes mínimos y quirúrgicos, verificación con `flutter analyze` + tests.

---

## 0. Línea base y verificación

| Métrica | ANTES de los fixes | DESPUÉS de los fixes |
|---|---|---|
| `flutter test test/features/pedidos/ test/features/cobros/ test/features/bolsa/` | **27/27 passed** | **27/27 passed** (ver sección 5) |
| `flutter analyze` — errores | **0** | **0** |
| `flutter analyze` — warnings | **2** (preexistentes en `lib/core/offline/conflict_resolver.dart:185,273` — fuera del alcance editable acordado con el resto de agentes) | **2** (las mismas, sin cambios) |
| `flutter analyze` — infos (lints estilo) | 7110 | ~7110 (sin errores nuevos; ver sección 5 con conteo exacto) |

**GuardVibe MCP:** la herramienta `guardvibe (scan_file)` **no está disponible** en este entorno de ejecución (no aparece entre las herramientas MCP accesibles). Se declara explícitamente según lo exigido. Mitigación: revisión manual de seguridad en cada fix (sin SQL, sin secretos, sin `innerHTML`/`eval`; solo UI/estado Dart).

**Regla inviolable respetada:** NO se añadió `autoDispose` a `pedidosProvider` (sigue siendo `ChangeNotifierProvider` global, línea 57-58 de `pedidos_provider.dart`).

---

## 1. BOLSA COMERCIAL

### 1.1 `lib/features/bolsa/data/bolsa_models.dart` — ✅ correcto
- Parseo tolerante en todos los `fromJson` (`double.tryParse`/`int.tryParse` con fallback 0): líneas 22-25, 124-141, 211-215. No casca con strings/null del backend.
- `porcentajeConsumido` clamp 0-100 (línea 54), división por cero protegida (línea 53).
- `BolsaMovimientoTipo.fromString` cubre valor desconocido → `desconocido` con label "Otro" (líneas 74-98). Todos los estados tienen representación (Pilar 1).

### 1.2 `lib/features/bolsa/data/bolsa_service.dart` — ✅ correcto
- `getStatus` valida vendedor vacío con `ArgumentError` (líneas 19-22).
- `getMovements`/`getHistory`: catch con `debugPrint` + `rethrow` (líneas 70-73, 96-99) → el error llega al provider y a la UI; no hay errores silenciados.
- `updateConfig` invalida las 3 claves de caché tras el PUT (líneas 121-123).

### 1.3 `lib/features/bolsa/providers/bolsa_provider.dart` — ✅ correcto
- **Race conditions cubiertas**: `_loadGeneration` + verificación de vendedor en línea 107 (`if (generation != _loadGeneration || _currentVendor != code) return;`) — un cambio rápido de vendedor no pisa datos del anterior (Pilar 6).
- Errores expuestos en `error` y consumidos por la UI (líneas 114-118); `updateConfig` devuelve `bool` y deja `_error` poblado (142-146).
- Provider global (no autoDispose): no hay riesgo de notificar tras dispose.

### 1.4 `lib/features/bolsa/presentation/pages/bolsa_page.dart` — ⚠️ corregido
- ✅ Estados loading/error/empty/data completos (`_buildBody`, líneas 109-118): error con botón Reintentar, sin pantalla en blanco (Pilar 7).
- ✅ `mounted` verificado tras `await provider.updateConfig` antes del SnackBar (línea ~294).
- ✅ Controller de búsqueda con `dispose()` (líneas 496-499). Ellipsis en descripciones de movimientos (líneas 674-675).
- 🔧 **FIX (Pilar 12 — localización española):** los importes se mostraban con `toStringAsFixed(2)` (punto decimal, sin separador de miles: "1234.56 €"). Sustituidos por `NumberFormat.currency(locale: 'es_ES', symbol: '€')` en: saldo disponible, Acumulado, Consumido, `_formatMoney` de los movimientos; los porcentajes (Límite, Consumo del periodo) ahora usan coma decimal. Verificación: analyze sin errores nuevos; el resto del feature (gráfico 12 meses) ya usaba separador de miles español.
- 📌 Observación (sin fix, decisión de producto): si JEFE_VENTAS selecciona "ALL" en el selector global, `_loadIfNeeded` (líneas 36-46) no recarga y se mantienen los datos del último vendedor visible. No es crash; conviene decidir si "ALL" debe mostrar el estado vacío.
- 📌 Observación: los `TextEditingController` del diálogo de configuración (líneas 226-232) no se hacen `dispose()`; al ser locales al diálogo el GC los recoge — no se tocó para no introducir un crash de dispose durante la animación de cierre.

### 1.5 `lib/features/bolsa/presentation/widgets/bolsa_monthly_chart.dart` — ✅ correcto
- División por cero protegida (`maxVal <= 0` → `SizedBox.shrink`, línea 29), alturas con `isFinite` (línea 156).
- `_eur` ya formateaba miles a la española (líneas 233-238, 0 decimales → sin ambigüedad de coma).

---

## 2. COBROS

### 2.1 `lib/features/cobros/data/models/cobros_models.dart` — ⚠️ corregido
- ✅ `EstadoCobro`, `TipoCobro`, `EstadoEntrega` (re-export): todos los valores con `label` + `color`, fallback a `pendiente`/`normal` (líneas 74-114, 204-217) — Pilar 1 badges completos.
- ✅ Inferencia de vencido con comparación por fecha-sin-hora (líneas 146-154), cubierta por test (`classifies due today as vencido`).
- 🔧 **FIX (Pilar 12 — límite):** `Albaran._parseDate` usaba `int.parse` sobre fechas "dd/mm/yyyy" — una fecha malformada del backend (p.ej. `"ab/cd/efgh"`) lanzaba `FormatException` y tumbaba el parseo de toda la lista de albaranes. Ahora `int.tryParse` con fallback al flujo `DateTime.tryParse → DateTime.now()` (líneas 308-323).
- 📌 Observación (coordinación backend): los `fromJson` de cobros usan casts duros (`as num`, `as int?`) a diferencia de bolsa/pedidos (parseo tolerante). Si el backend enviara DECIMAL como string, crashearía. No se cambió (los tests de contrato actuales pasan y el agente backend audita el lado emisor); queda anotado en BLOQUEOS.

### 2.2 `lib/features/cobros/providers/cobros_provider.dart` — ⚠️ corregido
- ✅ `buildCobroIdempotencyToken` sanitiza y trunca (líneas 15-31), con test.
- ✅ `registrarCobro` invalida cachés y recarga (líneas 434-451).
- 🔧 **FIX (Pilar 6 — no emitir tras dispose):** el provider es `ChangeNotifierProvider.family.autoDispose` y `registrarCobro` lanza una recarga *fire-and-forget* de `cargarPendingSummary` (líneas 442-450). Si la pantalla se cerraba con la llamada en vuelo, se ejecutaba `notifyListeners()` sobre un provider ya disposed (assert en debug, comportamiento indefinido). Añadido flag `_disposed` + override de `notifyListeners()` que lo respeta y `dispose()` que lo activa.
- 🔧 **FIX (Pilar 7 — error silenciado):** `verificarEstadoCliente` capturaba el error sin log y sin `notifyListeners()` → la UI conservaba un estado de cliente obsoleto sin enterarse. Ahora `debugPrint` + `notifyListeners()` para limpiar el estado mostrado.
- 📌 Observación: `completarEntrega` hace N llamadas secuenciales (una por ítem, líneas 263-273) sin rollback si fallan algunas; ya informa "No se pudieron completar todos los ítems". Flujo de repartidor, fuera de la pestaña auditada; anotado.

### 2.3 `lib/features/cobros/presentation/pages/cobros_page.dart` — ⚠️ corregido
- ✅ Asincronía sólida: generaciones (`_clientLoadGeneration`, `_summaryLoadGeneration`) + `mounted` en todos los setState tras await (líneas 93-118, 121-180); debounce de búsqueda cancelado en `dispose` junto con controller y `ProviderSubscription` (líneas 196-202).
- ✅ `ListView.builder` para la lista de clientes (línea ~272). Ellipsis en nombre (807-808). Estados vacíos contextuales (filtros vs sin datos, líneas 628-713).
- 🔧 **FIX (Pilar 7 — fallo silencioso):** `cargarPendingSummary` captura sus errores internamente y NO lanza, así que el `catch` de `_loadPendingSummary` nunca se activaba: con un 500/timeout la pantalla mostraba "Pendiente total: 0,00€" como si fuera un dato real. Ahora, tras el await, si `provider.error != null` y no hay summary, se publica `_loadError` → pantalla de error con Reintentar.
- 🔧 **FIX (Pilar 12 — formato roto):** `fmtMoney` aplicaba un regex de miles sobre `toStringAsFixed(2)` produciendo **"1.234.56€"** (punto como decimal Y como millar a la vez — ilegible/ambiguo en la demo). Sustituido por `NumberFormat.currency('es_ES')`; igual en "Pendiente total" del estado vacío y en los importes por cliente ("Vencido: …").

### 2.4 `lib/features/cobros/presentation/pages/cobro_detail_screen.dart` — ⚠️ corregido
- ✅ **Doble submit imposible**: `_isSubmitting` al inicio de `_submitCobro` (línea 90) + botón "Cobrar" deshabilitado con spinner mientras procesa (líneas 680-695). Diálogo de confirmación previo con importe y forma de pago. `mounted` tras los await críticos (líneas 152, 201).
- ✅ Parsing de coma española en importes parciales: `rawValue.replaceAll(',', '.')` (línea 76). Fechas `DateFormat('dd/MM/yyyy')` (línea 537). Moneda `NumberFormat es_ES` (línea 26).
- ✅ Error del provider visible en banner rojo dentro de la pantalla (líneas 287-309).
- 🔧 **FIX (Pilar 12/1 — validación huérfana que bloqueaba el cobro):** al salir del modo PARCIAL (elegir COMPLETO/NINGUNO o des-seleccionar) no se limpiaban `_partialErrors` ni siempre `_partialAmounts`; el usuario quedaba **bloqueado** con "Corrige los importes parciales" sin ningún campo visible que corregir. Ahora cualquier transición a estado ≠ PARCIAL limpia importe y error de ese documento.
- 🔧 **FIX (Pilar 12):** `_validatePartialAmount` almacenaba el importe aunque fuera inválido (negativo o > pendiente), inflando el "Total a cobrar" mostrado. Ahora solo se almacenan importes válidos.
- 🔧 **FIX (Pilar 6 — estado sucio tras éxito):** tras un cobro exitoso, `_itemStates`/`_partialAmounts` no se limpiaban; un documento parcialmente cobrado seguía seleccionado como COMPLETO tras la recarga, dejando a un toque un **segundo cobro accidental**. Ahora la selección se limpia al completar con 0 fallos.
- 📌 Observación: el TextField de importe parcial no tiene controller persistente; si se colapsa/expande el ExpansionTile el texto visible se pierde aunque el importe siga aplicado (el total lo refleja). Cosmético; requeriría gestionar un controller por línea (no es fix quirúrgico).

### 2.5 `lib/features/cobros/presentation/widgets/albaran_card.dart` — ✅ correcto (código no usado)
- Sin defectos internos (ellipsis en nombre/dirección, estados por enum). **No está instanciado en ninguna parte de `lib/`** (verificado por grep) — código muerto.

### 2.6 `lib/features/cobros/presentation/widgets/cobros_filters.dart` — ✅ correcto (código no usado)
- Controller con dispose correcto. No instanciado en `lib/` — código muerto.

### 2.7 `lib/features/cobros/presentation/widgets/cobros_summary_card.dart` — ✅ correcto (código no usado)
- `NumberFormat es_ES` correcto, división por cero protegida (línea 24). No instanciado — código muerto.

### 2.8 `lib/features/cobros/presentation/widgets/entrega_detail_sheet.dart` — ✅ correcto (código no usado)
- Contiene 5 botones con `onTap: () {}` (mapa, teléfono, Foto, Firma, Incidencia — líneas 205, 216, 272, 282, 292) que serían no-ops silenciosos, **pero el widget no está instanciado en ninguna ruta de la app** (la UI real de entregas es `rutero_detail_modal.dart`). Anotado como código muerto; no se borra por prudencia pre-demo.

---

## 3. PEDIDOS

### 3.1 `lib/features/pedidos/data/pedidos_service.dart` — ✅ correcto
- Parsers tolerantes `_toDouble/_toInt/_toBool` a prueba de strings/Map/null (líneas 2171-2195) usados en todos los modelos.
- Todos los métodos: catch + `debugPrint` + `rethrow` (o fallback documentado a lista vacía en datos auxiliares como familias/marcas/recomendaciones). Invalidación de caché coherente tras cada mutación (líneas 1758, 1939-1940, 2007-2013…).
- `confirmOrder` distingue: cola offline (`queued`), 409 de stock (`blocked:true`) y deja pasar el 409 de fecha de reparto (líneas 2015-2038) — diseño correcto para la resiliencia UI.
- `recalculate()` de `OrderLine` redondea con `toStringAsFixed` y cubre dual-field/kg/litros (líneas 1059-1117), con tests de negocio en verde.

### 3.2 `lib/features/pedidos/providers/pedidos_provider.dart` — ⚠️ corregido
- ✅ `_notify()` con flag `_disposed` (líneas 174-187, 1736-1740): no se emite estado tras dispose. **NO se añadió autoDispose** (regla del proyecto).
- ✅ Race conditions: `_productsLoadGeneration` con verificación adicional de cliente/filtros al volver del await (líneas 546-552) y `_ordersLoadGeneration` (1236-1247).
- ✅ `confirmOrder` limpia el carrito SOLO si el backend confirma de verdad (`shouldClearCartAfterConfirmation`, líneas 1169-1180; cubierto por 5 tests de contrato).
- ✅ Stock-check en `addLine`/`updateLine` con mensajes de error retornados a la UI; venta parcial señalizada con `PARCIAL:` (líneas 678-716, 789).
- 🔧 **FIX (Pilar 1 — funcionalidad rota):** `toggleFavorite` solo mutaba el `Set` en memoria; **los favoritos se perdían al reiniciar la app** porque nadie llamaba a `PedidosFavoritesService.toggleFavorite` (la página solo hace `init()` + `getFavorites()` al arrancar). Ahora el provider persiste en Hive (con `unawaited` + log de error), manteniendo el flujo síncrono de la UI.
- 🔧 **FIX (Pilar 12 — mapeo IVA incompleto):** `addLine` y `addMultipleProducts` mapeaban solo códigos 1-3 con tasas incorrectas para 2/3/4/5 (p.ej. '2'→4% en vez de 21%). Sustituido por `ivaRateFromCode(product.codigoIva)` (líneas 754, 1652).
- 📌 Observación: `loadOrders`/`loadProducts` exponen `e.toString()` crudo en `error`; las vistas que lo muestran usan textos propios ("Error al cargar productos") así que no llegan stack traces al usuario.

### 3.3 `lib/features/pedidos/providers/pedidos_provider_v3.dart` — ✅ correcto (código no usado)
- No está referenciado por ningún archivo de `lib/` (grep): código muerto (versión experimental). Mapeo IVA alineado por consistencia (`ivaRateFromCode`, línea 632). Anotado para limpieza post-demo.

### 3.4 `lib/features/pedidos/presentation/pages/pedidos_page.dart` — ⚠️ corregido
- ✅ Timers (`_stockRefreshTimer`, `_autoSaveTimer`), `ProviderSubscription`, `TabController`, `ScrollController` y listener del provider liberados en `dispose` (líneas 176-187); guards `mounted` en los callbacks de timers (línea 142) y postFrame (113, 297).
- ✅ FutureBuilder de Devoluciones maneja los TRES estados: waiting → spinner, `snapshot.hasError` → vista de error con Reintentar, data → lista o estado vacío (líneas 1624-1695). El future se cachea (`_devolucionesFuture`) para no recargar en cada rebuild (Pilar 4).
- ✅ Catálogo con `ListView.builder` + scroll infinito (1288 y ss.); error de productos con Reintentar; skeleton de carga.
- 🔧 **FIX (Pilar 4 — bug de precedencia):** tres ocurrencias de `if (confirm ?? false && mounted)` que Dart evalúa como `confirm ?? (false && mounted)`, es decir **nunca comprobaba `mounted`** (líneas 2343, 2398, 2456 originales: `_cancelOrder`, `_confirmBorrador`, `_deleteBorrador`). Corregidas a `(confirm ?? false) && mounted`.
- 🔧 **FIX (Pilar 6 — memory leak/crash):** `_debounceTimer` (búsqueda de Mis Pedidos, 300 ms) no se cancelaba en `dispose`; podía disparar `_loadOrdersWithFilters` → `_vendedorCodes` → `ProviderScope.containerOf(context)` con el widget destruido. Añadido `_debounceTimer?.cancel()` en `dispose`.
- 🔧 **FIX (Pilar 7 — excepción no manejada):** `_cancelOrder` llamaba a `cancelExistingOrder` (que hace `rethrow`) sin try/catch: un 500 al anular producía un error de zona sin feedback. Envuelto en try/catch con SnackBar de error (patrón ya usado por `_deleteBorrador`).
- 🔧 **FIX (Pilar 7 — falso éxito):** `_duplicateOrder`, el flujo `clone:` de `_showOrderDetail` y `_confirmBorrador` mostraban "duplicado/clonado/cargado al carrito" aunque `cloneOrderIntoCart` hubiera fallado (ese método captura el error y lo deja en `provider.error`). Ahora se comprueba `prov.error` y se muestra el error real en su caso.
- 📌 Observación: `_loadRuteroClientData` silencia su error (solo afecta al modo de ordenación por ruta; la lista de pedidos sigue funcionando). `client['order'] as int? ?? 9999` (línea ~2215) crashearía si el backend enviara `order` como double — anotado para el agente backend.

### 3.5 `lib/features/pedidos/presentation/widgets/add_to_order_sheet.dart` — ⚠️ corregido
- ✅ `isScrollControlled: true` (línea 34) + `MediaQuery.of(ctx).viewInsets.bottom` (línea 444): el teclado no tapa los campos (Pilar 4). 4 controllers con `dispose()` (153-159). Ellipsis en nombre (489-491). Carga de tarifas con guard `ctx.mounted` (línea 400). Edición precarga línea existente (cantidad/unidad/precio, líneas 85-149) — Pilar 1.
- ✅ Aviso de precio bajo mínimo con diálogo de confirmación (líneas 1400-1407).
- 🔧 **FIX (Pilar 12 — negativos):** `_parseInputNumber` aceptaba negativos y no-finitos (el teclado decimal permite teclear "-"); una cantidad "-5" creaba una línea con importe negativo en el carrito. Ahora negativos/no-finitos → 0.
- 🔧 **FIX (Pilar 12 — validación sin mensaje):** pulsar "Anadir al pedido" con cantidad 0 hacía `return` silencioso. Ahora muestra SnackBar "Indica una cantidad mayor que 0".
- 🔧 **FIX (Pilar 4 — context tras await):** en `_handleAddToOrder`, tras `await _showPriceWarning(...)` se llamaba a `_performAddLine` (que usa `context`/`Navigator.pop`) sin verificar `mounted`. Añadido `if (!mounted) return;`.
- 🔧 **FIX (Pilar 7):** `catchError((_) {})` al cargar tarifas era un error 100% silenciado; ahora registra `debugPrint` (las tarifas son datos auxiliares: la ficha sigue operativa sin ellas).
- 📌 Observación: `ref.watch` dentro de dos callbacks `onTap` (líneas ~612 y ~632) debería ser `ref.read`; funciona pero es un mal uso del API de Riverpod. No tocado para minimizar churn pre-demo.

### 3.6 `lib/features/pedidos/presentation/widgets/order_summary_widget.dart` — ⚠️ corregido
- ✅ Controllers/FocusNode con dispose (36-41). Confirmar deshabilitado durante `isSaving` con spinner (556-575). Error del provider visible bajo el botón (588-596). Totales/IVA/bolsa con `PedidosFormatters` (es_ES). `ReorderableListView.builder` para las líneas.
- ✅ Diálogo de edición de línea: precarga cantidad/cajas/uds/precio de la línea (737-754), equivalencias visibles, viewInsets para teclado (772-777) — Pilar 1: precarga correcta al editar.
- 🔧 **FIX (Pilar 4 — doble pop):** en el diálogo "Vaciar carrito", `Navigator.pop(ctx)` tras un `await` sin `ctx.mounted`; si el usuario cerraba el diálogo por el barrier durante el await, el pop extra cerraba la pantalla/hoja inferior. Ahora `if (ctx.mounted) Navigator.pop(ctx)`.
- 🔧 **FIX (Pilar 12 — validación sin mensaje y precio 0):** en GUARDAR del diálogo de edición: cantidad ≤ 0 hacía return silencioso (diálogo abierto sin feedback) y se aceptaba **precio 0 o negativo en líneas de venta** (importe 0 silencioso). Ahora: SnackBar "Indica una cantidad mayor que 0" / "Precio no válido"; precio 0 solo se permite en líneas SC (sin cargo), coherente con `updateLineClaseLinea`.
- 📌 Observación: los 4 controllers del diálogo de edición son locales y no se hacen dispose (mismo criterio que 1.4: GC los recoge; dispose durante la animación de cierre es más arriesgado que el leak).

### 3.7 `lib/features/pedidos/presentation/widgets/order_preview_sheet.dart` — ⚠️ corregido
- ✅ **Doble submit imposible**: botón CONFIRMAR deshabilitado con `_isConfirming || _isLoadingDeliveryOptions || _confirmSucceeded` (líneas 1110-1114) y la X también se bloquea durante la confirmación (línea 220). `AnimationController` disposed (78-81). `mounted` tras todos los await (1230, 1237, 1267, 1447, 1460, 1473). Errores con banner legible y `_cleanError` (sin "ApiException:"/"Exception:" visibles — Pilar 7).
- ✅ Fecha en DD/MM/YYYY (`_formatDateDisplay`, líneas 1397-1401) y día de semana en español.
- 🔧 **FIX (Pilar 7/1 — falso éxito con stock bloqueado):** `_handleConfirm` trataba **cualquier resultado no-null como éxito**: con un 409 de stock (`blocked:true`) mostraba "✓ Pedido confirmado correctamente", esperaba 2 s y hacía `pop` — que además cerraba el diálogo de alternativas recién abierto encima (no el preview), dejando la UI inconsistente. Ahora solo es éxito si `isConfirmedOrderResultForProvider(result)` (mismo criterio que el provider y el snackbar); resultados bloqueados/no confirmados muestran el banner de error con el mensaje del backend y el preview permanece para corregir.

### 3.8 `lib/features/pedidos/presentation/widgets/order_detail_sheet.dart` — ✅ correcto
- 3 estados (loading/error con Reintentar/data) en líneas 245-277. Guards `_isCancelling`/`_isConfirming` con spinners en Anular/Confirmar (820, 849). `mounted` tras awaits (175, 232). Acciones según estado del pedido (BORRADOR/PENDIENTE_APROBACION/CONFIRMADO). Formatos es_ES vía `PedidosFormatters`.
- 📌 Observación: `ref.watch` dentro del onPressed del PDF (línea ~795) — mismo caso que 3.5, sin tocar.

### 3.9 `lib/features/pedidos/presentation/widgets/order_line_tile.dart` — ✅ correcto
- `Dismissible` con `confirmDismiss` que delega el borrado al diálogo y devuelve false (líneas 154-157) — sin doble eliminación. Ellipsis en descripción (209-210). Stepper protege decremento ≤ 1 vía caller. Chip de descuento parsea coma y clamp 0-100 (544-547).

### 3.10 `lib/features/pedidos/presentation/widgets/order_status_badge.dart` — ✅ correcto
- Mapa de 7 estados (BORRADOR, PENDIENTE_APROBACION, CONFIRMANDO, CONFIRMADO, ENVIADO, FACTURADO, ANULADO) + fallback "Desconocido" para valores nuevos (líneas 68-76). Cobertura completa de estados del modelo (Pilar 1); 23 tests de widget preexistentes.

### 3.11 `lib/features/pedidos/presentation/widgets/order_card.dart` — ✅ correcto
- Usa `OrderStatusConfig` (estados completos), ellipsis en cliente (124-125), `PedidosFormatters.money`. `isMarginVisible` default `false` (defensa de rol, líneas 22, 31-33).

### 3.12 `lib/features/pedidos/presentation/widgets/order_filters_bar.dart` — ⚠️ corregido
- ✅ Fechas DD/MM/YYYY (línea 368), presets de fecha correctos incluso en enero (`DateTime(now.year, now.month - 1)` normaliza), parsing de importes con coma (426-427).
- 🔧 **FIX (Pilar 1 — filtros con estado sucio):**
  1. Los campos "Importe mín./máx." creaban un `TextEditingController` **nuevo en cada build** (sin dispose y reseteando texto+cursor con cada pulsación → era casi imposible teclear un importe, y además leak de controllers). Ahora son controllers de estado persistentes con `dispose()`.
  2. Al pulsar "Limpiar" desde el padre, la caja de búsqueda y los importes conservaban el texto antiguo aunque el filtro ya estuviera vacío (estado visual ≠ estado real). Añadido `didUpdateWidget` que sincroniza search y limpia importes cuando el padre los anula.

### 3.13 `lib/features/pedidos/presentation/widgets/product_card.dart` — ⚠️ corregido
- Ellipsis en nombre/stock, badges de promo/YoY/unidad, toggles locales sin async. Quick-add solo si hay stock (504).
- 🔧 **FIX (Pilar 12 — IVA por producto):** el toggle "c/IVA" usaba IVA fijo 21% (`static const ivaRate = 0.21`). Ahora usa `ivaRateFromCode(widget.product.codigoIva)` (líneas 46-48) alineado al mapeo DSEDAC verificado.

### 3.14 `lib/features/pedidos/presentation/widgets/product_detail_sheet.dart` — ⚠️ corregido
- ✅ 3 estados con Reintentar (174-224).
- 🔧 **FIX (Pilar 4 — setState tras await sin mounted):** `_loadDetail` hacía `setState` tras el await sin `mounted` — cerrar la hoja antes de la respuesta = crash (null-check sobre `_element` en release). Añadidos guards en éxito y catch.
- 🔧 **FIX (Pilar 4 — context tras await):** `_openFichaTecnica` usaba `ScaffoldMessenger.of(ctx)` después de `await dio.download` con la hoja posiblemente cerrada. El messenger ahora se captura antes del await (igual que ya se hacía con el navigator).
- 🔧 **FIX (Pilar 12 — mapeo IVA incorrecto):** `ivaLabel` local mostraba '1'→"General (21%)" (afectaba al 87% del catálogo activo). Sustituido por `ivaLabelFromCode(p.codigoIva)` (línea 361) con mapeo verificado DSEDAC.

### 3.15 `lib/features/pedidos/presentation/widgets/product_history_sheet.dart` — ⚠️ corregido
- ✅ 3 estados + estado "Sin historial" (186-253). `mounted` en éxito (línea 159).
- 🔧 **FIX (Pilar 4):** el `catch` de `_loadHistory` hacía `setState` sin `mounted` → mismo crash potencial que 3.14. Guard añadido.
- 🔧 **FIX (Pilar 12 — es_ES):** `_fmtEur` usaba `toStringAsFixed` (punto decimal); ahora delega en `PedidosFormatters.money` (coma + miles).
- 🔧 **FIX (Req #2 — fuga de costes a COMERCIAL):** el KPI "Coste" y las columnas Coste de la tabla mensual, fila TOTAL y comparativa anual se mostraban **siempre**, aunque `isMarginVisible=false` (el margen sí estaba oculto, pero con ventas+coste visibles el margen se deduce). Ahora Coste muestra '—' para roles sin visibilidad, igual que Margen.

### 3.16 `lib/features/pedidos/presentation/widgets/product_comparative_strip.dart` — ✅ correcto
- `mounted` en ambos setState tras await (64, 70); catch silencioso documentado (el strip se oculta sin romper la hoja). División por cero protegida (`max == 0` → shrink, línea 299).

### 3.17 `lib/features/pedidos/presentation/widgets/stock_alternatives_sheet.dart` — ⚠️ corregido
- ✅ Controller + debounce con dispose (77-81). Estados loading/error/vacío/búsqueda completos (495-613). Cantidad clamp 1..stock (821-829).
- 🔧 **FIX (Pilar 4):** `_loadAlternatives` (3 setState) y `_searchProducts` (3 setState) sin `mounted` tras await — cerrar el diálogo durante la carga = crash. Guards añadidos + `debugPrint` en el catch de búsqueda que era silencioso.
- 📌 Observación: `_addToCart` construye un `Product` mínimo (sin `precioMinimo` ni `unitsPerBox` reales) — la línea añadida no computa impacto de bolsa ni mínimos. Anotado; corregirlo requiere endpoint con datos completos.

### 3.18 `lib/features/pedidos/presentation/pages/promotions_list_page.dart` — ✅ correcto
- StatefulWidget puro sin async; `ListView.builder`; estados vacíos con "Limpiar filtros" (107-160); ellipsis en textos largos (343-344, 471); agrupación de promos con clave normalizada.

### 3.19 `lib/features/pedidos/presentation/pages/promotion_detail_page.dart` — ✅ correcto
- Submit de regalos con guard `_submittingGifts` + botón deshabilitado + spinner (líneas 430-453); `mounted` tras el bucle de awaits (97); errores agregados visibles en SnackBar (109-116); límite de regalos elegibles calculado y aplicado en el stepper (63-79).

### 3.20 `lib/features/pedidos/presentation/widgets/promotions_banner.dart` — ✅ correcto (código no usado)
- Su única instanciación está comentada en `pedidos_page.dart` (líneas 992-997) — código muerto. Internamente usa `Provider.of<PedidosProvider>` (API legacy); al estar muerto no se toca. Anotado para limpieza.

### 3.21 `lib/features/pedidos/presentation/widgets/recommendations_section.dart` — ✅ correcto
- Listas horizontales con `ListView.separated` (lazy), ellipsis en código/nombre/stock, colapsable sin async.

### 3.22 `lib/features/pedidos/presentation/widgets/client_balance_badge.dart` — ✅ correcto
- Sin async; `PedidosFormatters.money`; umbrales de riesgo documentados en el modal informativo.

### 3.23 `lib/features/pedidos/presentation/dialogs/client_search_dialog.dart` — ✅ correcto
- Debounce 300 ms cancelado en dispose junto al controller (66-71); `mounted` en ambos setState (92, 99); 3 estados + vacío (190-223); ellipsis en nombre/ciudad.

### 3.24 `lib/features/pedidos/presentation/dialogs/price_warning_dialog.dart` — ✅ correcto
### 3.25 `lib/features/pedidos/presentation/dialogs/delete_line_dialog.dart` — ✅ correcto
- Diálogos puros de confirmación, formatos vía `PedidosFormatters`.

### 3.26 `lib/features/pedidos/presentation/widgets/drafts_bottom_sheet.dart` — ⚠️ corregido
- 🔧 **FIX (Pilar 4):** el borrado de borrador hacía `Navigator.pop(context)` tras `await provider.deleteDraft(key)` sin `context.mounted`. Guard añadido.
- ✅ Estado vacío correcto; carga de borrador síncrona con SnackBar de confirmación.

### 3.27 `lib/features/pedidos/presentation/widgets/unit_selector_modal.dart` — ✅ correcto
- Controller disposed (78-81); coma decimal parseada (480-482); el caller (`onQuickAdd`) valida qty ≤ 0; equivalencias y stock por unidad visibles.

### 3.28 `lib/features/pedidos/presentation/widgets/tarifa_selector_modal.dart` — ✅ correcto
- Sin async ni controllers; estado "Sin tarifa disponible" cubierto (199-216); selección PT/PU/tarifas con precio por unidad coherente con `displayUnit`.

### 3.29 `lib/features/pedidos/presentation/widgets/order_kpi_dashboard.dart` — ✅ correcto
- Loading skeleton; margen oculto si `!isMarginVisible` (53-68); `PedidosFormatters.money`; ellipsis en valores.

### 3.30 `lib/features/pedidos/presentation/widgets/mis_pedidos_yoy_bar.dart` — ⚠️ corregido
- ✅ `mounted` en setState tras await (64, 70); `didUpdateWidget` recarga al cambiar vendedor; formato de miles español (0 decimales, sin ambigüedad).
- 🔧 **FIX (Pilar 7):** catch totalmente silencioso → ahora `debugPrint` (la barra se oculta con datos vacíos, comportamiento aceptable documentado).

### 3.31 `lib/features/pedidos/presentation/widgets/analytics_dashboard.dart` — ✅ correcto (código no usado)
### 3.32 `lib/features/pedidos/presentation/widgets/order_trend_chart.dart` — ✅ correcto (código no usado)
- Ninguno de los dos está instanciado en `lib/` (grep `AnalyticsDashboard(`/`OrderTrendChart(`) — código muerto. Sin defectos internos relevantes (división por cero protegida en el painter).

### 3.33 `lib/features/pedidos/presentation/widgets/order_pdf_generator.dart` — ✅ correcto
- Generación estática de PDF con `Printing.sharePdf`; respeta `isMarginVisible` en totales; sin estado ni context tras await problemático (el await final es la propia compartición).

### 3.34 `lib/features/pedidos/presentation/widgets/albaran_info_dialog.dart` — ✅ correcto
- `mounted` en ambos setState (46, 53); 4 estados (loading/error/vacío/data).

### 3.35 `lib/features/pedidos/presentation/widgets/order_empty_state.dart` — ✅ correcto
### 3.36 `lib/features/pedidos/presentation/widgets/sale_type_selector.dart` — ✅ correcto
- CC/VC/NV completos, sin estado.

### 3.37 `lib/features/pedidos/presentation/utils/pedidos_formatters.dart` — ✅ correcto
- `NumberFormat es_ES` centralizado (coma decimal + punto de miles), money 2/3 decimales. Es el formateador de referencia del feature.

### 3.38 `lib/features/pedidos/data/pedidos_offline_service.dart` — ✅ correcto
- Hive cifrado (AES con clave derivada); lectura de borradores tolerante a entradas corruptas (try por clave, 86-95).
- 📌 Observación (Pilar 7 — anotada para backend): `syncPendingOrders` reenvía `createOrder` sin clave de idempotencia; si la app muere entre el POST exitoso y el `box.delete`, el siguiente arranque **duplicaría el pedido**. Mitigación actual: marca `failed` los fallidos (no reintenta infinito). Requiere idempotency-key extremo a extremo → BLOQUEOS.

### 3.39 `lib/features/pedidos/data/pedidos_order_api.dart` — ✅ correcto
- Adaptador fino sobre `PedidosService` para testabilidad; sin lógica.

### 3.40 `lib/features/pedidos/data/pedidos_favorites_service.dart` — ✅ correcto
- Hive cifrado; toggle/add/remove consistentes. (El defecto estaba en el provider que no lo invocaba — fix en 3.2.)

---

## 4. CORE COMPARTIDO

### 4.1 `lib/core/cache/cache_service.dart` — ⚠️ corregido
- ✅ Claves saneadas (límite Hive), TTLs definidos, capa de memoria con LRU, `getStale` para fallback en redes malas, invalidación por prefijo que cubre memoria y disco.
- 🔧 **FIX (Pilar 6 — datos stale):** la capa en memoria fijaba SIEMPRE 5 min de vida, ignorando el TTL real de la entrada: datos con `realtimeTTL` (1 min — stock, draft-status, resumen de cobros) podían servirse **hasta 5 minutos** caducados. Ahora `_setMemoryCache` recibe el TTL efectivo (en `set()`) o el tiempo restante (en `get()`) y lo capa a 5 min como máximo.

### 4.2 `lib/core/offline/data_preloader.dart` — ✅ correcto
- Singleton con flag `_isLoading` anti-reentrada (36-45); solo precarga online; errores por endpoint capturados y contabilizados sin romper el lote (99-102). Precarga secuencial de 20 clientes — es warm-up en background, no bloquea UI. Sin defectos que requieran fix.

### 4.3 `lib/core/providers/dashboard_notifier.dart` — ✅ correcto
- `AsyncNotifier` con `AsyncLoading`/`AsyncError` correctos (Pilar 6); fetch paralelo con `Future.wait`; cada sub-fetch degrada a null/[] con log sin tumbar el conjunto.
- 📌 Observación: si el provider (autoDispose) se destruye con `fetchAll` en vuelo, la asignación a `state` lanzaría `StateError` (limitación de Riverpod 2.x sin `mounted` en notifiers). La página de dashboard vive en el `LazyIndexedStack`, así que en la práctica no se destruye mientras hay fetch. Anotado; el fix limpio llega con Riverpod 3.

### 4.4 `lib/core/widgets/fi_filters_widget.dart` — ⚠️ corregido
- ✅ Jerarquía FI1→FI2→FI3/FI4 con limpieza de dependientes al cambiar el padre (282-334); dropdowns deshabilitados coherentemente; "Limpiar filtros" restablece todo.
- 🔧 **FIX (Pilar 4):** los 5 loaders (`_loadFi1Options`…`_loadFi5Options`) hacían `setState` tras await sin `mounted` (incluido el `finally`) — destruir el widget con una petición en vuelo = crash. Guards añadidos en los 5 (cuerpo y finally).

### 4.5 `lib/core/navigation/navigation_service.dart` — ✅ correcto (con observaciones)
- Servicio declarativo de tabs.
- 📌 Observación 1: la condición `if (tab.id == 'comisiones' || tab.id != 'comisiones')` (línea 51) es una tautología (siempre true). No produce bug (significa "incluir todo" para jefe/showCommissions) pero es código confuso — anotado.
- 📌 Observación 2: **este servicio no es el que usa `main_shell`** (que usa `NavigationConfigService` de `lib/core/services/`); sus `pageBuilder` son `SizedBox` stub. Posible código paralelo/muerto a consolidar.

### 4.6 `lib/features/dashboard/presentation/pages/main_shell.dart` — ✅ correcto (verificación solicitada)
**Sincronía `_getNavItems` ↔ `_buildCurrentPage` verificada elemento a elemento:**
- **JEFE_VENTAS** — `NavigationConfigService`: `[Panel] + _ventasItems` = Panel, Clientes, Ruta, Objetivos, Comisiones, Facturas, Pedidos, Glacius, Cobros, Bolsa, Chat IA (11). `LazyIndexedStack` (líneas 1387-1408): DashboardContent, SimpleClientListPage, RuteroPage, ObjectivesPage, CommissionsPage, FacturasPage, PedidosPage, KpiDashboardPage, CobrosPage, **BolsaPage**, ComingSoon. **11 = 11, orden 1:1 ✓** (Comisiones nunca se filtra para jefe — el filtro de la línea 49-51 solo aplica a `!isJefeVentas`).
- **COMERCIAL** — resolución **por label** (`comercialPageForIndex`, líneas 1446-1526): inmune a desincronización de índices; todos los labels de `_ventasItems` tienen su `case` (el case 'Evolución' es inalcanzable en este modo, inocuo). Si `showCommissions=false` se elimina el item y el stack se genera con `comercialNav.length` — consistente ✓.
- **REPARTIDOR** — también por label (1293-1356); labels de `_repartidorItems` todos cubiertos (+Panel si jefe) ✓.
- `safeIndex = _currentIndex.clamp(0, navItems.length - 1)` (línea 390) protege de índices fuera de rango al cambiar de rol/permisos ✓. `setUserRole` se sincroniza post-frame con guard `mounted` (375-378) ✓.
- 📌 Observación: el modo JEFE usa stack por índice (no por label); cualquier cambio futuro de orden en `_ventasItems` debe replicarse en las 11 children (los tests de navegación 11/11 lo cubren).

### 4.7 `lib/core/services/navigation_config_service.dart` — ✅ correcto (revisado por ser la fuente real de navegación)
- Fuente única de items por rol; filtro de Comisiones correcto (49-51).

---

## 5. RESULTADOS DE VERIFICACIÓN (después de los fixes) — DEFINITIVOS

> Comandos ejecutados desde la raíz del repo (PowerShell), sesión seguimiento IVA 2026-06-12:

- `flutter test test/features/pedidos/ test/features/cobros/ test/features/bolsa/`
  - **ANTES (auditoría inicial):** 27/27 passed → **DESPUÉS fix IVA:** **27/27 passed** ("All tests passed!"). Ningún test que pasara antes falla después.
- `flutter test test/widgets/ test/services/ test/integration/navigation_test.dart test/integration/navigation_full_test.dart` (widgets tocados/relacionados + sincronía de navegación verificada en 4.6):
  - **DESPUÉS fix IVA:** **164/164 passed** ("All tests passed!"), incluye `order_status_badge_test.dart` (23 tests) y los tests de items de navegación por rol.
- `flutter analyze`
  - **ANTES (auditoría inicial):** 0 errors / 2 warnings / 7110 infos.
  - **DESPUÉS fix IVA:** **0 errors / 2 warnings / 7113 infos** (las 2 warnings siguen siendo las preexistentes de `conflict_resolver.dart:185,273`; **cero errores nuevos**).

---

## 6. REGISTRO DE PROBLEMAS (consolidado)

| # | Severidad | Archivo:línea (original) | Problema | Fix |
|---|---|---|---|---|
| 1 | 🔴 Alta | `order_preview_sheet.dart:1448` | Resultado `blocked` por stock mostrado como "Pedido confirmado correctamente" + pop que cerraba el diálogo equivocado | Éxito solo si `isConfirmedOrderResultForProvider`; banner de error con mensaje del backend |
| 2 | 🔴 Alta | `cobro_detail_screen.dart:628-632` | Errores parciales huérfanos bloqueaban el botón Cobrar sin campo visible que corregir | Limpieza de `_partialErrors`/`_partialAmounts` al salir de PARCIAL |
| 3 | 🔴 Alta | `cobro_detail_screen.dart:205` | Selección no se limpiaba tras cobro exitoso → riesgo de segundo cobro accidental del resto pendiente | Clear de `_itemStates`/`_partialAmounts`/`_partialErrors` tras éxito |
| 4 | 🔴 Alta | `cobros_page.dart:121-180` | Error del API de resumen silenciado → pantalla mostraba 0,00€ como dato real | `provider.error` → `_loadError` → vista de error con Reintentar |
| 5 | 🔴 Alta | `pedidos_page.dart:2343/2398/2456` | `confirm ?? false && mounted` nunca comprobaba `mounted` (precedencia) | `(confirm ?? false) && mounted` ×3 |
| 6 | 🔴 Alta | `pedidos_provider.dart:1524` | Favoritos no se persistían (se perdían al reiniciar) | Persistencia Hive en `toggleFavorite` |
| 7 | 🟠 Media | `product_detail_sheet.dart:92-100`, `product_history_sheet.dart:169`, `stock_alternatives_sheet.dart:92-146`, `fi_filters_widget.dart` (×5 loaders) | `setState` tras await sin `mounted` → crash (null-check) si se cierra la vista con petición en vuelo | Guards `mounted` añadidos (10 puntos) |
| 8 | 🟠 Media | `cobros_provider.dart:482` | Provider autoDispose con recarga fire-and-forget → `notifyListeners()` tras dispose | Flag `_disposed` + override `notifyListeners` |
| 9 | 🟠 Media | `cobros_page.dart:351-357` | Formato "1.234.56€" (regex de miles sobre decimal con punto) | `NumberFormat es_ES` |
| 10 | 🟠 Media | `pedidos_page.dart:2067` | `_debounceTimer` sin cancel en dispose → callback sobre context destruido | Cancel en dispose |
| 11 | 🟠 Media | `pedidos_page.dart:2312`, `2296`, `2269` | Anular sin try/catch (crash sin feedback); duplicar/clonar/borrador con falso éxito | try/catch + verificación de `prov.error` |
| 12 | 🟠 Media | `add_to_order_sheet.dart:259`, `order_summary_widget.dart:1107-1142` | Negativos aceptados; validaciones sin mensaje; precio 0 en líneas de venta | Clamp + SnackBars + regla SC |
| 13 | 🟠 Media | `order_filters_bar.dart:404-430` | Controllers recreados en cada build (no se podía teclear importes) + filtros visualmente sucios tras "Limpiar" | Controllers persistentes + `didUpdateWidget` |
| 14 | 🟠 Media | `product_history_sheet.dart:473 y tabla` | Coste visible para roles sin `isMarginVisible` (Req #2) | Coste → '—' como el margen |
| 15 | 🟠 Media | `cache_service.dart:262-276` | Capa memoria servía datos `realtimeTTL` hasta 5 min | TTL de memoria capado al TTL real |
| 16 | 🟡 Baja | `bolsa_page.dart` (varios) | Importes sin formato español | `NumberFormat es_ES` |
| 17 | 🟡 Baja | `cobros_models.dart:305` | `int.parse` en fecha dd/mm/yyyy malformada → FormatException | `int.tryParse` + fallback |
| 18 | 🟡 Baja | `order_summary_widget.dart:195`, `drafts_bottom_sheet.dart:129`, `add_to_order_sheet.dart:1402` | `pop`/uso de context tras await sin mounted | Guards |
| 19 | 🟡 Baja | `verificarEstadoCliente`, `mis_pedidos_yoy_bar`, `add_to_order_sheet.catchError` | Catches 100% silenciosos | `debugPrint` (+notify donde aplica) |
| 20 | 🔴 Alta | `product_detail_sheet.dart:316-328`, `pedidos_provider.dart:754-761/1659-1666`, `product_card.dart:46-48` | Mapeo IVA hardcodeado inconsistente (ficha '1'→21%; provider '2'→4%, '3'→0%; card fijo 21%) | Centralizado en `pedidos_service.dart` (`kIvaRatesByCode`, `ivaRateFromCode`, `ivaLabelFromCode`) con mapeo DSEDAC verificado {1:10%, 2:21%, 3:4%, 4:0%, 5:10%} |

---

## 7. BLOQUEOS — ESTADO FINAL

| # | Bloqueo | Estado | Notas |
|---|---|---|---|
| 1 | **Mapeo de códigos de IVA inconsistente** | ✅ **RESUELTO** | Agente DB2 verificó contra DSEDAC/LFC: `{1:10%, 2:21%, 3:4%, 4:0%, 5:10%}`. Fix: `pedidos_service.dart:2171-2210` (`kIvaRatesByCode`, `ivaRateFromCode`, `ivaLabelFromCode`); consumido en `pedidos_provider.dart:754,1652`, `product_detail_sheet.dart:361`, `product_card.dart:46-48`, `pedidos_provider_v3.dart:632` (código muerto, alineado por consistencia). Verificación: `flutter analyze` 0 errores; 27/27 features + 164/164 widgets/navegación. |
| 2 | **Idempotencia cola offline pedidos** | 🔴 **PENDIENTE (backend)** | `pedidos_offline_service.syncPendingOrders` reenvía `createOrder` sin idempotency-key end-to-end. El modelo `OrderDraft` ya tiene campo `idempotencyKey` (`pedidos_service.dart:820-866`) pero el flujo offline no lo genera ni el backend lo valida de forma idempotente. Los cobros ya implementan `buildCobroIdempotencyToken`. Requiere contrato API + backend; **no implementado** (fuera de alcance Flutter-only). |
| 3 | **Casts duros en `cobros_models.dart`** | 🟠 **PENDIENTE (post-demo)** | `fromJson` usa `as num`/`as int?`. Tests de contrato actuales pasan con el payload real del backend. Migrar a parsers tolerantes (patrón bolsa/pedidos) es cambio de riesgo medio en modelos compartidos; coordinar con agente backend. |
| 4 | **Bolsa con vendedor "ALL"** | 🟠 **PENDIENTE (decisión producto)** | `bolsa_page.dart:36-46`: con "ALL" no recarga y muestra datos del último vendedor. No es crash; requiere decisión de UX. |
| 5 | **Código muerto post-demo** | 🟡 **PENDIENTE (limpieza)** | Sin borrar por prudencia pre-demo: `entrega_detail_sheet.dart`, `albaran_card.dart`, `cobros_filters.dart`, `cobros_summary_card.dart`, `promotions_banner.dart`, `analytics_dashboard.dart`, `order_trend_chart.dart`, `pedidos_provider_v3.dart`, `navigation_service.dart`, `pedidos_page_first.txt`. |
| 6 | **Warnings `conflict_resolver.dart`** | 🟡 **PENDIENTE (fuera alcance)** | 2 warnings preexistentes en `lib/core/offline/conflict_resolver.dart:185,273`. Flujo offline compartido; no tocado en esta auditoría. |
| 7 | **GuardVibe MCP no disponible** | ℹ️ **INFO** | `scan_file` no accesible en este entorno. Revisión manual en cada fix. |
| 8 | **`ref.watch` en callbacks** | 🟡 **PENDIENTE (post-demo)** | 3 puntos en pedidos; sin impacto funcional observable. Normalizar a `ref.read`. |

---

## 8. ARCHIVOS EDITADOS

**Auditoría inicial (18):** `bolsa_page.dart`, `cobros_models.dart`, `cobros_provider.dart`, `cobros_page.dart`, `cobro_detail_screen.dart`, `pedidos_page.dart`, `pedidos_provider.dart`, `add_to_order_sheet.dart`, `order_summary_widget.dart`, `order_preview_sheet.dart`, `product_detail_sheet.dart`, `product_history_sheet.dart`, `stock_alternatives_sheet.dart`, `order_filters_bar.dart`, `mis_pedidos_yoy_bar.dart`, `drafts_bottom_sheet.dart`, `fi_filters_widget.dart` (core), `cache_service.dart` (core).

**Seguimiento IVA (+3):** `pedidos_service.dart` (constantes centralizadas), `product_card.dart`, `pedidos_provider_v3.dart`.

Sin commits (según instrucciones). Sin cambios en `backend/`. Sin archivos nuevos en la raíz.
