# Evidencia de pedidos en tablet — run iniciado 02/11/2026

**Checkpoint de implementación en curso. Demo completa: no aprobada.** Este documento distingue las pruebas ejecutadas de los requisitos todavía pendientes. Rama `codex/orders-tablet-demo-20261102`, creada desde `test` en `4a36ddd`. No hubo push, despliegue, reinicio PM2 ni escritura en tablas de producción.

La sesión ha cruzado medianoche: el entorno confirma **03/11/2026 Europe/Madrid**. Las lecturas y ejemplos del 02/11 conservan su fecha histórica. Ningún cobro nuevo puede presentarse como realizado el día 02 ni se retrodata el reloj del servidor para reproducirlo. Las secciones de checkpoint se conservan como historial; la tabla siguiente se actualiza con la última evidencia disponible.

## Estado por unidad

| Unidad | Estado del requisito completo | Evidencia conseguida | Pendiente |
|---|---|---|---|
| Descubrimiento y plan | DONE | `orders-audit.md`, `orders-plan.md`, grafo validado de 12 nodos; nueve especialistas y reducción con citas verificadas del commit base | Las mediciones posteriores se añaden sin sustituir la línea base |
| Confirmación local, reserva y Bolsa | PARTIAL | Confirmación y replay reales; CREATE/rollback/replay/concurrencia real `9008cdf`; estados/anulación auditada `c9a99bd` revisados con 350 pruebas | Ciclo completo de anulación del producto en DB2; sonda operativa BLOCKED tras tres reparaciones; procedencia durable de coste STATE03 BLOCKED; exportación no validada |
| Cola offline y umbral | PARTIAL | FIFO, umbral 2+1, drafts separados, cambio de cuenta y retry durable; timestamp UTC original y metadata separada en `228e0e8`, 18 pruebas independientes de la excepción autorizada | Recorrido de red y reapertura física del dispositivo; el harness Hive no acredita reboot físico |
| Perfil de entorno y aviso Flutter | PARTIAL | QA ENV04 272/272 y AppSec 77/77, exit 0. Verificación DB2 sellada con 21 SELECT y 3/3 cierres. TEST y DEMO 11/11 compatibles | Producción 8/11, exit previsto 1 por tres tablas ausentes. Falta verificar el indicador Flutter en una versión instalada |
| Controles de precio y cantidad | PARTIAL | 25 pruebas: dos modales en 24 combinaciones y selección correcta entre tarifas de igual precio | Pantallas completas, PNG y validación física de safe area, teclado y fluidez |
| Precios especiales y competitivo | PARTIAL | `466b0e6`: precio/coste autoritativos y conflictos tipados; semilla competitiva real idempotente con dos filas y batch de lectura acreditado | Último precio y competitivo en formulario; prioridad PES/promoción superpuesta sin caso ERP acreditado |
| Reservas de 24 h y estados | PARTIAL | TTL desde creación servidor sin renovación al editar; auditoría transaccional y cancelación conservando datos en fuente; tabla real con journal y cinco probes revertidos | Recorrido de cancelación del producto en DB2, recuperación tras caída; instalador reutilizable y sonda runtime BLOCKED |
| Cobros y liquidación comercial | PARTIAL | `7bc6344` y `f4b025a`: arrastre LQD, totales servidor, replay/rol/propietario/mínimo VDDX. La excepción del cliente pasa 77 pruebas focales y 241 de regresión, con revisión de fuente AppSec aprobada | Veto QA final P1 por campos token/estado no autenticados del journal. Excepción agotada y fuente congelada fuera de los commits. Cobros DB2, cierre y documento real pendientes |
| Lectura detallada de pedidos | PARTIAL | Cronología paginada, proyección sanitizada y roles explícitos. Excepción de dos archivos autorizada y aceptada por QA: 150/150 en seis suites, exit 0, incluidos los casos nullable de OpenAPI/AJV6 | Commit de integración con ENV04, validación HTTP y presentación del detalle en Flutter |
| Rendimiento | PARTIAL | Tiempos reales de servicio/DB2 y diagnóstico de bloqueo ODBC | Mejora del catálogo, índice local, render/transiciones/FPS y medición en jefe de ventas con móvil |
| Guion de demo y reset | PARTIAL | `demo-script.md` contiene pasos, guardas y condiciones STOP explícitas | Scripts de semilla/reset del run y ejecución completa |

La reducción posterior del veto de COLL cliente refutó el cambio directo entre cuentas como flujo público: logout desmonta el panel. Confirmó un recorrido real distinto, la renovación normal de token del mismo sujeto. La prueba existente pasa 1/1, pero demuestra que después de `setAuthToken` se genera otra clave de cobro. Un parcial persistido con ACK perdido podría duplicarse al reintentar. Por eso el veto de continuidad idempotente es P1 y sigue BLOCKED, aunque las suites funcionales pasen. La propuesta se prepara con journal cifrado durable e intento estable; no se aplica una cuarta reparación ni se acepta un TTL que borre intentos ambiguos.

## Pruebas globales anteriores a los cambios

La salida completa está en `docs/audits/orders-tablet-20261102/`; los resúmenes versionados se encuentran en `baseline-evidence.json`.

| Comando real | Exit code | Resultado anterior |
|---|---:|---|
| `npm test -- --runInBand`, en backend | 1 | 298 suites PASS, 3 FAIL, 1 omitida; 3443 tests PASS, 3 FAIL, 2 omitidos; 615,452 s |
| `npm run lint`, en backend | 2 | El patrón TS era ignorado por la configuración flat heredada |
| ESLint TS explícito con configuración backend | 1 | 69 archivos, 242 errores, cero warnings |
| Flutter tools snapshot `analyze --no-pub` | 1 | Cero errores, cero warnings, 7570 diagnósticos informativos; 248,7 s |
| Flutter tools snapshot `test --no-pub` | 1 | 1140 PASS, 6 FAIL; 297 s |

El lanzador `flutter.bat` no terminó correctamente en este entorno; se usó el snapshot de las mismas herramientas Flutter con Dart 3.9.2. El nuevo lint ejecuta JS y TS; conserva los 242 errores TS y devuelve exit 1. El PASS del lint JS aislado no se presenta como PASS global.

Dos expectativas backend obsoletas se corrigieron por separado: formato español del correo de factura y export público ya existente de la fachada de pedidos. Ambas suites pasan, 13/13, exit 0, commit `7082547`. Otras tres expectativas/fixtures obsoletos se corrigieron en `f760275`: 47/47 Node y 15/15 Flutter, exit 0; la paginación comprueba SQL y parámetros sin depender de una posición global, y el documento distingue pago total de remanente cobrable. No se modificó comportamiento productivo de reparto para resolverlas.

## Bolsa y reserva: filas reales antes/después

`db2-confirm-evidence.json` conserva las filas, claves y destinos del ensayo. Se clonó una línea del pedido real 106 (importe del documento 193,89 €), con artículo 3519 y precio real 27,54 €, a un fixture identificado del run. No se inventó un cliente ni se usaron céntimos de prueba.

| Momento | Pedido 108 | Reserva | Movimiento | Bolsa 13 |
|---|---|---|---|---|
| Antes | BORRADOR; 28,78 € | Sin fila | Sin fila | Disponible 300; consumido 0 |
| Fallo inyectado tras escribir Bolsa | BORRADOR; 28,78 € | Sin fila | Sin fila | Disponible 300; consumido 0 |
| Confirmación correcta | CONFIRMADO; 28,78 € | Art. 3519, 1 envase / 1 unidad | Un CONSUMO de 1,38; clave `pedido-108-line-124-under-min` | Disponible 298,62; consumido 1,38 |
| Replay | Exactamente igual | Exactamente igual | La misma fila | Exactamente igual |

El rollback y el replay fueron comprobados mediante lecturas desde otra conexión. Después se retiraron exclusivamente el fixture y la bolsa vacía creados para la sonda; la secuencia no se rebobinó. El ensayo ejecutó la fuente local en memoria en el servidor sin desplegarla. No recorrió autenticación, UI, creación normal ni anulación. Hubo un intento previo cuyo rollback liberó importes pero retuvo locks ODBC; se registró el fallo, se limpió de forma acotada y se reparó con conexión dedicada antes de repetir satisfactoriamente.

La reconciliación inicial de nueve bolsas dio diferencia cero en consumido/acumulado, cero huérfanos y cero claves duplicadas. `QSYS2.SYSKEYCST` confirmó las restricciones `UQ_TEST_BOLSA_VND_MES`, `UQ_TEST_MOV_BOLSA_IDEMP` y `PK_TEST_PEDIDO_IDEMPOTENCY`. Esto acredita el estado observado, no una reconciliación posterior de todos los nuevos escenarios.

La sonda posterior `db2-create-integrity.json` ejecutó CREATE del commit `9008cdf` con datos reales del pedido 106/línea 121. Se fijaron en memoria los módulos pedidos/Bolsa/adaptador; otras dependencias procedían de la versión instalada. La purga oportunista se desactivó únicamente en esa copia en memoria para proteger otros borradores TEST. El contrato transaccional probado no se modificó.

| Momento CREATE | Cabecera | Hijos e idempotencia | Secuencia 2026 |
|---|---|---|---:|
| Antes | Ninguna con los dos marcadores aleatorios | Cero filas propias | 34 |
| Fallo después del INSERT real de idempotencia | Ninguna; identidad 109 revertida | Cero líneas, reservas e idempotencia | 34 |
| Reintento válido | ID 110, BORRADOR, número 35; 30,29 € | Una línea 3519 a 27,54; reserva 1/1; una clave ligada a ID 110 | 35 |
| Replay | ID 110 sin cambios | Snapshot idéntico | 35 |
| Dos trabajadores independientes, misma clave nueva | Ambos ID 111, número 36; exactamente un replay | Una nueva línea/reserva/clave; ID enlazado a cabecera | 36 |
| Limpieza acotada | Cero cabeceras propias | Cero hijos y claves propias | 36, sin rebobinar |

Exit 0; rollback, replay, concurrencia, incremento único de secuencia y limpieza PASS. Este ensayo no confirma Bolsa ni anula pedidos; no recorre login, HTTP o UI. La revisión independiente del script bloqueó previamente tres carencias de evidencia/limpieza; se corrigieron y se obtuvo PASS antes de ejecutarlo.

## Rendimiento medido

| Métrica | Antes | Después observado | Método y límite |
|---|---|---|---|
| Catálogo instalado, cinco páginas de 50 con consulta DB observada | 2179,46 / 3297,74 / 1872,33 / 2012,70 / 1979,20 ms; media 2268,29 | Pendiente nueva pareja controlada | Servicio remoto/DB2 sin SHA capturado y cliente no ordenado; no acredita motor frío ni comparación final. PH/LACLAE es candidato inferido, no coste aislado por un plan |
| Catálogo en caché del proceso | 0,03 / 0,01 / 0,01 / 0,01 / 0,01 ms | Sin cambio medido | Sólo retorno de caché del servicio; no equivale a búsqueda visible en 0,01 ms |
| Lectura independiente después de rollback con locks | Tres SQL0913 tras aproximadamente 31,5 s cada uno | 2 / 3 / 2 ms después de rollback y cierre de conexión dedicada | Sonda ODBC real sin DML en la comparación final; no es tiempo de pantalla |
| Confirmación local correcta | Sin referencia equivalente | 278 ms | Fuente nueva ejecutada en memoria con el fixture real; no incluye UI/red |
| Replay de confirmación | Sin referencia equivalente | 12 ms | Mismas filas después de repetir |
| Creación nueva / replay de creación | Sin referencia equivalente | 324 / 113 ms | Sonda CREATE real, sin HTTP/UI; una ejecución, no percentiles |
| Dos trabajadores con la misma clave nueva | Sin referencia equivalente | 6955 ms | Una sola creación persistida; latencia elevada pendiente de atribución, no se considera objetivo cumplido |
| Búsqueda visible, transición, guardado percibido y FPS | No medidos | No medidos | No se dispone de teléfono/tablet/emulador Android conectado |

## Finanzas: hechos acreditados

`db2-finance-carry-expanded.json` contiene 12 filas reales de DSEDAC.LQD del vendedor 35; `finance-carry-evidence.json` calcula determinísticamente los 11 pares consecutivos. En todos, el saldo de la siguiente liquidación coincide con `IMPORTETOTALAINGRESAR - IMPORTEINGRESOENBANCO` de la anterior. La última, número 170 de 02/11/2026, deja 29,15 €: 1314,15 - 1285,00.

Los importes de tarjeta, cheque y postdatado aparecen separados del efectivo ingresable. Ejemplo: LQD 167 muestra efectivo 586,95, saldo 2,37, cheque 826,99 y tarjeta 232,20; total a ingresar 589,32. Los campos gastos, efectivo2 y entregado2 fueron cero en toda la muestra; su semántica con importes no nulos permanece sin acreditar y no se debe inventar una fórmula.

La primera revisión independiente del cambio FIN fue **FAIL**: identificó frescura incorrecta de SAVED, autorización de rol insuficiente, revisión optimista perdida al refrescar y éxito sin relectura persistida. Su ejecución Node dio 40/42 y Flutter 32/32; el resultado previo 42/42 informado por el productor no describe ese árbol. El veto, reproducciones y reparación se conservan en `finance-verification-round1.json`. No se hizo commit de ese cambio de producto antes de repararlo.

La segunda revisión independiente levantó el veto del código FIN: **56/56 Node y 34/34 Flutter, exit 0**, con reproducciones de los cuatro defectos y fechas de calendario válidas. El nuevo token con revisión vigente recalcula; el replay del mismo token devuelve lo persistido; REPARTIDOR queda rechazado; una edición local no adopta una revisión remota al refrescar; una relectura ausente o incoherente provoca rollback. El resultado está en `finance-verification-round2.json`. La aceptación sigue limitada a ese código y esas pruebas; faltan las escrituras DB2 reales y los tres métodos completos.

Dos sondas con la fuente nueva en memoria sí pasaron dentro de su alcance: el resumen real obtuvo 29,15 € en 723 ms y sólo ejecutó SELECT/WITH; el guardado vacío devolvió `LIQUIDACION_NO_COMMERCIAL_COLLECTIONS`, con diez filas antes y después y toda DML bloqueada en la conexión. Estas sondas no cierran los defectos detectados por QA.

TEST_COBROS contiene 16 filas COMERCIAL/CONTADO por 15.154,43 €. Este conteo anterior es una lectura; todavía no prueba tres métodos de cobro ni una liquidación nueva.

La revisión adicional de cobros encontró que `TEST_COBROS` tenía una PK en ID y un índice **no único** en IDEMPOTENCY_TOKEN. Las 16 filas contenían 16 tokens distintos, pero eso no era una garantía para el siguiente cobro. La operación independiente revisada `apply-reviewed-collection-index.ps1` añadió únicamente `JAVIER.UX_TEST_COBROS_TOKEN`, un índice UNIQUE WHERE NOT NULL. `db2-commercial-token-index.json` conserva catálogo, pruebas y hashes reales: token duplicado rechazado con 23000/-803; dos NULL admitidos dentro de transacción; cero filas propias tras cada rollback. Las 16 filas existentes conservaron SHA-256 `c4ab121a9d4034399cc38e6aaf77dadb7d7376bc02ea0ce2b5674050ef635b21` antes y después. Exit 0; ningún cobro quedó registrado por esta comprobación.

IBM i representa este índice nullable único con `IS_UNIQUE=V`; `U` corresponde a unicidad ordinaria. La revisión inicialmente pidió U; se corrigió con la documentación primaria antes de ejecutar el DDL. Véanse [SYSINDEXES de IBM](https://www.ibm.com/docs/en/i/7.4.0?topic=views-sysindexes) y [CREATE INDEX de IBM](https://www.ibm.com/docs/en/i/7.4.0?topic=statements-create-index). La operación está sellada para una sola aplicación y se detiene si ya existe el índice; no se debe repetir.

`db2-commercial-collection-rules.json` acredita además que el instrumento no determina la condición original: FPG TR es transferencia a 60 días con CONTADOSN=N, mientras T0 es transferencia con CONTADOSN=S y cero días. C5 es recibo a 90 días. El candidato CVC del comercial 35, cliente 4300040687, referencia F-0-13427, tiene pendiente real 738,46 €; su elegibilidad frente a cobros de reparto todavía no se ha probado. No se ha usado como cobro registrado ni como escenario completado.

La liquidación TEST conserva diez filas previas sin duplicados de vendedor/fecha ni token. `SYSINDEXES` y `SYSKEYS` acreditan dos índices únicos ya existentes: `UX_TEST_LIQCOM_VENDOR_DAY` sobre CODIGO_VENDEDOR/FECHA y `UX_TEST_LIQCOM_TOKEN` sobre IDEMPOTENCY_TOKEN. `SYSCST` por sí solo sólo mostraba la PK y no bastaba para concluir que faltaban garantías de unicidad. No se ejecutó ningún ALTER redundante.

## Auditoría de estados: esquema real y límite operativo

`db2-state-schema-applied.json` acredita `JAVIER.TEST_PEDIDO_STATE_EVENTS`: 13 columnas, PK, idempotencia única, cuatro CHECK y un índice pedido/fecha. El objeto físico `TEST_00210` está journaled en `JAVIER.QSQJRN`, imágenes `*BOTH`. La creación se hizo en una conexión dedicada con perfil TEST efímero y `CURRENT SCHEMA=JAVIER`; no cambió el proceso instalado. SQL049 conserva SHA-256 `b73a426bea730fab91b033bebaf9a582163d60cefb5b4ebe8ad1809879cec616`.

El instalador `ensure-pedido-state-events-test-ddl.js` queda **BLOCKED tras tres reparaciones**: su preflight consulta columnas inexistentes en SYSKEYS. No se ejecutó su `apply` ni una cuarta reparación. La operación SQL separada y revisada creó los objetos y verificó el catálogo, pero terminó con exit 1 porque esperaba SQLSTATE 23513 y este driver devuelve HY000 con SQLCODE -545. Por tanto ese artefacto operativo queda PARTIAL y no debe repetirse sobre la tabla existente.

La aceptación de datos se ejecutó después como cinco transacciones independientes, sin repetir DDL. `db2-audit-data-verification.json` contiene el resultado real:

| Prueba | Resultado nativo | Filas después de rollback | Estado |
|---|---|---:|---|
| Evento inicial válido | Visible dentro de la transacción: 1 | 0 | PASS |
| Sexto estado no permitido | HY000 / -545 | 0 | PASS |
| Estado inicial inválido | HY000 / -545 | 0 | PASS |
| Anulación sin motivo | HY000 / -545 | 0 | PASS |
| Clave idempotente duplicada | 23000 / -803 | 0 | PASS |

La tabla tenía cero filas antes y después; no hubo DELETE ni rebobinado de identidad, y el pedido real 106 no cambió. Esto prueba el esquema y sus restricciones; el registro de eventos desde el flujo de pedidos sigue pendiente.

## Capturas y dispositivo

No hay PNG de pantalla ni capturas físicas en este checkpoint. Las pruebas de layout de modales no sustituyen una captura del pedido completo, y un renderer de tests tampoco demuestra FPS, teclado o barras del sistema en un dispositivo.

## Bloqueos y siguientes verificaciones

`/api/ready` respondió HTTP 503 por falta de hash PIN de B2 (67 de 68 vendedores activos con hash); DB2 respondió en 2 ms y Redis estaba conectado. Resolver ese bloqueo requiere el procedimiento de autenticación autorizado, sin editar los archivos protegidos ni copiar secretos.

El código está en una rama dedicada. Los cambios previos del usuario en AGENTS.md, artefactos de build borrados y scripts de ventas no forman parte de los commits de este trabajo. La comprobación final deberá conservar `git status`, diff por unidad, suites completas, analyze, lint, loop gate, reconciliación y el resultado de cada paso de demo; hasta entonces no hay aceptación global.


## Checkpoint posterior a c9a99bd

El backend de estados/anulación se ha incorporado en `c9a99bd`: 24 archivos, 2352 inserciones y 338 eliminaciones. La revisión independiente reprodujo 14 suites y 350/350 pruebas con exit 0; `state-backend-verification.json` delimita el alcance. Aún no acredita el flujo real DB2 de CLOB/TIMESTAMP ni el recorrido UI. El instalador DDL bloqueado y el cliente OFF06 no forman parte del commit.

OFF06 queda **BLOCKED**, después del tercer intento: `kind=autoSyncThreshold` puede pasar por la migración de `queuedAt`, aparecer como un pedido fallido y reintentarse. Las 16 pruebas focales pasan pero no cubren esa separación. Se ha preparado una reparación concreta y se ha solicitado una sola excepción al límite; no se aplica mientras no exista respuesta expresa. Los demás contratos siguen avanzando.

La ampliación independiente de lint cubrió 25 JS: actual 0 errores/165 avisos, frente a 0/170 en 0e135d1, sin huellas nuevas. Frente a 4a36ddd siguen apareciendo dos avisos `require-await` de callbacks ya introducidos en commits anteriores de esta rama; el objetivo global de cero nuevos avisos aún no está cerrado. El gate portable devuelve WARN porque no descubre los lanzadores Windows de Flutter/npm; las pruebas focales reales tienen su evidencia separada.

PRICE quedó en `466b0e6`: referencia/coste autoritativos, precio competitivo informativo y fallo tipado cuando falta referencia. El productor pasó 141 Node; la comprobación independiente pasó 148 Node y 43 Flutter, con scopes distintos documentados en `price-source-verification.json`. No se equiparan ambas listas de suites.

La semilla competitiva revisada se ejecutó con la fuente fija `0e135d1`: tabla vacía antes, dos filas reales después, IDs 2 y 3, cliente 4300032160/artículos 3519 y 3075. Precios 27,54 y 49,572; márgenes 24,69 % y 24,71 %, procedentes del pedido confirmado 106. Replay y dos trabajadores conservaron IDs/valores; sólo cambió UPDATED_AT. `db2-competitive-seed.json` conserva las filas y restricciones. La sonda requiere tabla inicialmente vacía y no debe repetirse ahora.

La lectura competitiva real encontró esos dos artículos mediante una consulta batch; cliente ajeno y artículo ausente devolvieron ausencia explícita, sin precio ficticio cero. `db2-competitive-read-path.json` acredita el helper/DB, no la pantalla completa ni el último precio del formulario nuevo, cuyo cableado sigue pendiente.

### Salud y hallazgo de seguridad preexistente

`db2-b2-eligibility.json` acredita sin devolver credenciales que B2 pertenece tanto a la población de readiness como a los usuarios elegibles de login, tiene VDD y no tiene hash. No procede excluirlo ni relajar el health check. El CLI heredado de backfill no se ha ejecutado ni se recomienda: su dry-run puede hacer DDL antes de comprobar el modo y sus errores pueden imprimir información nativa. La intervención de autenticación requiere un procedimiento específico revisado y autorización manual; no es una escritura TEST de este mandato.

La revisión encontró datos de PIN en un archivo versionado preexistente: `docs/archive/audits/db2-discovery/agent1-dsedac-mapping.json`. No se ha abierto para copiar valores, no se incluyen en esta evidencia y no se ha realizado rotación ni reescritura de historia. El incidente se comunicó al propietario. La ausencia de patrones del scanner sobre archivos cambiados no acredita que el histórico completo esté libre de secretos.


## Integración posterior: offline, cobros y fallo de la sonda

`228e0e8` conserva el timestamp original UTC y separa metadata de pedidos. La excepción autorizada pasó 18/18 pruebas independientes; tres fakes de API se alinearon con el parámetro opcional y sus 45 pruebas pasaron. El reinicio físico de un dispositivo sigue sin medir; se reinicializó el servicio sobre Hive en el harness host.

`562eb49` corrige el resolver central de las doce familias TEST, incluidas las tres tablas de control de entrega. AppSec reprodujo 36/36 pruebas con exit 0; la prueba contradictoria con APP_ENV mixto y permisos DSEDAC sigue devolviendo TEST. La modificación no despliega el servidor ni acredita DML por sí sola.

`f4b025a` contiene el backend comercial de cobros: 19 archivos, +1706/-727. Su tercera revisión independiente pasó 254/254, con replay exacto, ambos ledgers, propietario/cobrador separados, mínimo VDDX del propietario y condición ERP leída mediante la identidad completa. El caso real F-0-13427 acredita C5 junto con CC en ocho líneas; no se deduce el tipo por instrumento ni por FPG. TIPO_MODO queda NULL porque no hay fuente acreditada. La lectura completa está resumida en `db2-commercial-sale-type.json`; no se registró ningún cobro con esa sonda.

La revisión de lint encontró primero 27 avisos nuevos que el productor había clasificado mal. Se corrigieron manualmente sin cambiar reglas ni suprimir diagnósticos. La comprobación independiente final sobre 19 archivos dio 137 avisos históricos/0 errores y cero huellas nuevas frente a 228e0e8 y 4a36ddd. El lint global y el lint backend son comandos distintos; el exit 0 global con miles de avisos no reemplaza los 242 errores TS heredados del backend.

### Incidente de validación y recuperación del pedido 112

La única ejecución de la sonda de ciclo creó el pedido TEST 112, línea 128 y reserva 84, con artículo 3519, cantidades 1/1 y total 30,29 €. Se registró correctamente el evento inicial ID 9 con CLOB y timestamp UTC original. La sonda falló al serializar el ID BIGINT nativo de DB2 y no pudo emitir su evidencia completa; su compensación mediante el servicio rechazó los destinos de control no aislados que motivaron el posterior ajuste ENV. No hubo confirmación ni movimiento de bolsa. `db2-lifecycle-state-failure.json` conserva el fallo: no se presenta como un ciclo aprobado.

Una operación de mantenimiento independiente, revisada por QA y AppSec, dejó 112 CANCELADO y liberó exclusivamente la reserva 84. Conservó cabecera, línea, idempotencia, secuencia, bolsa y evento original; añadió dos eventos SYSTEM_TEST (IDs 10 y 11). Los hashes de ocho conjuntos de filas ajenas se verificaron antes del commit. El script terminó exit 1 porque intentó postcheck desde otro observador antes de cerrar la conexión con locks explícitos. La lectura separada después del cierre terminó exit 0 y confirmó CANCELADO, cero reservas/movimientos y tres hashes de CLOB válidos. Ambos resultados se conservan separados en `db2-owned112-compensation.json` y `db2-owned112-readonly-postcheck.json`.

La bolsa mensual canónica creada por el servicio para vendedor 35/noviembre, ID 14, permanece con disponible 300, consumido 0 y acumulado 0. Es una fixture declarada, sin movimientos inventados. No se rebobinaron identidades ni secuencias.

La última reparación de la sonda operativa queda **BLOCKED tras tres intentos**: sus cierres de observer/pool no cubren todos los errores de apertura/cierre. No se ha ejecutado esa última versión y no se permite repair 4 automático. `runtime-probe-blocker.json` identifica SHA y veto. No ejecutar estos scripts con -Run. La procedencia durable del coste en auditoría STATE03 también sigue BLOCKED; conservar el número del coste no equivale a conservar su fuente.

El control `node scripts/team/sync-harness.cjs --check` terminó exit 1: faltan cuatro espejos .opencode de skills; no se modificó configuración del equipo para ocultar el drift. La suite backend completa del checkpoint terminó exit 1: 305 suites aprobadas, 8 fallidas, 1 omitida; 3636 tests aprobados, 13 fallidos, 2 omitidos, 545,581 s. La revisión independiente atribuye un contrato OpenAPI omitido (/runtime-profile) y siete grupos de fixtures obsoletos; la reparación aún no se ha ejecutado. El siguiente pase completo debe validar el árbol final.

## Conciliación real y preflight financiero del 03/11

`read-commercial-integrity.ps1` ejecutó ocho SELECT con metadatos previos y cero DML; la conexión física se cerró antes de emitir el resultado. La segunda lectura conservada en `db2-commercial-reconciliation-current.json` terminó exit 0, con 59,657 ms de consultas: diez bolsas, 27 movimientos, 39 pedidos y 32 reservas. No hay claves duplicadas, huérfanos, tipos desconocidos ni diferencias de consumo/acumulación. Las cinco cadenas con movimientos terminan en el saldo almacenado; las cinco bolsas sin movimientos no tienen snapshot de apertura y su saldo absoluto no se reconstruye por suposición. No había reversos en esta muestra: la ausencia de errores no prueba el nuevo recorrido de anulación con movimientos. El pedido 112 sigue CANCELADO, sin reserva ni movimiento. El especialista Bolsa revisó independientemente las fórmulas y limitaciones: PASS_OBSERVED_AGGREGATE, no PASS del ciclo completo.

El primer canal de lectura del especialista falló por selección de SSH/restricciones locales. Git SSH con acceso autorizado al archivo known_hosts permitió al coordinador ejecutar la lectura; no se trató de una reparación ni escritura DB2. Los hashes del JSON cubren sólo las columnas económicas/referenciales declaradas, y las ocho lecturas no constituyen un snapshot transaccional.

La unidad financiera es independiente de la sonda STATE bloqueada. `probe-finance-closed-code.ps1` fija quince fuentes de negocio de `f4b025a`; reemplaza únicamente transporte y dependencias no utilizadas, impide cargar el backend instalado diferente, y separa DryRun, ReadOnly y Run. No se ha ejecutado Run. El primer ReadOnly se detuvo en SETUP, con cero consultas/conexiones/mutaciones, por resolver incorrectamente módulos *.service/*.repository; una reparación de resolución a *.js precedió al segundo ReadOnly.

`finance-readonly-preflight.jsonl` conserva los checkpoints BEFORE_MUTATION y FINAL del preflight nativo posterior: exit 0, 32 SELECT, cero DML y todas las conexiones cerradas. La fecha real es 03/11/2026, no se retrodata el mandato del día 02.

| Documento CVC exacto | Cliente / propietario | Pendiente real | Importe documental | Condición / instrumento previsto |
|---|---|---:|---:|---|
| CVC:COB:F:GMP:2026:F:0:13427:1:1 | 4300040687 / 35 | 738,46 | 738,47 | C5 / efectivo CONTADO |
| CVC:COB:F:GMP:2026:F:0:13423:1:1 | 4300032575 / 35 | 139,02 | 426,34 | 02 / tarjeta TJ |
| CVC:COB:F:GMP:2026:F:0:13422:1:1 | 4300032572 / 35 | 1.031,53 | 1.031,53 | 02 / transferencia TR |

Los tres tipos de venta se resolvieron mediante el código fijado a CC, sin deducirlos de la forma de pago. Los tres clientes carecen de cobro riguroso activo; el mínimo del vendedor leído es 25 %. El resumen del día 03 no contiene cobros ni borrador guardado, y deriva 29,15 € de la última LQD viva número 170 del día 02. Ese preflight no registra un pago ni genera una liquidación; Run requiere revisión funcional y de seguridad independiente del artefacto exacto.

## Veto de READ_MODEL, iteración 1

El nuevo GET de detalle/catálogo pasó 155 pruebas distintas de once suites en QA independiente, pero recibió veto: perfiles contradictorios podían consultar auditoría TEST; el snapshot exponía precioMinimo a COMERCIAL; se cargaban CLOB de todos los eventos sin límite, y la propiedad pública idempotencyKey no coincidía con OpenAPI. AppSec reprodujo 100 pruebas de cuatro suites y los hallazgos de exposición/límite/contrato. Las pruebas verdes no levantan ese veto.

La reparación 2 está planificada sin escribir mientras el escritor único completa COLL cliente: conjunción estricta del perfil, timeline paginado sin CLOB por defecto, snapshot individual bajo demanda, eliminación de suelo/clave del DTO público y esquema allowlist cerrado. No reabre STATE03 ni la sonda operativa bloqueada.

El loop gate detectó además un ejemplo ficticio preexistente en OpenAPI al escanear el archivo completo. AppSec comprobó que la línea coincide exactamente con HEAD mediante SHA-256 sin copiar su valor. Se ha autorizado cambiar únicamente ese scalar de ejemplo a `<provided-at-runtime>`, manteniendo contrato, autenticación y detector. El gate continúa BLOCKED hasta ejecutar la reparación y repetirlo; la clasificación manual no equivale a aprobarlo mecánicamente.

### Límite posterior de la instrumentación financiera

El ReadOnly de 32 consultas corresponde a la primera versión del harness, con quince fuentes selladas y cargador instalado. La revisión independiente no autorizó Run: exigió sellar el wrapper/bootstrap/manifiesto, conservar inventario propio ante commit parcial, limitar operaciones nativas y comprobar todos los importes de liquidación.

La revisión 2 fijó diecisiete fuentes y commit completo, ambos SHA de scripts, manifiesto `6133d1e64128f173230fa100526218e5773d60a2daa3097793131a576e178ea2`, límites de consulta/conexión/transacción/cierre y watchdog, huella monetaria y postflight de fallo. ReadOnly 2 se detuvo en SETUP con VERIFIED_ISOLATED_RUNTIME_REQUIRED, cero consultas y mutaciones. La reparación 3 seleccionó TEST en ese proceso y aplicó el nuevo arranque; ReadOnly 3 se detuvo en SETUP con INVALID_APP_ENV_PROFILE, también antes de DB2. No hubo Run ni cobro nuevo en ningún intento. La unidad queda BLOCKED tras tres reparaciones, sin una cuarta automática.

El diagnóstico separado de perfiles aclaró la causa sin tocar el servidor: **DEMO es compatible con la configuración actual, con cero errores; TEST contradice NODE_ENV y REPARTO_ENVIRONMENT heredados**. La sonda fijó el selector TEST incorrecto para esa compatibilidad; no se acusa a DEMO de estar mal ni se modifica el servidor para hacer pasar un ensayo. El operador puede preparar APP_ENV=demo y verificarlo con el procedimiento documentado. Este hecho no levanta el límite ni autoriza volver a ejecutar el harness financiero.

El diagnóstico de perfiles tuvo un primer fallo de compilación por filename de módulo sin inicializar (exit 255, antes del cargador/DB); una reparación acotada añadió los dos filename y terminó exit 0, cero conexiones DB y cero mutaciones. Su JSON y script se conservan separados de la sonda financiera. La documentación de límites nativos se contrastó con [node-odbc de IBM](https://github.com/IBM/node-odbc) y [el comportamiento de timeout de IBM i](https://www.ibm.com/docs/en/i/7.5.0?topic=details-handle-long-running-queries); configurar timeout no se presenta como prueba de cancelación efectiva de un proceso colgado.
