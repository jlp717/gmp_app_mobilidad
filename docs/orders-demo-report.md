# Pedidos en tablet · informe de verificación

Run `orders-tablet-20261102` · rama `codex/orders-tablet-demo-20261102` · base `test` en `4a36ddd`. El ensayo empezó el 2 de noviembre de 2026 y continuó el 3 de noviembre en Europe/Madrid.

La ampliación posterior confirma el cálculo del margen sobre venta y la carga reconciliada del censo ERP en la tabla TEST. La activación del suelo sigue pendiente de una política económica acreditada. [Plan de suelo absoluto](orders-hard-floor-plan.md)

**Demo bloqueada en preparación.** La consulta interna del 4 de noviembre devolvió HTTP 503 por cobertura de PIN. El ERP configura B2 como código de reparto y no se ha acreditado su titularidad ni vigencia operativa. La configuración de la rama se contrastó por separado contra el catálogo DB2. [Guion](demo-script.md) · [Sonda de readiness](audits/orders-tablet-20261102/resume-20261104-readiness-preflight.json) · [Censo de acceso](audits/orders-tablet-20261102/resume-20261104-auth-population.json)

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

La segunda sonda confirmó el catálogo en vivo, hizo 37 lecturas y verificó un arrastre de 29,15 € en DSEDAC.LQD. La comprobación posterior con el contrato canónico de cartera se detuvo tras 30 lecturas. El documento tiene 738,46 € pendientes en la consulta directa CVC y no aparece entre los cuatro documentos de la cartera, cuyo total es 4.849,37 €. Las dos ejecuciones cerraron físicamente sus conexiones con cero escrituras. Antes de Run debe seleccionarse un candidato visible en cartera y verificar que sigue siendo cobrable en el ERP. [Preflight de catálogo](audits/orders-tablet-20261102/resume-20261104-finance-catalog-readonly.json) · [Preflight de cartera](audits/orders-tablet-20261102/resume-20261104-finance-canonical-readonly.json)

De los 6.235 artículos ERP, 3.549 tienen tarifa 2 positiva y única y una unidad reconocida para el piloto. Entre los 2.937 artículos activos, son 1.334. La lectura confirmó el ejemplo de `1009`, cuya tarifa es 4,1240 € por kilo. Estos recuentos describen la cobertura de tarifa y unidad. No aportan coste de fabricación ni margen objetivo. [Lecturas de precio y unidad](audits/orders-tablet-20261102/resume-20261104-tariff-unit-preflight.json)

La primera versión del piloto pasó 124 pruebas focales y 72 de regresión. QA detectó una carrera que podía crear una fila de Bolsa fuera de transacción y seguridad detectó rutas que aceptaban pedidos sin autoridad de precio. La segunda versión, `088bb72`, comparte la conexión bloqueada para revalidar mínimo y Bolsa antes de escribir. Rechaza perfiles no verificados y líneas sin unidad o tarifa acreditadas. QA reprodujo 178 pruebas focales. El validador exacto pasó 8 casos con 7 lecturas reales y cero escrituras. El piloto sólo protege la confirmación aislada TEST/DEMO, conserva el comportamiento de producción y no ha sido desplegado. [Prueba nativa exacta](audits/orders-tablet-20261102/resume-20261104-floor-repair2-native-readonly.json)

La suite completa del backend de este candidato pasó 3.809 pruebas con 2 omitidas. El lint oficial conserva los 242 errores TypeScript previos y su log es idéntico al del checkpoint anterior. Flutter `analyze` repitió 7.635 avisos informativos, cero errores y cero advertencias. Windows devolvió un error de espacio durante el intento paralelo. Después de retirar únicamente los dos temporales de esas pruebas, pasaron 26 pruebas focales comerciales y las 1.241 de la suite completa en modo secuencial. [Backend](audits/orders-tablet-20261102/resume-20261104-backend-verification.json) · [Flutter completo](audits/orders-tablet-20261102/resume-20261104-flutter-full-serial.json)

La sonda nativa de pedidos y Bolsa cargó las fuentes del commit `088bb72`. En solo lectura pasó la selección de confirmación local, artículo 1009 en KILO, factor de cinco por envase, stock de 72,5 envases, tarifa cliente de 4,6480 € y mínima de 4,1240 €. La Bolsa mensual ID 14 tenía saldo de 300 €, consumo y acumulación a cero y ningún movimiento. Se cerró la conexión y no hubo escrituras. Esto acredita las precondiciones del ensayo, que todavía requiere alta, confirmación, cancelación y reverso físicos. [Sonda exacta](audits/orders-tablet-20261102/resume-20261104-order-bolsa-readonly-repair2.json)

### Cierre de Gestión de ventas y permisos

La auditoría encontró rutas de escritura de Almacén accesibles con una sesión comercial o de reparto. La corrección exige el rol firmado `JEFE_VENTAS` o `ADMIN` y el modo firmado `ALMACEN` antes de entrar al router. El resolutor de permisos verifica que la ficha recuperada corresponde al sujeto solicitado antes de calcular su rol o su alcance. QA independiente pasó 44 pruebas. Seguridad verificó 27 pruebas y aprobó estos dos cambios. En el ERP se comprobaron 58 perfiles con código numérico entre 67 perfiles técnicos activos, con cero colisiones al normalizar ceros iniciales. Quedan abiertas la concesión comercial por defecto a perfiles sin indicadores de rol y la protección por cuenta de alias ambiguos.

`JAVIER.ALMACEN_PERSONAL` es el directorio operativo de las cuatro personas activas y enlazadas al ERP. No acredita permisos ni sesiones. `DSEDAC.APPUSUARIOS` tiene 31 cuentas GMP sin grupos enlazados y sin cruce con ese directorio o con el login móvil. `APP_LOGIN_LOG` y `APP_USERS` no están desplegadas en JAVIER. El censo no permite conceder accesos de almacén ni justificar una baja de B2 en el ERP. No se tocaron credenciales ni altas.

El catálogo físico de pedidos y Bolsa TEST confirmó los ocho destinos y diario `*BOTH`, sin disparadores. En la ruta de exportación a producción, QA encontró que el código no llama a `beginTransaction` de ODBC, que Bolsa se registra en una transacción posterior, y que la referencia del ERP carece de una restricción compuesta que respalde la numeración entre procesos. Falta el objeto `JAVIER.PEDIDO_STATE_EVENTS` y la aplicación rechaza cancelar pedidos ya exportados. `JAVIER.TEST_CPC` y `JAVIER.TEST_LPC` existen. No se encontró `JAVIER.TEST_OCPC`. La prueba de inserción en producción queda vetada mientras estas condiciones sigan abiertas. [Catálogo nativo TEST](audits/orders-tablet-20261102/commercial-closure-order-native-catalog.json)

El cierre de permisos se guardó en `d7e3e91`. La suite completa pasó 3.818 pruebas y omitió dos. El lint continúa con los mismos 242 errores TypeScript previos, con el mismo hash de salida. [Verificación exacta](audits/orders-tablet-20261102/commercial-closure-auth-verification.json)

Cobros quedó en solo lectura. La primera selección se detuvo ante un tipo de venta sin acreditar. La segunda encontró el límite de coste de DB2 SQL0666. La tercera limitó la búsqueda a tres clientes y completó 115 lecturas, con cero escrituras, sin encontrar un documento visible y cobrable con tipo CC verificado. La consulta acotada posterior verificó tres facturas CC en CVC/CAC/LACLAE por 45,81 €, 383,18 € y 321,14 €. Esas facturas aún deben cruzarse con la cartera real de la aplicación. El modo de escritura además sigue pendiente de reducir su evidencia posterior a agregados. Las sondas retenidas quedaron guardadas de forma reversible en `1042efc`. [Cartera](audits/orders-tablet-20261102/commercial-closure-finance-selection-repair3.json) · [Candidatos ERP](audits/orders-tablet-20261102/commercial-closure-finance-erp-candidate-catalog.json)

DB2 confirmó la comparación de 24 horas sobre cinco marcas de creación almacenadas. La expresión resultó activa un microsegundo antes del límite e inactiva en el límite y un microsegundo después. La muestra contiene 38 pedidos confirmados y uno cancelado, con 32 reservas en confirmados y cero en el cancelado. No había borradores en ese instante. La prueba de reloj es una comparación en solo lectura, sin simular una cancelación ni una reserva nueva. [Límite de reloj DB2](audits/orders-tablet-20261102/commercial-closure-reservation-clock-proof.json)

El detalle Flutter muestra el plazo de reserva y comprueba el estado en el servidor cuando vence. Si falla la consulta, deja de mostrar la reserva como activa y ofrece reintentar. También distingue la reserva liberada. La revisión independiente aprobó el cambio de código. Las cinco pruebas focales pasaron con salida 0. El caso de vencimiento abrió el modal en superficies de 360 × 640 y 1024 × 1366 con escala de texto al 200 %. El fallo y la recuperación se comprobaron en la superficie de teléfono. Son pruebas del renderizador con un adaptador HTTP de prueba. La comprobación en dispositivos, la matriz de orientación y las mediciones de fluidez siguen pendientes. [Pruebas focales](../test/features/pedidos/presentation/order_reservation_detail_test.dart)

| Verificación del commit `a446329` | Salida | Resultado | SHA-256 del log |
|---|---:|---|---|
| `flutter test --no-pub --concurrency=1 --reporter expanded test/features/pedidos/presentation/order_reservation_detail_test.dart` | 0 | 5 aprobadas | `879ADAA70A9A69AEC1ECD90982C2AE4CEA84D76134D752F0935E2569A66F98AE` |
| `flutter test --no-pub --concurrency=1 --reporter expanded` | 0 | 1.246 aprobadas, 10 min 31 s | `CBE0EC8975BD8D65EE77EA6B5640FCE514DC58560E45D5E84FE50D3E03E1F982` |
| `flutter analyze --no-pub` | 1 | 0 errores, 0 advertencias y 7.660 informativos | `F3C1C612156D899C1F0E70C46E06567DDB76AA15F8ABA09E1644C5C5788898F3` |

La comprobación local de Loop Engineering devolvió WARN porque su detección de ejecutables no encontró Flutter y npm. Los resultados anteriores y los del backend corresponden a ejecuciones directas de cada herramienta. El control de publicación sigue en FAIL por readiness, cobertura funcional nativa y verificación en dispositivo.

### Validación de la ruta a producción

SSH confirmó el commit instalado `4a36ddde`, la existencia de `/opt/gmp-api/backend/.env` y HTTP 503 en `/api/ready`. Ese commit carga los selectores heredados y todavía carece del resolutor `APP_ENV`. La selección de perfil de la rama actual se aplica a todo el proceso. Una prueba sobre la instancia compartida requiere aislar el tráfico ajeno para atribuir los cambios a la prueba. El chequeo final informó `writesEnabled=true`, `tableSet=isolated_test`, `productionWritesEnabled=false` y `productionErpWritesApproved=false`.

El catálogo vigente confirma `DSEDAC.CPC`, `DSEDAC.LPC`, `DSEDAC.OCPC` y las tres tablas TEST de auditoría, liquidación y devoluciones. Los tres objetos equivalentes de producción en JAVIER siguen ausentes. El controlador ODBC abrió una transacción nativa, ajustó el aislamiento, consultó el catálogo, ejecutó rollback y cerró la conexión. La prueba hizo cero escrituras. [Prueba ODBC](audits/orders-tablet-20261102/commercial-prod-odbc-readonly.json)

En CPC, LPC y OCPC el catálogo SQL mostró una clave primaria por ID y cero disparadores. Para CPC, la referencia de cinco columnas que usa la app al numerar pedidos carece de restricción única en ese catálogo. La limpieza de un ensayo necesita los IDs propios capturados antes del commit y una barrera que impida que otros procesos consuman las filas durante el ensayo. La API sigue delegando al ERP la cancelación de pedidos exportados. [Claves reales](audits/orders-tablet-20261102/commercial-prod-erp-key-catalog.json)

El commit `d335ff7` hace el cambio a CONFIRMANDO, la comprobación de stock, la exportación, la confirmación local, las reservas y la escritura de Bolsa en una sola conexión ODBC dedicada. El flujo comprueba el estado cuando el controlador no devuelve el recuento del UPDATE. Las pruebas de contrato cubren éxito, rollback cuando falla Bolsa y rollback cuando no se puede acreditar que se confirmó la cabecera. La regresión focal pasó 162 casos. QA y seguridad aprobaron el alcance tras revisar la transacción y el acceso desde ambas rutas de confirmación.

El commit `d1a671c` conserva el proveedor de los cuatro filtros de movimientos de Bolsa. Los filtros muestran etiqueta y recuento en botones de al menos 56 dp, con texto de 18 sp, marca de selección y estado semántico. Las 45 pruebas focales pasaron, incluidas 24 combinaciones del control en teléfonos y tablets, dos orientaciones y escalas 100, 150 y 200 %. La matriz ejecuta el renderizador de Flutter. ADB no detectó dispositivos conectados.

El servicio de liquidación comercial exige `isolated_test` y devuelve `WRITES_TEST_ONLY` fuera de ese modo. El suelo de tarifa sigue como piloto TEST/DEMO. El ensayo integral productivo sigue pendiente del despliegue de una versión compatible en una instancia aislada, la preparación de las tablas y rutas de auditoría y finanzas, la identidad de los registros propios y la aprobación de salud. La instancia compartida conservó `isolated_test`. Se registraron cero cambios de configuración, cero escrituras y cero borrados de datos en producción. [Entornos y verificación](orders-environments.md) · [Grafo de revisión](audits/orders-tablet-20261102/graph-commercial-prod-20261104.json)

La primera regresión completa del backend detectó una aserción estructural que buscaba la rama anterior. El commit `69d0307` actualizó esa aserción y sustituyó una comprobación sobre un fragmento vacío por la ejecución del piloto en perfil producción. El ajuste conserva la comprobación del mínimo antes de cualquier escritura y pasó 24 pruebas focales. La segunda ejecución completa pasó las 3.820 pruebas activas y emitió un aviso de cierre forzado de un proceso de Jest.

| Comprobación | Salida | Resultado | SHA-256 del log |
|---|---:|---|---|
| `npm test -- --maxWorkers=2` | 0 | 320 suites aprobadas, una omitida. 3.820 pruebas aprobadas, dos omitidas | `F2E6021D9F9A82A7C71A281C9B9C13F000417AB53D223467ADFB353E64243F69` |
| `npm run lint` | 1 | 242 errores existentes, cero advertencias. Salida idéntica a la línea base | `741F0B17A5451798BB8B657156BF7805632B382F95DB9038CC4A802A1F090E5C` |
| `flutter test --no-pub --concurrency=1 --reporter expanded` | 0 | 1.270 pruebas aprobadas | `42631455579129394FB7DB287A7B310606E36991373B5DFB94BE2DE1BD7AE981` |
| `flutter analyze --no-pub` | 1 | Cero errores y advertencias. 7.665 informativos | `1F15B1CB9C3976634EF93D3B6635E212296C762321B1BCD58C83208112F22E98` |

### Ensayo nativo del recorrido de pedidos en JAVIER TEST

Se ejecutaron dos ensayos con el código sellado en `87e99f1`, perfil DEMO, lecturas reales del ERP y exportación apagada. El artículo 1009 tenía 72,5 envases disponibles, cinco kilos por envase y tarifas 4,6480 y 4,1240 €. Los pedidos de prueba 113 y 114 usaron una línea de cinco kilos. DB2 registró borrador, reserva, confirmación, cancelación, cinco eventos y un reverso por pedido dentro de la transacción. En ambos recorridos, la Bolsa pasó de 300,00 € a 297,36 € y volvió a 300,00 €. Los tres reintentos conservaron cada instantánea. La reserva desapareció al cancelar y la lectura de stock volvió a la inicial. [Filas del ensayo 113](audits/orders-tablet-20261102/commercial-native-order-run.json) · [Filas del ensayo 114](audits/orders-tablet-20261102/commercial-native-order-run-final.json)

Los dos ensayos terminaron con cero commits físicos y salida 1 de la sonda integrada. El primero perdió el acceso al lector en su bloque de cierre. El segundo acreditó el rollback físico, pero el lector recibió SQL0913 antes de cerrar la conexión de la transacción. Consultas nuevas después del cierre dieron salida 0, cero filas de cada pedido en seis tablas y Bolsa en 300 €, sin consumo, acumulación ni movimientos. El resultado operativo del ciclo queda acreditado dentro de las transacciones TEST y su limpieza mediante verificadores independientes. La ejecución automática en un solo comando sigue pendiente de ordenar el cierre físico antes del postcheck. [Observador 113](audits/orders-tablet-20261102/commercial-native-order-postcheck-113.json) · [Observador 114](audits/orders-tablet-20261102/commercial-native-order-postcheck-114.json)

El preflight exacto encontró ocho tablas TEST journalizadas con imágenes *BOTH y cero disparadores. Se ejecutaron 57 pruebas locales de perfiles, auditoría y capacidad de tablas con salida 0. El ensayo nativo sólo cubre pedidos, reservas y Bolsa. Cobros, liquidación, login real, expiración natural de reservas y ejecución en dispositivo requieren sus propias pruebas. [Preflight sellado](audits/orders-tablet-20261102/commercial-native-order-readonly-final.json)

### Preparación de las tablas productivas

El commit `68826ed` aporta la migración aditiva `051_javier_commercial_production_buffers.sql` para tres tablas de JAVIER. Se contrastaron 48 columnas, tres claves primarias, cuatro comprobaciones de auditoría y cinco índices con el contrato de TEST. El preflight real devolvió cero colisiones de tabla, restricciones e índices. La migración requiere aplicación explícita, una comprobación de catálogo tras aplicarla y verificación física de journaling antes de activar escrituras. No se aplicó en esta pasada. [Comparación de esquema](audits/orders-tablet-20261102/commercial-native-buffer-static.json) · [Nombres reales](audits/orders-tablet-20261102/commercial-native-buffer-names.json)

Los objetos existentes de pedidos y Bolsa de JAVIER usan QSQJRN con imágenes *BOTH. DSEDAC.CPC, LPC, OCPC y LQD tienen diario activo con imágenes *AFTER. IBM documenta que los cambios bajo control de compromiso capturan también las imágenes previas. La consulta fue de metadatos y cerró físicamente con cero escrituras. [Catálogo nativo](audits/orders-tablet-20261102/commercial-native-prod-journals.json) · [Control de compromiso de IBM i](https://www.ibm.com/docs/en/i/7.5.0?topic=objects-journaled-files-commitment-control)

### Escrituras comerciales condicionadas al perfil aplicado

El commit `26aa350` verifica el perfil activo y el catálogo antes de que la auditoría escriba en `JAVIER.PEDIDO_STATE_EVENTS` o se abra la transacción de `JAVIER.LIQUIDACION_COMERCIAL`. La confirmación exportada registra los eventos en la misma conexión que ERP, reserva y Bolsa. La liquidación conserva `DSEDAC.LQD` como lectura y escribe el resultado en el buffer de la aplicación. Las cuatro pruebas nuevas fallaban antes del cambio y pasaron después. QA revisó el enrutamiento y AppSec reprodujo las siete pruebas del archivo. Los positivos emplean un verificador simulado. Las comprobaciones físicas de esos nuevos destinos siguen pendientes. [Pruebas](../backend/__tests__/app-buffer-service-routing.test.js)

| Comprobación posterior a `26aa350` | Salida | Resultado | SHA-256 del log |
|---|---:|---|---|
| Jest focal de enrutamiento, capacidad, auditoría, pedidos y devoluciones | 0 | 90 pruebas en cinco suites | `D6854202AE7CD31A0D6B391BA74504313CC72CDEE1492C70E1634D376A2C9733` |
| `npm test -- --maxWorkers=2` | 0 | 3.824 pruebas aprobadas, dos omitidas. 320 suites aprobadas, una omitida. 494,844 s. Jest avisó del cierre forzado de un worker | `057675ADC179402A2B94FF0957622DBEBA25092DCCFB9FCEC9333CA78AB95DD4` |
| `npm run lint` | 1 | 242 errores existentes y cero avisos. El log coincide byte por byte con la línea base | `741F0B17A5451798BB8B657156BF7805632B382F95DB9038CC4A802A1F090E5C` |

La comprobación SSH del 04/11 confirmó que el servidor continúa con `4a36ddde` y HTTP 503 en `/api/ready`. La cobertura de PIN y la autoridad de B2 siguen pendientes de resolución. El ERP le atribuye un perfil activo y marca de reparto. El pedido exportado todavía exige el protocolo de anulación del ERP. La app rechaza su cancelación directa con `PEDIDO_MANAGED_BY_ERP`. La prueba real de anulación ERP y su conciliación posterior siguen abiertas. [Censo redactado](audits/orders-tablet-20261102/resume-20261104-auth-population.json) · [Contrato de anulación](bolsa-tanda3-req18-ventana.md)

El consumo observado de 2,64 € por pedido concuerda con el redondeo actual. Bolsa redondea primero el precio de venta efectivo de 4,124 € a 4,12 € y calcula `(4,648 − 4,12) × 5`. El cálculo conserva la regla comercial existente. [Implementación](../backend/services/bolsa-comercial.service.js) · [Evidencia nativa](audits/orders-tablet-20261102/commercial-native-order-run-final.json)

### Permisos de acceso y verificación visual

`08573b3` aplica en la búsqueda por nombre exacto el mismo criterio de inactividad ERP que ya aplicaban las búsquedas por código y nombre parcial. La prueba de usuario inactivo falló antes de la corrección. Después pasaron las dos regresiones nuevas y las 32 pruebas focales de acceso, perfiles y alcance de pedidos. Seguridad verificó el predicado y el parámetro enlazado. La validación fue local. [Pruebas de acceso](../backend/__tests__/db2-auth-repartidor.test.js)

El candidato visual del selector de unidades se conserva en `efa6496ffa7c6e9c7df5ccfcd12db804ca716eab`. Tras tres iteraciones, la ejecución quedó en 25 pruebas aprobadas y una fallida. Flutter identifica el desbordamiento de 84 px en la fila de precio mínimo y total en 360 × 640 dp con texto al 200 %. El SHA-256 del log es `CA2040EE9995D490A3B4B42E05BAFCF795093BD0791C7EE9D78795BEE29F104D`. El ajuste fallido queda fuera de la rama verificada. La propuesta pendiente es que ambas etiquetas puedan ocupar líneas independientes con texto grande, y ejecutar de nuevo los 24 escenarios. `flutter devices --machine --device-timeout 5` sólo detectó Windows, Chrome y Edge. `flutter emulators` enumeró dos perfiles Android apagados. Sigue pendiente obtener capturas del candidato y tiempos en un dispositivo compatible.

En finanzas, el siguiente ensayo debe elegir el documento desde la cartera visible del comercial, enlazar el identificador estable `doc.id` y revalidarlo mediante el contrato de pago antes de abrir una transacción. El candidato previo encontrado directamente en CVC quedó fuera de la cartera y las sondas posteriores no certificaron un documento apto. Quedan pendientes los cobros reales y la liquidación completa. [Evidencia de selección](audits/orders-tablet-20261102/commercial-closure-finance-selection-repair3.json) · [Evidencia de cartera](audits/orders-tablet-20261102/resume-20261104-finance-canonical-readonly.json)

La regresión del backend tras `08573b3` pasó 3.826 pruebas, dos omitidas, en 320 suites aprobadas y una omitida. `npm test -- --maxWorkers=2` salió con código 0 y mantuvo el aviso de cierre forzado de un worker. SHA-256 `64576CDF444C034225FD5935F976D9D1F7A1B709EE3ACAE1A2B5ABC9B5E1F15E`. `npm run lint` conservó salida 1, 242 errores anteriores y cero advertencias. Su hash coincide con la línea base. La ejecución del `loop_gate.py` salió con código 0 y estado `WARN`. Detectó la política, aprobó el chequeo de diferencias y el escaneo de secretos, y delegó las comprobaciones Node y Dart en las ejecuciones directas del informe.

`flutter test --no-pub --concurrency=1 --reporter expanded` pasó las 1.270 pruebas de la rama verificada y salió con código 0. SHA-256 `57B03A042B3509E5E308F03F22AF254D5BB429C1CA53AF6522A36539D31534E3`. `flutter analyze --no-pub` salió con código 1 y reprodujo la línea base de cero errores, cero advertencias y 7.665 informativos. SHA-256 `0EC407EC7EB2864B5DE02D5288B9369BDBAF08BA4BC453CFE60FD6D109572E76`.

Los dos intentos SSH finales agotaron los 10 segundos de conexión a puerto 22 y salieron con código 255. La última comprobación válida de este pase conserva `4a36ddde` y HTTP 503. El pase realizó cero cambios de configuración remota, despliegues o escrituras de validación en producción.

### Revalidación con VPN y compilación Android

Con la VPN restablecida, SSH comprobó de nuevo `4a36ddde` y HTTP 503. Una sesión física ODBC verificó que siguen ausentes las tres tablas productivas y encontró seis clientes potenciales con deuda en el ERP. La sonda posterior selló el código de `4a099e8`, abrió el perfil DEMO aislado en memoria y revalidó el primer cliente por la cartera canónica. El documento CC tenía 310,87 € pendientes. Se verificaron la identidad estable, el propietario y el importe del documento, con 14 consultas, ninguna escritura y conexión cerrada. Su huella redactada es `8b29b38741087910608fdfc71f28527a9b240ab7fd7ef9fc0180143d03c73a69`. Este preflight acredita un documento apto, que aún debe pasar el ensayo de cobro y liquidación.

La reconciliación nueva examinó 10 bolsas, 27 movimientos, 39 pedidos y 32 reservas en JAVIER TEST. El resultado fue salida 0, ocho SELECT, conexión cerrada y cero duplicados, huérfanos, errores de reverso o pedidos cancelados con reserva. La batería dirigida del backend pasó 355 pruebas en 19 suites, con salida 0. SHA-256 del log `9E98B65A5C22770609D424E6467A7FACBD1F9FF921AF16C0DCDA0F7DA5DCD201`.

La [sonda reproducible de cartera](audits/orders-tablet-20261102/probe-finance-rollback.ps1) confirmó la misma huella con 15 consultas, conexión cerrada, salida 0 y cero escrituras o commits. QA y seguridad revisaron sus dos archivos y comprobaron que `Run` sale con `RUN_ROLLBACK_UOW_NOT_REVIEWED` antes de conectar. El recorrido que escriba cobro y liquidación requiere una conexión dedicada con rollback físico y un observador posterior al cierre para verificar la restauración.

El APK arm64 de `4.1.48+104` se intentó con la firma release configurada y la URL canónica, con `flutter --no-version-check build apk --release --no-pub --target-platform android-arm64 --dart-define=API_BASE_URL=https://api.mari-pepa.com/api`. Gradle alcanzó `assembleRelease`. El proceso arrancó con 434.302.976 bytes libres en C y el límite de espacio detuvo la compilación con salida 3 tras observar 132.509.696 bytes libres. El directorio `build` apunta a Temp en el mismo disco. No se generó un APK firmado ni se inició el AAB. Los binarios históricos de esa versión corresponden a otro código y quedan fuera del candidato. Se necesita espacio para la compilación completa y luego comprobar ambas firmas y hashes.

Con espacio disponible en el equipo de compilación, los comandos locales para generar y verificar los dos paquetes son los siguientes. La versión permanece en `4.1.48+104` para comprobar el candidato existente. Publicar en Play requerirá su procedimiento de versión y aprobación.

```powershell
flutter build appbundle --release --no-pub --dart-define=API_BASE_URL=https://api.mari-pepa.com/api
flutter build apk --release --no-pub --dart-define=API_BASE_URL=https://api.mari-pepa.com/api
jarsigner -verify build/app/outputs/bundle/release/app-release.aab
& 'C:/Android/build-tools/35.0.0/apksigner.bat' verify --verbose build/app/outputs/flutter-apk/app-release.apk
Get-FileHash -Algorithm SHA256 build/app/outputs/bundle/release/app-release.aab,build/app/outputs/flutter-apk/app-release.apk
```

### Recuperación de disponibilidad y versión 105

El censo del servidor por VPN confirmó una ficha activa para B2, pertenencia GMP, permiso de reparto, sin preventa ni jefatura y cero filas en `JAVIER.VENDOR_PIN_HASHES`. La revisión automática rechazó el simulador oficial porque puede intentar DDL antes de evaluar el modo de simulación. La reparación alternativa verificó el catálogo, la clave, el diario y la ausencia de disparadores antes de insertar una sola fila en la tabla existente. La derivación se hizo en memoria en el servidor. DB2 confirmó cero DDL, actualizaciones o borrados, un commit físico y el cierre de ambas conexiones. Una segunda conexión confirmó el cambio de cero a una fila y su correspondencia con la credencial ERP. `/api/ready` y `/api/health` devolvieron **HTTP 200**. El servidor conserva la revisión `4a36ddde` y el perfil aislado. Esta verificación de disponibilidad no certifica la revisión candidata ni sus recorridos de producción.

La rama aumentó Android de `4.1.48+104` a `4.1.48+105` en `3b6e0aa`. La limpieza acotada liberó cachés regenerables de Flutter, transformaciones de Gradle y dos archivos redundantes de distribución y símbolos. `C:` pasó de aproximadamente 178 MB libres a 2,7 GB antes del primer intento de la versión 105. El intento universal llegó a `assembleRelease`, reconstruyó las transformaciones y se detuvo en 340.635.648 bytes libres. Se conservaron las dependencias descargadas, las claves de firma y los paquetes históricos.

La compresión reversible de los temporales de Flutter y de las transformaciones reconstruidas elevó el espacio disponible de 680 MB a 1.138 MB. El intento arm64 con un trabajador alcanzó Gradle y se detuvo en 264.183.808 bytes libres. Se inició un tercer intento arm64 con los temporales regenerados y un límite de heap menor. La configuración de firma y el identificador de aplicación se mantuvieron.

El tercer intento comenzó con 1.276.321.792 bytes libres y terminó con salida 3 al llegar a 266.702.848 bytes. `android/local.properties` acreditó `flutter.versionName=4.1.48` y `flutter.versionCode=105`. Las rutas de salida de Flutter y Gradle se comprobaron después del intento y no contenían un APK o AAB del candidato. El AAB quedó sin iniciar en los tres intentos. La firma sigue configurada. La compilación requiere espacio adicional fuera de las cachés ya limpiadas o una unidad de trabajo privada con capacidad suficiente.

El ensayo financiero sellado pasó la selección de sólo lectura con 15 consultas y el preflight de las tres tablas con clave primaria `ID`, diario `JAVIER/QSQJRN *BOTH` y cero disparadores. `Run` terminó con salida 1, 37 lecturas, cero escrituras y cero commits. SQLSTATE `42S22`, SQLCODE `-206`, apareció al consultar el control anterior al ensayo, antes de abrir la conexión de escritura. Se verificó en el catálogo y mediante un SELECT que la fecha de cobro de `JAVIER.TEST_REPARTIDOR_COBROS` usa `ANOCOBRO`, `MESCOBRO` y `DIACOBRO`. Las columnas `ANODOCUMENTO`, `MESDOCUMENTO` y `DIADOCUMENTO` corresponden al ledger comercial. La siguiente reparación debe limitarse al filtro de fecha del control de reparto. Loop Engineering y AGENTS.md limitan la unidad a tres iteraciones y esta ejecución las agotó.

El SELECT corregido se comprobó en DB2 con parámetros reales y devolvió cero filas del período, salida 0 y conexión cerrada. La implementación del ensayo se preservó en `c75038c6b59513f5bcdcfeb3ea2247d593b7db38`. La rama mantiene la sonda ejecutable de sólo lectura. La prueba de pedidos, cobros y liquidación en producción sigue pendiente de las tablas requeridas, la verificación de staging y la puerta de activación del proyecto. Durante este pase no se insertaron ni borraron pedidos, cobros ni liquidaciones productivos.

### Comprobación autenticada y repetición financiera del 04/11

El servidor instalado en `4a36ddde` continuó en TEST con lecturas ERP. Las dos cuentas autorizadas iniciaron y cerraron sesión con HTTP 200. La cuenta de mando fue reconocida como `JEFE_VENTAS`, con modo activo `COMERCIAL` y modos disponibles Comercial, Almacén y Reparto. La cuenta comercial fue reconocida como `COMERCIAL`, sin privilegios de jefatura y con modos Comercial y Reparto. La prueba no consultó PIN en claro ni registró credenciales, sesiones o códigos de clientes.

| Lectura autenticada | Jefatura | Comercial |
| --- | ---: | ---: |
| Pedidos | HTTP 200, 126 ms | HTTP 200, 30 ms |
| Bolsa propia | HTTP 200, 22 ms | HTTP 200, 13 ms |
| Cobros | HTTP 200, 7.197 ms | HTTP 200, 10.222 ms |
| Resumen de liquidación | HTTP 200, 854 ms | HTTP 200, 92 ms |
| Catálogo de un cliente autorizado | HTTP 200, 10 productos, 6.292 ms | HTTP 200, 10 productos, 3.550 ms |

Las duraciones son muestras individuales medidas contra el proceso instalado por SSH. No hay medición de renderizado, comparación antes/después ni validación de objetivos de latencia a partir de estas cifras.

El ensayo financiero de excepción cambió únicamente el predicado de fecha de `TEST_REPARTIDOR_COBROS`. La revisión independiente aprobó los hashes exactos y el preflight verificó un documento real por 310,87 €. El ensayo terminó con salida 1 tras 39 lecturas. Pasó la verificación de fecha y se detuvo con `PAYMENT_INSERT_FINGERPRINT_REJECTED` antes de que DB2 recibiera el primer INSERT. El informe de conexión registró cero DML, cero commits, un rollback físico y conexión cerrada. Otro observador verificó cero filas de cobro o liquidación para los seis identificadores del ensayo. No se completó ninguna de las tres modalidades. Los scripts exactos quedaron preservados en `f84d9979108a1b188c9b7ff36c712647c0624f6c`. La excepción autorizada se consumió en esta repetición.

La limpieza del 04/11 retiró cachés regenerables de instaladores, npm, Edge y pnpm. La limpieza validada de modelos y conjuntos descargados en la caché de Hugging Face elevó el espacio libre de 1.953.902.592 a 7.754.678.272 bytes. El inicio de la compilación universal registró 7.754.551.296 bytes libres. Se conservaron los datos de trabajo, las credenciales de firma y la caché de Windows Update en uso.

### Autorización de Bolsa y paquetes Android

En `4a36ddde`, una cuenta `COMERCIAL` obtuvo HTTP 403 para otro vendedor comercial y HTTP 200 para un código ajeno de reparto. El JSON llevaba el código de reparto solicitado. El servicio sólo hace SELECT y puede responder con valores predeterminados, por lo que este resultado no demuestra que existiera una fila para ese código. La causa fue la combinación del filtro del resolutor comercial y la llamada de la ruta con el código original. El cambio local rechaza códigos excluidos por ese filtro antes del acceso al servicio. Conserva el alcance firmado, el código propio y la jefatura autorizada. Tres regresiones reprodujeron HTTP 200 con salida 1. Con la corrección, Jest pasó los 14 casos de la ruta con salida 0. AppSec repitió los 14 casos y verificó el rechazo antes del servicio. La instancia instalada aún no incorpora la corrección. [Ruta](../backend/routes/bolsa.js) · [Pruebas](../backend/__tests__/bolsa_route_contracts.test.js)

Los dos paquetes Android de `4.1.48+105` se compilaron desde el mismo árbol Flutter que `3b6e0aa`. Ambos comandos de Flutter salieron con código 0. Incluyen `arm64-v8a`, `armeabi-v7a` y `x86_64`, con el identificador `com.maripepa.gmp_mobilidad`. `aapt` y Bundletool 1.18.1 comprobaron el manifiesto. `apksigner` verificó el esquema v2. `jarsigner -verify` verificó el AAB. QA comparó el certificado de ambos paquetes y obtuvo la misma huella SHA-256 `f3f56624be477b679946aa2bed8dc86a5eaa1d533642fba169e9d366d42b3b3a`. El modo estricto de `jarsigner` salió con código 4 por la cadena autofirmada y la falta de un sello de tiempo. La verificación criptográfica ordinaria salió con código 0.

| Artefacto | Tamaño | SHA-256 |
| --- | ---: | --- |
| APK universal release | 99.248.711 bytes | `498AEE3EB84744CDE770EBF9673712B930C7EA70936228577827D7F71B5D252E` |
| Android App Bundle release | 66.250.182 bytes | `44ED861A0B7440843611254FF7C50F5149E5750D893175284D813C874608EB7C` |

Se verificó que las copias de entrega tienen las mismas huellas que los archivos de compilación. No se publicaron en Play ni se distribuyeron a dispositivos físicos.

La suite completa tras `946c68c` salió con código 0. Jest aprobó 3.830 pruebas en 320 suites y omitió dos pruebas en una suite. Conservó el aviso de cierre forzado de un worker. SHA-256 `1FEE9E64A19538AB67D97C3B899162416141E7388C3553EE54F57E36DFEF2E95`. `npm run lint` salió con código 1 por los mismos 242 errores existentes y cero advertencias. Su log volvió a coincidir byte por byte con la línea base, SHA-256 `741F0B17A5451798BB8B657156BF7805632B382F95DB9038CC4A802A1F090E5C`. El árbol Flutter de la versión 105 sólo difiere de la regresión Flutter descrita arriba en el código de versión.

El último chequeo SSH devolvió HTTP 200 en `/api/ready` y HTTP 401 en `/api/runtime-profile`. La revisión instalada carece de la ruta pública que espera el APK para verificar el perfil. La captura del candidato muestra «Entorno sin verificar». Para la prueba productiva siguen pendientes `JAVIER.PEDIDO_STATE_EVENTS`, `JAVIER.LIQUIDACION_COMERCIAL` y `JAVIER.DEVOLUCIONES_COMERCIAL`, el journaling tras la migración 051 y las verificaciones de staging y activación. El servidor sigue en TEST con lecturas del ERP. No se insertó ni borró ningún pedido, cobro o liquidación en tablas productivas durante este pase.

El APK entregable se instaló con `adb install -r` en un emulador temporal Android 35 x86_64. `dumpsys package` confirmó versión 105. Se observaron una espera de lanzamiento superior a 15 segundos y avisos de que la interfaz del sistema Android no respondía. El emulador llegó a dibujar el formulario de acceso y se capturó en teléfono de 1080 × 2340 px a 440 dpi. En el mismo emulador se verificó el ajuste de 800 × 1280 px a 160 dpi y escala de texto 2,0. Las capturas `tablet-simulada-acceso-vertical-200-105.png` y `tablet-simulada-acceso-horizontal-200-105.png` muestran ambas orientaciones. El texto de ayuda del campo de usuario se elide en ambas capturas de tablet. Las imágenes permanecen junto a los paquetes de entrega fuera de Git. Esta evidencia cubre la pantalla de acceso en el emulador. La revisión de todas las pestañas autenticadas, el 200 % en el selector de pedido y el rendimiento de campo siguen abiertos.

El recorrido autenticado dentro del APK no llegó al inicio comercial. El intento en modo teléfono volvió al formulario y el intento en modo tablet volvió a mostrar el aviso del sistema Android. La comprobación por API sí completó el acceso y las lecturas con las dos cuentas.
