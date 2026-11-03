# Plan de ejecución de pedidos — 02/11/2026

Fuente: `docs/orders-audit.md`. Run `orders-tablet-20261102`; grafo validado en `docs/audits/orders-tablet-20261102/graph.json`. Nueve especialistas; máximo ocho agentes activos incluido coordinador. Descubrimiento paralelo en dos tandas, reducción determinista, un escritor de código secuencial, QA independiente. Máximo tres reparaciones y parada tras dos rondas sin progreso.

| Orden | Unidad / responsable experto | Dependencias | Aceptación mínima |
|---|---|---|---|
| 1 | Bolsa + Inventario: integridad de confirmación local | BAG-01, INV-01; esquema existente, pool real | Misma conexión para confirmación/reserva/movimientos, rollback en cualquier fallo, reintento sin duplicar, transacción no disponible → error explícito. Pruebas de fallos y concurrencia. |
| 2 | Offline / sistemas distribuidos | Cola actual; no depende del DDL | FIFO por vendedor, un drenaje activo, backoff durable, reintento manual limpio, fallos parciales; pruebas de reloj/cola tras reapertura. Mantener borradores editables separados. |
| 3 | DevOps / configuración | Rutas de tablas auditadas | APP_ENV determinista, contradicciones fallan antes de tareas, env:verify sólo SELECT, plantillas sin secretos, indicador de entorno. Production no habilita escrituras ERP por sí solo. |
| 4 | UX / diseñador sénior | Modelos actuales; widgets reales | Controles pedidos ≥56 dp, etiquetas/selección explícitas, texto escalable; pruebas en cuatro tamaños × dos orientaciones × tres escalas para los widgets modificados. Capturas reales si hay renderer disponible. |
| 5 | Finanzas comercial | Resumen servidor actual | Guardado rechaza periodo sin cobros y no acepta totales manipulados; tests de efectivo/tarjeta/transferencia y replay. No modificar reparto. |
| 6 | Precios / reglas | QSYS2 y fuente ERP acreditada | Conectar competitivo con ausencia explícita, preservar prioridad acreditada; no resolver contradicción de reglas mediante una suposición. |
| 7 | Estados/cancelación y reconciliación | Integridad bolsa/stock, catálogo QSYS2, auditoría durable | Cancelación conserva pedido y movimientos inversos sólo para pedido local no exportado. Si no hay esquema comprobable, dejar migración/procedimiento revisable y marcar bloqueo, sin SQL inventado ejecutado. |
| 8 | Performance | Servidor/dispositivo y datos reales accesibles | Antes/después por la misma sonda, API/ODBC/frames separados, sin atribuir medición de mocks al servidor. |
| 9 | QA independiente / cierre | Diffs completos y resultados ejecutados | Suites completas antes/después, analyze, lint, loop_gate, demo y evidencia DB real cuando accesible; veto ante fallos críticos. |

## Gates y límites

La autorización de implementación proviene del mandato explícito de Javier; la especificación EARS reproduce sus requisitos y limita cada slice a comportamiento comprobable. El gate spec_approved no sustituye validación DB2 ni autoriza producción. Un test de unidad con mocks prueba el contrato de código, no el DDL desplegado ni la ausencia de sobreventa en DB2 real.

Los fallos previos se conservan visibles. No se corrigen reglas de autenticación, secretos, infraestructura o reparto ajenos al alcance para maquillar el resultado. El informe final debe marcar cada gap DONE/PARTIAL/BLOCKED y no declarar la demo aprobada mientras fallen sus condiciones.

## Secuencia de integración tras PRICE

PRICE quedó en `466b0e6` con revisión independiente acotada; el CLI de semilla quedó en `0e135d1`. La siguiente implementación mantiene un solo escritor de producto. El coordinador conserva scripts y evidencia en `docs/`.

| Slice | Responsable / estado | Contrato y verificación |
|---|---|---|
| STATE + BAG; OFF06 separado | Backend c9a99bd PASS fuente; STATE03 y sonda runtime BLOCKED; OFF06 PASS fuente 228e0e8 | Auditoría antes/después, timestamp original UTC, estados estrictos, descarte/anulación con motivo, inversos en la bolsa/mes original y registro de impacto cero. Tabla de auditoría existente y journal comprobado; ningún DDL nuevo. Conexiones físicas dedicadas y pruebas contra carreras con entrega/cobro. La excepción OFF06 fue autorizada expresamente por Javier y sus 18 pruebas independientes pasan. Falta procedencia del coste en auditoría STATE03; no se reabre su cuarta reparación. |
| COLL comercial backend | f4b025a, PASS revisión de fuente; DB/UI pendientes | Tres instrumentos independientes de la condición ERP; importe/observaciones/actor/rol estrictos; releer CVC y ambos ledgers bajo bloqueo; read-back y replay semántico. 254 pruebas independientes y cero errores/nuevos avisos de lint en 19 archivos. Índice único TEST ya comprobado en DB2. No modificar los cuatro métodos de reparto. |
| COLL comercial cliente | config_maker HOLD hasta entrega READ_MODEL del maker | Instrumentos propios del comercial, ausencia de tipo/modo inventados, intento estable y ligado a sesión, respuesta autoritativa por propietario, refresco de deuda/histórico/liquidación. Jefe 80 con selección 35 consulta y guarda 35; ALL es lectura agregada y bloquea guardado. Cambio de vendedor con datos pendientes exige confirmar antes de cambiar el provider y borra importes/revisión del anterior. Pruebas cliente, widget, sesión y regresión de reparto. |
| Lecturas y UX | un escritor tras los contratos anteriores | Cronología, anulación con botones grandes, navegación Bolsa↔pedido, último precio confirmado en nuevo pedido, líneas completas y seis PNG de renderer. La composición de dos paneles y el FAB con inset ya existen; no atribuir una franja negra al shell sin reproducción. |
| PERF / búsqueda local | un escritor, plan de experto disponible | Índice Hive por comercial/cliente con EAN real, normalización y prefetch paginado; favoritos/recientes, resaltado y limpieza inmediata. Conservar virtualización y revalidación de servidor. Medir la CTE filtrada frente a la misma sonda anterior; no asumir mejora ni FPS móvil. |

El orden común de bloqueos es `PEDIDOS_STOCK_RESERVE → PEDIDOS_CAB → entrega/confirmación/evidencia → REPARTIDOR_COBROS → COBROS → BOLSA_COMERCIAL → MOVIMIENTOS_BOLSA → STATE_EVENTS`. Un flujo local entra por CAB antes de ledgers y usa la misma conexión física; un cobro ERP/CVC puede empezar en el ledger de reparto, pero no adquirir CAB después. No se permite una conexión anidada que espere su propio bloqueo ni devolver al pool una conexión con locks explícitos. Los repositorios comparten un adaptador de nivel bajo, sin importar servicios desde repositories.

La decisión financiera acreditada separa propietario documental (`CVC.CODIGOVENDEDOR`) de cobrador (`CODIGO_USUARIO` del JWT) y rol exacto. Si el jefe 80 registra un cobro del vendedor 35, se atribuye una sola vez a la liquidación 35 y se audita al 80. El resumen usa propietario con fallback a actor para filas antiguas y admite sólo la familia de roles comerciales. La selección del jefe debe aplicarse a todas las consultas/guardados; cambiar de vendedor no puede trasladar importes ni revisión de un formulario pendiente al siguiente vendedor. `TIPO_MODO` NORMAL/ESPECIAL carece de una regla ERP acreditada y no se deduce del instrumento.

La revisión de inventario encontró un gap cliente concreto: `invalidateOrderMutationCaches` no elimina `pedidos:products:` y la confirmación no refresca catálogo/stock. El backend sí versiona e invalida sus resultados después de mutar reservas. Se debe invalidar la respuesta volátil del cliente y sustituir stock con el neto del servidor; no restarlo otra vez localmente.

PERF puede introducir `ART_FILTERED` antes de PH manteniendo filtros, ranking y paginación. Los cambios de joins CHAR deben conservar también la semántica de espacios iniciales de `TRIM`; tener el mismo tipo CHAR(10) no prueba por sí solo equivalencia. El catálogo SQL SYSINDEXES no acredita todos los access paths DDS ni el plan elegido por el optimizador. No se recomienda DDL de índices sin esa evidencia.

El backend STATE quedó en `c9a99bd` tras 350/350 pruebas independientes. La reparación excepcional OFF06 fue autorizada por Javier, aplicada en `228e0e8` y revisada con 18/18 pruebas; la propuesta y la autorización se conservan en evidencia. COLL backend quedó en `f4b025a`. La siguiente secuencia mantiene un único escritor: READ_MODEL backend → COLL cliente → UX pedidos/Bolsa → PERF → integración y verificación final. Revisores independientes pueden trabajar en paralelo con el siguiente slice sin editar fuentes.

La sonda runtime STATE alcanzó tres reparaciones y recibió veto independiente por cierre no exhaustivo de conexiones. No se vuelve a ejecutar ni se sustituye por una sonda equivalente. Su pedido TEST 112 quedó CANCELADO mediante compensación revisada, sin reserva ni movimiento de bolsa; el postcheck de lectura separado verificó sus tres eventos. La compensación no acredita el recorrido de cancelación del producto. Las lecturas reales financieras son una unidad independiente y no autorizan por sí mismas nuevos cobros.

## Integración posterior al primer READ_MODEL

READ_MODEL recibió veto independiente antes del commit: perfil contradictorio, exposición de suelo comercial, carga ilimitada de snapshots y contrato DTO/OpenAPI. Las reparaciones 2 y 3 corrigieron esos puntos y los roles; la revisión de seguridad final pasa 128 pruebas. QA ejecutó 143 pruebas, pero conserva un veto de contrato nullable tras el tercer intento. La propuesta excepcional de dos archivos está en `read-model-null-contract-proposal.md`; no se aplica sin nueva autorización expresa y el PASS de seguridad no elimina ese veto.

El contraste offline integrador refutó que sólo se cree BORRADOR: el drain ya hace CREATE, persiste serverOrderId y después CONFIRM antes de retirar Hive. Encontró tres gaps distintos de OFF06: acepta ACK por ausencia de error sin exigir confirmación positiva, el autosync no refresca explícitamente Bolsa/stock, y llama borrador a un pedido finalizado. La unidad separada OFF-BAG-INTEGRATION-01 implementará ACK estricto, replays perdidos, refresco y textos; no toca de nuevo la migración de metadata autorizada excepcionalmente.

UX dispone de las seis caras Inter oficiales verificadas, aún en carpeta temporal: `inter-font-provenance.json`. El escritor integrará assets, licencia, declaración Flutter y dos sustituciones de familia del tema; el renderer cargará las mismas caras para sus 72 casos/seis PNG. Esto corrige dependencia de una caché externa de tipografía sin rehacer el tema global.

El baseline de catálogo de la versión instalada carece de SHA y escogió un cliente sin ORDER BY. Sus cinco muestras siguen siendo observaciones reales de servicio/DB, pero **no son una comparación controlada** frente a una CTE nueva. PERF debe capturar una nueva pareja before/after con fuente sellada, cliente/offsets idénticos, capa de caché explícita y hashes de equivalencia. No declarar mejoras a partir de muestras de versiones distintas.

## Handoff actual, 03/11/2026

COLL cliente entregó su reparación 3 con HOLD explícito: 73 pruebas focales y 234 de reparto/sesión/auth, exit 0; analyze focal devuelve cero errores y warnings, 391 infos. Son resultados del productor hasta que QA y seguridad independientes concluyan. Los 18 hashes reales se conservan en `coll-client-repair3-frozen-sha.json`; no sumar los conteos históricos de suites distintas.

El escritor único continúa con ENV04: un único registro de 15 familias, perfil estricto antes de conectar, capability de catálogo inyectada y tres destinos comerciales sin fallback TEST en producción. Las tres tablas base faltan; sus tres equivalentes TEST y columnas se acreditaron con 12 SELECT, más una consulta de índices. `UPDATED_AT` sí existe en las 17 columnas de liquidación TEST. No se crea DDL ni se habilita DML de producción. Después se abordarán GIFT01–04, OFF-BAG01–04, UI/fuentes locales, búsqueda offline y documento financiero, siempre con handoff y revisión independiente.

El handoff UX es un plan, no una implementación. Las seis caras Inter aún están fuera del árbol de la app. Los goldens deberán cargar esas caras reales en el renderer; si se usa FontLoader, su fuente serán los mismos assets empaquetados. La matriz mínima son 72 casos para tres superficies y seis PNG, sin atribuirlas a dispositivos físicos. La persistencia del índice de catálogo es obligatoria para la reapertura offline; no queda como elección opcional.
