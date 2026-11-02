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
| STATE + BAG; OFF06 separado | Backend c9a99bd PASS fuente; OFF06 BLOCKED | Auditoría antes/después, timestamp original UTC, estados estrictos, descarte/anulación con motivo, inversos en la bolsa/mes original y registro de impacto cero. Tabla de auditoría existente y journal comprobado; ningún DDL nuevo. Conexiones físicas dedicadas y pruebas contra carreras con entrega/cobro. Lectura/UI se integra después del núcleo transaccional. |
| COLL comercial | config_maker, plan revisado, HOLD | Tres instrumentos independientes de la condición ERP; importe/observaciones/actor/rol estrictos; releer CVC y ambos ledgers bajo bloqueo; read-back y replay semántico; refresco de deuda/histórico/liquidación. Índice único TEST ya comprobado en DB2. No modificar los cuatro métodos de reparto. |
| Lecturas y UX | un escritor tras los contratos anteriores | Cronología, anulación con botones grandes, navegación Bolsa↔pedido, último precio confirmado en nuevo pedido, líneas completas y seis PNG de renderer. La composición de dos paneles y el FAB con inset ya existen; no atribuir una franja negra al shell sin reproducción. |
| PERF / búsqueda local | un escritor, plan de experto disponible | Índice Hive por comercial/cliente con EAN real, normalización y prefetch paginado; favoritos/recientes, resaltado y limpieza inmediata. Conservar virtualización y revalidación de servidor. Medir la CTE filtrada frente a la misma sonda anterior; no asumir mejora ni FPS móvil. |

El orden común de bloqueos es `PEDIDOS_STOCK_RESERVE → PEDIDOS_CAB → entrega/confirmación/evidencia → REPARTIDOR_COBROS → COBROS → BOLSA_COMERCIAL → MOVIMIENTOS_BOLSA → STATE_EVENTS`. Un flujo local entra por CAB antes de ledgers y usa la misma conexión física; un cobro ERP/CVC puede empezar en el ledger de reparto, pero no adquirir CAB después. No se permite una conexión anidada que espere su propio bloqueo ni devolver al pool una conexión con locks explícitos. Los repositorios comparten un adaptador de nivel bajo, sin importar servicios desde repositories.

La decisión financiera acreditada separa propietario documental (`CVC.CODIGOVENDEDOR`) de cobrador (`CODIGO_USUARIO` del JWT) y rol exacto. Si el jefe 80 registra un cobro del vendedor 35, se atribuye una sola vez a la liquidación 35 y se audita al 80. El resumen usa propietario con fallback a actor para filas antiguas y admite sólo la familia de roles comerciales. La selección del jefe debe aplicarse a todas las consultas/guardados; cambiar de vendedor no puede trasladar importes ni revisión de un formulario pendiente al siguiente vendedor. `TIPO_MODO` NORMAL/ESPECIAL carece de una regla ERP acreditada y no se deduce del instrumento.

La revisión de inventario encontró un gap cliente concreto: `invalidateOrderMutationCaches` no elimina `pedidos:products:` y la confirmación no refresca catálogo/stock. El backend sí versiona e invalida sus resultados después de mutar reservas. Se debe invalidar la respuesta volátil del cliente y sustituir stock con el neto del servidor; no restarlo otra vez localmente.

PERF puede introducir `ART_FILTERED` antes de PH manteniendo filtros, ranking y paginación. Los cambios de joins CHAR deben conservar también la semántica de espacios iniciales de `TRIM`; tener el mismo tipo CHAR(10) no prueba por sí solo equivalencia. El catálogo SQL SYSINDEXES no acredita todos los access paths DDS ni el plan elegido por el optimizador. No se recomienda DDL de índices sin esa evidencia.

El backend STATE quedó en `c9a99bd` tras 350/350 pruebas independientes. OFF06 queda BLOCKED por corrupción de metadata tras tres reparaciones; la propuesta excepcional está en `docs/audits/orders-tablet-20261102/off06-repair-proposal.md`. No se aplica sin una instrucción adicional expresa. COLL backend ha recibido WRITEGO separado, con un único escritor y revisión independiente antes de Flutter/DB.
