# Auditoría de pedidos comerciales en tablet — 02/11/2026

Run: `orders-tablet-20261102`. Base: `test` (`4a36ddd`), rama `codex/orders-tablet-demo-20261102`.
Estado inicial: **NO APTO para declarar demo completa**. Este documento registra evidencia de código; no convierte pruebas simuladas en pruebas de DB2 o dispositivo.

## Alcance y seguridad

Se revisan pedidos, bolsa, catálogo/precios, stock, sincronización offline y cobro/liquidación del comercial. Reparto sólo se consulta como dependencia; no se amplía su comportamiento. Lecturas ERP: DSEDAC/DSED. Validaciones con escritura: exclusivamente JAVIER y tablas aisladas TEST. No se han leído archivos de secretos ni ejecutado deploy, DDL/DML productivo o cambios de PM2. Los cambios locales preexistentes de AGENTS.md, builds y dos herramientas de ventas se conservan fuera de los commits de este run.

## Mapa extremo a extremo

| Capa | Implementación real | Observación |
|---|---|---|
| Entrada / catálogo / carrito | `lib/features/pedidos/presentation/pages/pedidos_page.dart:358,1843,2010`; `widgets/product_search_widget.dart:38`; `widgets/add_to_order_sheet.dart:204`; `widgets/order_line_tile.dart:203` | Paginación y listas virtualizadas existentes; búsqueda actualmente remota y con 300 ms de espera. |
| Estado / confirmación | `lib/features/pedidos/providers/pedidos_notifier.dart:750,1622,1741`; `pedidos_provider.dart` | Confirmación encola primero; refresca bolsa al terminar. El guard de acumulación actúa sobre borradores de servidor. |
| Persistencia offline | `lib/features/pedidos/data/pedidos_offline_service.dart:132,221,260,330,624` | Hive separa borradores editables y cola de pedidos finalizados. Idempotencia durable y fallos parciales existen; faltan backoff temporal y exclusión entre drenajes simultáneos. |
| API Flutter | `lib/features/pedidos/data/pedidos_order_api.dart`; `pedidos_service.dart:120,1186` | Modelos de precio, unidad e impacto de bolsa. La tabla competitiva aún no alimenta el nuevo pedido. |
| Rutas backend | `backend/routes/pedidos.js:630,1521`; `backend/services/pedidos/write.js:1` | Fachada delega en index; crear usa clave de idempotencia. |
| Reglas y almacenamiento | `backend/services/pedidos/index.js:72,1210,1557,3021,4061,4206,4341,4449,4549,4615`; `_shared.js:33,67,75` | SQL parametrizado; tablas resueltas por db2AppTable; transacciones sólo en ciertas ramas. |
| Bolsas | `backend/routes/bolsa.js`; `backend/services/bolsa-comercial.service.js:16,120,262,290,382`; `lib/features/bolsa/` | Ledger mensual por vendedor: ACUMULACION sobre referencia, CONSUMO bajo referencia. No es el total de ventas. |
| Cobro comercial | `backend/routes/cobros.js:713,936,967,1041,1111`; `lib/features/cobros/providers/cobros_provider.dart:844,864,917` | Overlay de deuda e idempotencia existen. No está acreditada una regla de cobro por fecha de entrega. |
| Liquidación comercial | `backend/services/comercial-devoluciones-service.js:85,812,877,921`; `backend/routes/comercial-liquidacion.js:262`; `lib/features/liquidacion_comercial/` | Guardado aislado en JAVIER.TEST_LIQUIDACION_COMERCIAL; falta veto de periodo sin cobros y arrastre acreditado. |
| Entornos | `backend/config/load-env.js:6,93,124`; `config/reparto-runtime.js:259`; `utils/db2-schemas.js:35,125`; `utils/comercial-erp-tables.js:106`; `order-states.js:129` | Variables independientes. No hay APP_ENV único ni env:verify comercial. |

Las referencias anteriores corresponden a la base auditada; los parches posteriores pueden desplazar líneas.

## Tablas y significado verificado en código

`PEDIDOS_CAB`, `PEDIDOS_LIN`, `PEDIDOS_SEQ`, `PEDIDOS_STOCK_RESERVE`, `PEDIDO_IDEMPOTENCY`, `BOLSA_COMERCIAL`, `MOVIMIENTOS_BOLSA` y `COBROS` se resuelven por `db2AppTable`. El mapeo isolated_test dirige a JAVIER.TEST_* donde está definido. No se afirma que el DDL desplegado coincida: `db2_health` falló con `[odbc] Error connecting to the database`; cualquier columna nueva o migración requiere comprobar QSYS2 al recuperar acceso.

La bolsa usa SALDO_DISPONIBLE, CONSUMIDO y ACUMULADO por vendedor/año/mes. Los movimientos contienen PEDIDO_ID, LINEA_ID, TIPO, IMPORTE, SALDO_ANTERIOR/POSTERIOR, referencia congelada, precio, cantidad, unidad e IDEMPOTENCY_KEY. El índice único consta en `backend/migrations/init-tables.js:440`; su existencia en DB2 no está demostrada.

El umbral es `VDDX.PEDIDOSPENDIENTESSINCRONIZAR`, por vendedor (`backend/services/pedidos/index.js:72-85`). En isolated_test el código lee TEST_VDDX. Cero/nulo desactiva el automatismo. El valor real del comercial no se ha podido consultar.

Stock físico se lee de ARO; se descuentan reservas activas. Precios especiales vienen de la resolución ERP de cliente; promociones usan PRD/PMR/PMRC/PMP/CPES. La migración `048_javier_test_evidence_capture_and_precio_competitivo.sql:22` define JAVIER.TEST_PRECIO_COMPETITIVO con precio, MARGEN_PCT y vigencia. Existe servicio y endpoint; no se ha demostrado que la migración esté aplicada.

## Gaps priorizados

| ID | Prioridad | Existe | Falta o falla | Evidencia inicial / criterio de cierre |
|---|---|---|---|---|
| BAG-01 | P0 | Ledger idempotente y bloqueo de sus tablas | Confirmar pedido/reserva ocurre antes de una transacción de bolsa independiente | `index.js:4382,4385,4449`; una sola conexión/commit debe abarcar las mutaciones y fallar entera ante error. |
| BAG-02 | P0 | Detalle pedido → movimientos | Cancelar confirmado, inversos auditables, movimientos → pedido, reconciliación | `index.js:4615`; `bolsa_movement_detail_sheet.dart:529`. No borrar historia ni revertir ERP unilateralmente. |
| INV-01 | P0 | Reserva por artículo y estado CONFIRMANDO | Lectura de disponibilidad y reserva no serializan pedidos distintos | `index.js:4061,4256,4385`. Dos pedidos no pueden reservar el mismo remanente. |
| INV-02 | P1 | 24 h y purga cada 15 min | Disponibilidad expira por SR.CREATED_AT; purga por C.CREATED_AT | `_shared.js:82`; `index.js:4549`. Una única referencia temporal y frontera exacta de 24 h. |
| OFF-01 | P0 | Cola de confirmaciones distinta de borradores | Endpoint umbral confirma sólo el más antiguo; usa borradores editables | `order-drafts.js:177,214,228`. No confirmar borradores sin finalización explícita. |
| OFF-02 | P1 | Cola durable, reintento y continuidad entre fallos | Drenajes solapados, concurrencia rompe orden, sin nextRetryAt/backoff | `pedidos_offline_service.dart:330,417,624`. FIFO, single-flight, reloj controlado y reintento durable. |
| OFF-03 | P1 | queuedAt local e idempotency key | Timestamp original no viaja al servidor | `pedidos_offline_service.dart:263,355`. Mantener fecha de captura y distinguirla de la reserva física al sincronizar. |
| PRICE-01 | P0 | Tarifa cliente/especial y promociones | UI da prioridad a PRICE promo; confirmación toma tarifa sin regla única | `add_to_order_sheet.dart:204`; `index.js:393-401,980`. Requiere comprobar semántica ERP, no inventarla. |
| PRICE-02 | P1 | Tabla/servicio competitivo con margen | No está conectado a nuevo pedido / último precio | `precio-competitivo-service.js:17,257`; `pedidos_service.dart:120`. Consulta por cliente/artículo y estado de ausencia explícito. |
| STATE-01 | P0 | BORRADOR → CONFIRMANDO → CONFIRMADO; confirmados ineditables | No CANCELLED persistente ni timeline durable; cancelar borra borrador | `_shared.js:33`; `index.js:4615,4649,4741`. Cancelación local sólo si no se ha exportado; ERP exige protocolo acreditado. |
| FIN-01 | P0 | Cobro idempotente y deuda overlay | Sin regla canónica de entrega/fecha para cobro comercial | `cobros.js:967-1013`. No afirmar que hoy se permite por ser lunes. |
| FIN-02 | P0 | Resumen diario / guardado TEST | Puede guardar sin cobros, confía en totales del cliente, arrastre no probado | `comercial-devoluciones-service.js:812,921`. Recalcular desde servidor y rechazar periodo vacío. |
| FIN-03 | P1 | Categorías de cobro existentes | Métodos desconocidos terminan en efectivo; falta cierre PDF/PNG comercial | `comercial-devoluciones-service.js:85-93`. Probar efectivo/tarjeta/transferencia comercial sin alterar reparto. |
| ENV-01 | P0 | Guardas reparto y tablas aisladas | Sin perfil único, banner y comprobación SELECT-only | `load-env.js:6`; `db2-schemas.js:35,125`; `order-states.js:129`. Rechazar contradicciones antes de cargar rutas/tareas. |
| UX-01 | P1 | Catálogo adaptativo, favoritos, estados básicos | Controles 9–14 sp y objetivos pequeños; matriz 200% sin evidencia | `sale_type_selector.dart:35`; `order_line_tile.dart:259,315,642`; `bolsa_page.dart:1430`. Objetivos ≥56 dp y pruebas de overflow. |
| UX-02 | P1 | Búsqueda remota | 300 ms debounce y no índice local completo demostrado | `product_search_widget.dart:38,53`; medición real pendiente. |
| QA-01 | P0 | Suites extensas existentes | Lint inicial falla; suite backend tiene fallos previos; analyze sin resultado | Logs baseline en `docs/audits/orders-tablet-20261102/`. No declarar gate verde. |
| PERF-01 | P1 | Cache stock 30 s, catálogo virtualizado | Sin medición en dispositivo/ODBC disponible | `index.js:2302`; cualquier número debe llevar instrumento y alcance. |

## Semántica que debe preservar la implementación

1. Un borrador local guardado/autoguardado sigue editable y nunca se sube como confirmado automáticamente. Sólo una confirmación explícita alimenta la cola durable de finalizados. Sin red no puede subirse ningún pedido: el escenario con modo avión requiere recuperar conectividad antes de observar envíos.
2. Bolsa se calcula respecto a la referencia comercial existente después de descuentos, por líneas reales. Un reintento no es una nueva venta ni un nuevo movimiento.
3. La reserva física de una captura offline no puede garantizarse antes de contactar al servidor; debe revalidarse al sincronizar. La fecha original de captura y la de adquisición de reserva son conceptos distintos.
4. Ninguna validación de esta auditoría escribe en DSEDAC/DSED. Un perfil llamado production no constituye autorización de exportación ni de deploy.

## Verificación inicial

- DB2 MCP health: error ODBC de conexión. Sin filas reales antes/después.
- `npm run lint`: exit **2**, patrón `src/**/*.ts` completamente ignorado por configuración.
- `npm test -- --runInBand`: en ejecución durante la auditoría; QA detectó fallo previo en `backend/__tests__/repartidor-finanzas.test.js:845` (parámetros de cursor). Resultado definitivo en informe de evidencia.
- `flutter analyze`: iniciado; log vacío y sin resultado válido en el primer corte. No cuenta como PASS.
- Matriz visual/dispositivo, E2E autenticado y latencia móvil: pendientes de disponibilidad y ejecución real.

## Actualización de acceso y datos reales (misma fase, posterior al primer corte)

Se recuperó acceso SELECT-only por SSH al backend real (`/opt/gmp-api/backend`) usando ODBC directamente; no se modificaron tablas ni se desplegó código. QSYS2.SYSCOLUMNS confirmó las diez tablas TEST de esta auditoría y 408 columnas: evidencia `docs/audits/orders-tablet-20261102/db2-catalog.log`. La consulta de catálogo tardó 147,21 ms.

`db2-rows-before.log` contiene filas reales de pedidos y bolsa, sin nombres/direcciones ni credenciales. Entre los pedidos leídos figura el 106, confirmado local, vendedor 35, total 193,89 €. Los umbrales TEST leídos valen 3 para múltiples vendedores. TEST_PRECIO_COMPETITIVO existe y tiene **0 filas**; no faltaba crear su DDL, faltan datos y conexión funcional.

`db2-reconciliation-before.log`: nueve bolsas mensuales con diferencia cero entre CONSUMIDO/ACUMULADO y suma del ledger; movimientos huérfanos=0; claves de movimiento duplicadas=0. Esta reconciliación inicial no demuestra atomicidad de los parches ni una corrida E2E.

Readiness remoto del 02/11/2026 14:25 Madrid: HTTP **503**, transporte 18,588 ms; DB conectada (consulta interna 2 ms), Redis conectado. Falla el chequeo de hashes PIN: 68 vendedores activos, 67 hashes, ejemplo faltante B2. La instancia declara staging, lecturas DSEDAC, buffers JAVIER y escrituras productivas deshabilitadas. No se alteró autenticación. La falta de dispositivo/ADB mantiene bloqueadas las mediciones móviles.

## Integración con catálogo real: precio especial y referencia de Bolsa

Una ficha real completa, obtenida con ocho SELECT y cero DML, detectó un matiz que el primer caso PES aislado no probaba: artículo 2916 tiene PES vigente 29,28 €, pero ANOBAJA=2021 y no aparece en el catálogo activo (`getProducts`, condición `A.ANOBAJA = 0`, `backend/services/pedidos/index.js:1747` en commit `99c5925`). No debe usarse como artículo elegible de demo sólo porque su regla de precio siga vigente.

La búsqueda posterior cruzó PES/CLP con ART activo y ARO: **cliente 4300032888, vendedor 73, artículo 2974, regla PES 28, precio 29,28 €, stock bruto 117 envases/126 unidades**. El umbral del vendedor 73 es 3. Evidencia: `db2-active-special-candidates.json`, `db2-special-customer-owner.json` y `db2-special-demo-availability.json`. El stock bruto no sustituye el recheck neto de reservas al escribir.

La fórmula de referencia de Bolsa permanece tarifa de cliente → tarifa catálogo → mínimo legado. Sin embargo, el catálogo ya convierte el especial ERP en **tarifa de cliente efectiva**: `mergeConfiguredPricing` asigna `next.precioTarifaCliente = price` cuando `precioEspecialCliente` es verdadero (`backend/services/pedidos/index.js:1001` en commit `99c5925`). La ficha real confirma precioCliente=precioTarifaCliente=29,28 y origen DSEDAC.PES. La creación todavía lee ARA/CLC y puede congelar una referencia distinta: eso provocaría un consumo de Bolsa que no coincide con la vista previa. La corrección debe resolver y congelar la misma referencia autoritativa del catálogo en el servidor, sin confiar en flags del cliente. La evidencia está en `demo-product-source-snapshot.json` y la ficha elegible en `demo-active-product-snapshot.json`; la fórmula no autoriza inventar una prioridad entre PES y una promoción PRD global no acreditada.

## Hallazgos en el montaje DDD efectivo

El modo por defecto monta el adaptador DDD de pedidos; la rama legacy queda como alternativa de configuración. En la base entregable anterior a la reparación de rutas, el GET de detalle no solicitaba el modelo de lectura ampliado ni propagaba la paginación de cronología. El PUT de cancelación perdía motivo, rol, dispositivo y clave. Las mutaciones de línea podían conservar un contexto de auditoría procedente del cuerpo. Referencias de la base y del primer candidato: `backend/app.js:827`, `backend/config/reparto-runtime.js:505`, `backend/src/shared/routes/ddd-adapters.js:1854` y `backend/src/modules/pedidos/infrastructure/db2-pedidos-repository.js:129`.

QA y AppSec comprobaron otros tres defectos en los recorridos públicos: alta accesible para un rol de reparto con código coincidente, devolución de coste/margen al comercial en respuestas de mutación y edición de una línea ajena usando la URL de un pedido propio. La primera consulta del servicio de edición identificaba la línea por ID, y derivaba de ella un pedido distinto del que la ruta había autorizado. La firma anterior se usaba desde los dos montajes. Se priorizó esta reparación sobre el índice local de búsqueda. La primera entrega del adaptador fue vetada y nunca se instaló. El trabajo sigue limitado a fuente y pruebas locales.
