# Pedidos en tablet · informe de verificación

Run `orders-tablet-20261102` · rama `codex/orders-tablet-demo-20261102` · base `test` en `4a36ddd`. El ensayo empezó el 2 de noviembre de 2026 y continuó el 3 de noviembre en Europe/Madrid.

La ampliación posterior confirma el cálculo del margen sobre venta y la carga reconciliada del censo ERP en la tabla TEST. La activación del suelo sigue pendiente de una política económica acreditada. [Plan de suelo absoluto](orders-hard-floor-plan.md)

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
| Backend Jest | 3443 pasaron, 3 fallaron, 2 omitidas. Exit 1. | `f02402d`, 3792 pasaron, 2 omitidas. Exit 0. Incluye las 23 pruebas del importador. |
| Lint oficial backend | Exit 2 porque el patrón TS se ignoraba. El diagnóstico TS separado ya encontró 242 errores. | JavaScript pasó. TypeScript conserva 242 errores y 0 warnings, en 28 archivos. Exit 1. |
| Flutter test | 1140 pasaron, 6 fallaron. Exit 1. | Tras las mejoras de Cobros, Liquidación y Promociones, 1241/1241. Exit 0. |
| Flutter analyze | 0 errores, 0 warnings, 7570 infos. Exit 1. | 0 errores, 0 warnings, 7635 infos. Exit 1 por infos fatales. |

[Base](audits/orders-tablet-20261102/baseline-evidence.json) · [Backend](audits/orders-tablet-20261102/backend-seed-release-checkpoint.json) · [Flutter](audits/orders-tablet-20261102/flutter-promotions-ux-checkpoint.json)

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

**Catálogo de política en JAVIER TEST · DONE.** El importador leyó DSEDAC y cargó 6.235 productos únicos en JAVIER.TEST_POLITICA_PRECIO_ART. La tabla pasó de 0 a 6.235 filas. Una conexión independiente comprobó todas las filas después del commit. La segunda ejecución insertó 0 filas, actualizó 0 y conservó las 6.235. Se registraron 5.543 tarifas presentes, 11 alternativas, 245 conflictos y 436 ausencias. [Evidencia nativa](audits/orders-tablet-20261102/pricing-seed-native-final.json)

**Suelo de venta · PARTIAL.** La fórmula de margen sobre venta está probada. El coste de 0,80 € y un margen del 20 % dan un suelo de 1,00 €. La búsqueda en el catálogo de DB2 identificó un coste histórico por línea en DSEDAC.LAC y la unidad maestra en DSEDAC.ART. No acreditó el coste de fabricación ni el margen objetivo por unidad de venta. La política antigua etiqueta todas sus filas como cajas y 1.231 artículos activos carecen de unidad maestra. Por ello las 6.235 filas se conservaron sin política económica verificada. Falta acreditar coste, margen y unidad, activar la comprobación del neto en cada escritura y verificar que promociones, especiales y Bolsa no eluden el suelo. [Metadatos de coste y unidad](audits/orders-tablet-20261102/pricing-erp-cost-authority.json) · [Búsqueda de autoridad económica](audits/orders-tablet-20261102/pricing-manufacturing-cost-search.json) · [Plan de integración](orders-hard-floor-plan.md)

**Escritura y retirada en producción · BLOCKED.** La comprobación más reciente encontró HTTP 503 en readiness y tres buffers ausentes en JAVIER. El proceso no superó los requisitos de producción. El ensayo requiere recuperar readiness, provisionar y verificar los destinos y demostrar el aislamiento o la compensación de secuencias, pedidos, Bolsa, cobros y liquidación. No se cambió el perfil instalado ni se insertaron o borraron registros en producción. [Preflight](audits/orders-tablet-20261102/pricing-seed-resume-preflight.json)

### Reanudación del 4 de noviembre

El acceso al servidor por VPN y SSH funcionó. El servicio instalado respondió HTTP 503 con DB2, Redis, sesiones y liquidación disponibles. Su comprobación de PIN registró 67 hashes de 68 y señaló B2. El servidor sigue en `staging` con `isolated_test`, escrituras de producción deshabilitadas y sin exportación ERP autorizada. [Sonda interna](audits/orders-tablet-20261102/resume-20261104-readiness-preflight.json)

El censo de acceso encontró 92 códigos GMP y 67 perfiles con una fila de login activa y PIN ERP. De esos 67, 66 tienen hash y B2 es la única ausencia. Los otros 25 códigos se reparten en 23 sin ficha de PIN, uno con ficha inactiva y uno sin ficha maestra. Diez tienen alguna marca de movilidad. B2 está marcado para reparto, sin vehículo ni entregas en CPC y con una preparación en OPP. Esto acredita cómo lo interpreta el ERP, pero no identifica al titular ni confirma su vigencia operativa. La comprobación de disponibilidad usa un conjunto distinto del login y cuenta un registro adicional. [Censo redactado](audits/orders-tablet-20261102/resume-20261104-auth-population.json)

Los cuatro registros activos de almacén están vinculados a ERP. Ninguno reúne las condiciones de login ni de modo Almacén. El modo se ofrece a supervisores y el chequeo de `ADMIN` usa un campo ERP de un carácter. `APPUSUARIOS` y sus grupos no aportan un vínculo válido para estos perfiles. La auditoría no habilitó cuentas, cambió roles ni mostró credenciales. [Censo y fuentes](audits/orders-tablet-20261102/resume-20261104-auth-population.json)

Las tres tablas necesarias del perfil TEST están presentes. Las seis tablas observadas de estado, Bolsa y finanzas usan `JAVIER.QSQJRN` con imágenes `*BOTH`. Las tres contrapartes de producción siguen ausentes. No se ejecutó DDL. [Diario TEST](audits/orders-tablet-20261102/resume-20261104-test-journal.json) · [Estructura de buffers](audits/orders-tablet-20261102/resume-20261104-test-buffer-shape.json)

La sonda financiera corregida seleccionó DEMO en un proceso aislado. En solo lectura verificó un documento real de la fecha, hizo 22 consultas, cerró las conexiones físicas y terminó con salida 0 y cero mutaciones. QA y seguridad aprobaron ese modo. Seguridad vetó `Run` porque verificaba el delta después de confirmar y su preflight inmediato de tablas de destino era incompleto. No se registró un cobro ni una liquidación. [Evidencia](audits/orders-tablet-20261102/resume-20261104-finance-readonly.json)

La consulta de catálogo posterior encontró cero disparadores en las tres tablas financieras implicadas, clave primaria por ID, unicidad de token y unicidad adicional por comercial y fecha en liquidación. Falta integrar esas comprobaciones en la sonda de escritura. La reconciliación comercial actual leyó 10 bolsas, 27 movimientos, 39 pedidos y 32 reservas sin diferencias en los saldos verificables. [Catálogo financiero](audits/orders-tablet-20261102/resume-20261104-finance-catalog.json) · [Reconciliación](audits/orders-tablet-20261102/resume-20261104-commercial-reconciliation.json) · [Stock y bolsa antes del ensayo](audits/orders-tablet-20261102/resume-20261104-order-stock-preflight.json)

De los 6.235 artículos ERP, 3.549 tienen tarifa 2 positiva y única y una unidad reconocida para el piloto. Entre los 2.937 artículos activos, son 1.334. La lectura confirmó el ejemplo de `1009`, cuya tarifa es 4,1240 € por kilo. Estos recuentos describen la cobertura de tarifa y unidad. No aportan coste de fabricación ni margen objetivo. [Lecturas de precio y unidad](audits/orders-tablet-20261102/resume-20261104-tariff-unit-preflight.json)
