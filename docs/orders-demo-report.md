# Pedidos en tablet · informe de verificación

Run `orders-tablet-20261102` · rama `codex/orders-tablet-demo-20261102` · base `test` en `4a36ddd`. El ensayo empezó el 2 de noviembre de 2026 y continuó el 3 de noviembre en Europe/Madrid.

La ampliación posterior confirma margen sobre venta, el censo ERP y la creación de la tabla TEST. Su evidencia actual y el bloqueo de la carga se mantienen en el [plan de suelo absoluto](orders-hard-floor-plan.md).

**Demo bloqueada en preparación.** El último chequeo del proceso instalado devolvió HTTP 503 con exit 22 de curl. El hallazgo inicial de readiness identifica al vendedor activo B2 sin hash PIN. La comprobación más reciente descartó el cuerpo de respuesta. La configuración de la rama se contrastó por separado contra el catálogo DB2. [Guion](demo-script.md) · [Sonda de readiness](audits/orders-tablet-20261102/server-ready-final-probe.json) · [Elegibilidad](audits/orders-tablet-20261102/db2-b2-eligibility.json)

## 1. Evidencia por unidad

| Unidad | Estado | Resultado y alcance |
|---|---|---|
| Descubrimiento y plan | DONE | Mapa extremo a extremo, nueve especialidades, grafo de 12 nodos y 11 aristas, ejecución de un escritor y verificación independiente. [Auditoría](orders-audit.md) · [Plan](orders-plan.md) · [Grafo](audits/orders-tablet-20261102/graph.json) |
| Cola y sincronización | PARTIAL | `99c5925`, `228e0e8`, `6a2f197` entregan cola FIFO durable por sesión, fecha original UTC, ACK canónico, recuperación de respuesta perdida y actualización de pedidos, stock y Bolsa. Focal independiente 104/104 y suite de rama 1215/1215. El ciclo en modo avión y reinicio de un dispositivo real queda pendiente. [Verificación](audits/orders-tablet-20261102/off-bag-final-verification.json) |
| Stock, reserva y estados | PARTIAL | `e594d3b`, `e8fc6de`, `9008cdf`, `c9a99bd` entregan reserva bajo bloqueo, conexiones dedicadas, transición trazable y anulación local reversible. La sonda de alta y concurrencia y la sonda de confirmación local anteriores obtuvieron filas reales. El harness posterior de ciclo completo queda bloqueado y la procedencia del coste en auditoría permanece abierta. [Alta](audits/orders-tablet-20261102/db2-create-integrity.json) · [Confirmación](audits/orders-tablet-20261102/db2-confirm-evidence.json) · [Límite operativo](audits/orders-tablet-20261102/runtime-probe-blocker.json) |
| Acceso y auditoría en el API montado | DONE en fuente | `eaf3214`, 8 archivos, +1003/−253. QA 339/339 y AppSec 260/260. DDD/legacy vinculan pedido y línea; la edición cruzada devuelve 404 antes de consulta de precio o transacción. Detalle DDD devuelve cronología acotada, conserva rol y propiedad y aplica filtrado de costes. Quedan descripciones OpenAPI desactualizadas en dos rutas deshabilitadas, `/status` y `/cart/add`. La versión instalada aún no incorpora el commit. |
| Precios y competitivo | PARTIAL | `466b0e6` conserva referencias verificadas y el descuento comercial. Semilla TEST de 0 a 2 filas reales con reintentos. Falta demostrar la prioridad al coincidir especial y promoción y presentar el competitivo en la interfaz aprobada. El parche de regalos y exportación quedó vetado. [Fuente de precio](audits/orders-tablet-20261102/price-source-verification.json) · [Filas competitivas](audits/orders-tablet-20261102/db2-competitive-seed.json) |
| Diseño y accesibilidad | PARTIAL | `da41622` entrega controles de precio/cantidad, con 25 pruebas. El candidato ampliado obtuvo 81/81 focales y 6/6 goldens, con 72 combinaciones de tres superficies más teclado al 200 %. Quedó vetado por contraste en métricas visibles. Pantallas restantes, safe area y dispositivos siguen pendientes de aceptación. [Verificación](audits/orders-tablet-20261102/flutter-release-checkpoint.json) · [Capturas del candidato](audits/orders-tablet-20261102/renderer-veto/) |
| Búsqueda local y preflight automático | PARTIAL | El candidato de búsqueda pasó 72 pruebas del implementador. El preflight quedó en desarrollo. QA y seguridad independientes de búsqueda se interrumpieron por el límite de uso de los agentes. Los 18 archivos quedaron guardados y fuera de la rama. [Inventario](audits/orders-tablet-20261102/search-preflight-frozen.json) |
| Cobros y liquidación comercial | PARTIAL | `7bc6344` y `f4b025a` entregan reglas de servidor, propietario documental separado del cobrador, totales, idempotencia e historial, con 254 focales independientes de cobros. El cliente de reintento y el ensayo financiero nativo quedaron bloqueados. Quedan por realizar los tres cobros reales y una liquidación nueva de aceptación. El PDF/PNG también está bloqueado por falta de datos inmutables en la revisión guardada. [Cobros](audits/orders-tablet-20261102/collections-backend-verification.json) · [Límite financiero](audits/orders-tablet-20261102/finance-runtime-blocker.json) · [Documento](audits/orders-tablet-20261102/finance-saved-document-blocker.json) |
| Perfiles | PARTIAL | `80684c1`, `562eb49`, `aa5f178` aportan perfil explícito, verificador, indicador y mapeos centralizados. TEST y DEMO comprobaron 11/11 objetos. Producción comprobó 8/11 y queda bloqueada por tres buffers. No se instaló un perfil nuevo. [Configuración](orders-environments.md) · [Catálogo real](audits/orders-tablet-20261102/db2-environment-catalog-verification.json) |
| Guion y repetibilidad | BLOCKED | Guion escrito. Readiness devuelve 503. Hay semilla competitiva ya ejecutada y sonda de reconciliación de sólo lectura. El ciclo completo, reset integral, documento de liquidación y matriz física siguen pendientes. [Guion](demo-script.md) |

### Verificaciones globales

| Control | Base `4a36ddd` | Rama comprobada |
|---|---|---|
| Backend Jest | 3443 pasaron, 3 fallaron, 2 omitidas. Exit 1. | `eaf3214`, 3767 pasaron, 2 omitidas. Exit 0. |
| Lint oficial backend | Exit 2 porque el patrón TS se ignoraba. El diagnóstico TS separado ya encontró 242 errores. | JavaScript pasó. TypeScript conserva 242 errores y 0 warnings, en 28 archivos. Exit 1. |
| Flutter test | 1140 pasaron, 6 fallaron. Exit 1. | Checkpoint sin candidato visual, 1215/1215. Exit 0. |
| Flutter analyze | 0 errores, 0 warnings, 7570 infos. Exit 1. | Checkpoint sin candidato visual, 0 errores, 0 warnings, 7624 infos. Exit 1 por infos fatales. |

[Base](audits/orders-tablet-20261102/baseline-evidence.json) · [Backend](audits/orders-tablet-20261102/ddd-state-release-checkpoint.json) · [Flutter](audits/orders-tablet-20261102/flutter-release-checkpoint.json)

## 2. Bolsa Comercial y reconciliación

La Bolsa es un saldo mensual por comercial. Las líneas bajo la referencia aplicable pueden consumir saldo y las líneas sobre referencia pueden acumularlo según la regla existente. Cada movimiento lleva pedido, línea, signo/tipo, importe, saldo anterior/posterior y clave de idempotencia. En la confirmación local, el pedido, la reserva y el movimiento pasan por la misma conexión y transacción. El servicio de cancelación local invierte el movimiento de su bolsa y periodo originales. La aceptación nativa de esa reversión continúa pendiente.

El umbral por vendedor es `VDDX.PEDIDOSPENDIENTESSINCRONIZAR`; el perfil aislado usa `TEST_VDDX` y se comprobó valor 3 para el vendedor 73. La cola sólo incluye pedidos que el comercial finalizó. Un borrador editable permanece fuera. La fecha original UTC del cliente se conserva como trazabilidad. La reserva de 24 h se cuenta desde la creación en el servidor y la edición mantiene esa fecha. [Consulta del vendedor](audits/orders-tablet-20261102/db2-special-customer-owner.json) · [Evidencia de reserva](orders-evidence.md)

| TEST | Antes | Después comprobado |
|---|---|---|
| Alta del pedido 110, artículo 3519 | Secuencia 34 y sin la fila propia | Número 35, BORRADOR por 30,29 €, línea 126 a 27,54 €, reserva de 1 envase/1 unidad y una clave de alta |
| Alta concurrente del pedido 111 | Secuencia 35 | Número 36, dos respuestas con el mismo ID 111, una marcada replay |
| Confirmación del pedido 108, bolsa 13 | BORRADOR por 28,78 € con 5 % de descuento, saldo 300 €, sin movimiento ni reserva | CONFIRMADO, reserva de 1/1 y un CONSUMO de 1,38 €, saldo 298,62 €. El replay devolvió la misma fila. El fallo inyectado anterior revirtió sus cambios. |
| Competitivo a partir del pedido 106 | 0 filas | Artículo 3519 a 27,54 € y margen 24,69 %. Artículo 3075 a 49,572 € y margen 24,71 %. IDs y valores estables al repetir. |

La reconciliación posterior leyó 10 bolsas, 27 movimientos, 39 pedidos y 32 reservas. Encontró cero duplicados, huérfanos, tipos desconocidos o diferencias de consumo/acumulación. Las cinco bolsas con movimientos cuadraron hasta el saldo almacenado. Las otras cinco carecían de saldo de apertura verificable y la muestra no contenía reversos. Fueron ocho SELECT separados. Los fixtures propios de confirmación y alta se retiraron sin rebobinar secuencias. El pedido 112 conserva la compensación auditada y quedó CANCELADO sin reserva ni movimiento; esa compensación fue una operación de mantenimiento.

[Filas de confirmación](audits/orders-tablet-20261102/db2-confirm-evidence.json) · [Filas de alta](audits/orders-tablet-20261102/db2-create-integrity.json) · [Lectura de reconciliación](audits/orders-tablet-20261102/db2-commercial-reconciliation-current.json) · [Postcheck 112](audits/orders-tablet-20261102/db2-owned112-readonly-postcheck.json)

## 3. Rendimiento medido

| Métrica | Antes | Después | Método |
|---|---:|---:|---|
| Catálogo de 50 artículos, frío | 1.872,33 a 3.297,74 ms, media 2.268,29 ms | Sin comparación válida | Cinco llamadas al servicio instalado con DB2. Faltaban SHA y controles equivalentes de consulta y caché. |
| Catálogo, caché caliente | ~0,01 ms por consulta, una de 0,03 ms | Sin comparación válida | Caché del servicio. |
| Liberación de locks en IBM i | Tres esperas de ~31,5 s con SQL0913 | Observador 2, 3 y 2 ms | Prueba del ciclo físico de la conexión en TEST. |
| Alta TEST y replay | Sin pareja | 324 ms y 113 ms | Pedido 110 sobre conexión real. |
| Alta concurrente TEST | Sin pareja | 6.955 ms | Dos trabajadores con una clave; un pedido. |
| Confirmación TEST y replay | Sin pareja | 278 ms y 12 ms | Pedido 108 con stock y Bolsa. |
| Transición, búsqueda percibida y FPS en tablet | Sin medición | Sin medición | Hardware/emulador indisponible durante las pruebas. |

El experimento comparativo de catálogo quedó bloqueado antes de obtener una pareja equivalente. [Baseline](audits/orders-tablet-20261102/baseline-evidence.json) · [Bloqueo de experimento](audits/orders-tablet-20261102/performance-experiment-blocker.json)

## 4. Mejoras adicionales y límites de revisión

- Cierre físico de conexiones con locks de IBM i, tras reproducir el bloqueo persistente al devolverlas al pool.
- Protección del ACK y de la lectura de refresco frente al cambio de sesión y respuesta obsoleta, con limpieza aislada de la caché.
- Detección temprana de perfiles incompatibles y comprobación de columnas, claves y restricciones de los buffers.
- Reproducción de discrepancias entre las rutas de pedidos montadas por defecto y la ruta legacy, incluida la edición cruzada de líneas.
- Preservación reversible de candidatos vetados, con inventarios SHA y capturas del renderer en el caso visual.

## 5. Operación y comprobaciones pendientes

Antes de un ensayo, identifica el commit, comprueba el perfil desde `backend` y revisa la reconciliación. En la instalación observada, el perfil compatible para conservar DSEDAC/DSED en lectura y JAVIER.TEST_* en escritura es `APP_ENV=demo`. La aplicación instalada debe pasar readiness antes de ejecutar el guion.

```powershell
git status --short
git diff --stat 4a36ddd..HEAD
cd backend
npm run env:verify -- --no-db
npm run env:verify
cd ..
ssh gmp@192.168.1.230 'curl --fail --max-time 8 -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready'
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\audits\orders-tablet-20261102\read-commercial-integrity.ps1
```

La activación de producción requiere validar previamente `JAVIER.PEDIDO_STATE_EVENTS`, `JAVIER.LIQUIDACION_COMERCIAL` y `JAVIER.DEVOLUCIONES_COMERCIAL`, resolver readiness y superar staging, QA, AppSec y aprobación explícita. El procedimiento y sus comandos están documentados en el perfil operativo. [Activación](orders-environments.md#activación-de-producción-pendiente-del-operador)

### Ampliación del mínimo absoluto y prueba en producción

**Mínimo absoluto · PARTIAL, descubrimiento verificado.** El catálogo real devolvió `JAVIER.BOLSA_PRODUCTO_PRECIO` y `JAVIER.TEST_PRECIO_COMPETITIVO`; no apareció una `PRECIO_COMPETITIVO` sin prefijo TEST entre JAVIER, DSEDAC y DSED. La tabla de política por artículo y unidad contiene 2785 filas y las 2785 están activas y vigentes. Sus columnas de coste, margen objetivo y mínimo usan cuatro decimales. La tabla competitiva TEST contiene cliente, artículo, tarifa, precio, margen observado y vigencia. La consulta ERP de especiales resuelve el precio de `DSEDAC.PES` mediante su relación comercial existente. [Metadatos y recuento](audits/orders-tablet-20261102/pricing-hard-floor-db2.json) · [Resolución de precios](../backend/services/pedidos/index.js)

El código calcula el mínimo de la política con coste más recargo y usa en otro camino un porcentaje sobre venta. Además, la Bolsa reconoce una excepción de precio bajo mínimo. Para coste 0,80 € y margen sobre venta del 20 %, el mínimo económico es 1,00 €. Con recargo sobre coste del 20 %, es 0,96 €. A 0,90 €, el margen sobre venta es 11,11 %. Los tres importes representan reglas económicas distintas.

La integración pendiente debe reutilizar la política por unidad y vigencia, definir una sola base de cálculo aprobada, resolver el especial y la promoción ERP, convertir al mismo UOM y comparar el precio neto tras descuentos con el mínimo absoluto. Se debe aplicar en el servidor al crear, editar y confirmar, también al sincronizar offline. La Bolsa puede cubrir descuentos sobre su referencia operativa hasta ese suelo. Deben probarse precio igual, debajo y encima, descuentos combinados, unidad caja/kg, precio especial/promoción, replay y petición manipulada. Falta implementar y verificar ese contrato nuevo.

**Inserción y retirada en producción · BLOCKED.** La nueva solicitud se ha registrado. No se ha insertado, borrado ni cambiado el perfil del servidor. El proceso devuelve HTTP 503 y su catálogo tiene tres buffers de producción ausentes. Una confirmación seguida de DELETE puede haber consumido secuencia, stock, Bolsa, documentos de ERP y auditoría. Todavía no hay un inventario completo y probado de efectos reversibles para una confirmación productiva. Para una futura prueba de escritura se requiere validar las tablas y el journaling de todos los destinos y el límite transaccional del recorrido exacto, con exportación y efectos externos controlados. La comprobación de sólo lectura ya usa fuentes ERP reales. El procedimiento aprobado de despliegue y vuelta a DEMO conserva las guardas existentes.
