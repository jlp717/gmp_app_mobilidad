# Evidencia de pedidos en tablet — 02/11/2026

**Checkpoint de implementación en curso. Demo completa: no aprobada.** Este documento distingue las pruebas ejecutadas de los requisitos todavía pendientes. Rama `codex/orders-tablet-demo-20261102`, creada desde `test` en `4a36ddd`. No hubo push, despliegue, reinicio PM2 ni escritura en tablas de producción.

## Estado por unidad

| Unidad | Estado del requisito completo | Evidencia conseguida | Pendiente |
|---|---|---|---|
| Descubrimiento y plan | DONE | `orders-audit.md`, `orders-plan.md`, grafo validado de 12 nodos; nueve especialistas y reducción con citas verificadas del commit base | Las mediciones posteriores se añaden sin sustituir la línea base |
| Confirmación local, reserva y Bolsa | PARTIAL | Una conexión dedicada y una transacción; fallo después del movimiento real revierte las cuatro tablas; confirmación y replay reales correctos. Fuente `9008cdf`: revisión independiente 157/157, creación/edición serializadas con confirmación y relectura autoritativa bajo lock | Sonda real de la nueva creación/concurrencia, anulación y ramas de exportación |
| Cola offline y umbral | PARTIAL | Verificador independiente: 14/14; regresión del maker: 90/90; backend: 23/23. FIFO, umbral 2+1, drafts separados, cambio de cuenta y retry durable | Fecha original en servidor y recorrido con red/dispositivo reales |
| Perfil de entorno y aviso Flutter | PARTIAL | 80/80 Node, 4/4 Flutter, AppSec independiente; tres perfiles con ocho objetos DB2 correctos mediante SELECT | Instalar la versión, limpiar contradicciones heredadas y comprobar el entorno instalado; gates de producción sin activar |
| Controles de precio y cantidad | PARTIAL | 25 pruebas: dos modales en 24 combinaciones y selección correcta entre tarifas de igual precio | Pantallas completas, PNG y validación física de safe area, teclado y fluidez |
| Precios especiales y competitivo | PARTIAL | PES/CLP real vigente identificado; tabla competitiva TEST existe y estaba vacía | Precio autoritativo en creación, semilla real idempotente, lectura informativa en UI y pruebas completas |
| Reservas de 24 h y estados | PARTIAL | Disponibilidad y TTL derivan de la creación de cabecera, sin renovar al editar; fuente revisada. Tabla de auditoría real creada, journal activo y cinco probes revertidos correctos | Cableado de auditoría, recuperación tras caída y cancelación local conservando historia; instalador reutilizable BLOCKED |
| Cobros y liquidación comercial | PARTIAL | Commit `7bc6344`, 56/56 Node y 34/34 Flutter independientes. Último LQD/arrastre del servidor, replay y revisión optimista, roles y guardado vacío comprobados | UI/API de tres métodos, cierre con cobros reales y documento/cabecera de liquidación |
| Rendimiento | PARTIAL | Tiempos reales de servicio/DB2 y diagnóstico de bloqueo ODBC | Mejora del catálogo, índice local, render/transiciones/FPS y medición en jefe de ventas con móvil |
| Guion de demo y reset | PARTIAL | `demo-script.md` contiene pasos, guardas y condiciones STOP explícitas | Scripts de semilla/reset del run y ejecución completa |

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
| Catálogo, cinco páginas frías de 50 artículos | 2179,46 / 3297,74 / 1872,33 / 2012,70 / 1979,20 ms; media 2268,29 | Pendiente | Servicio remoto y DB2; excluye HTTP y render. PH/LACLAE es candidato inferido, no coste aislado por un plan |
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
