# Evidencia de pedidos en tablet — 02/11/2026

**Checkpoint de implementación en curso. Demo completa: no aprobada.** Este documento distingue las pruebas ejecutadas de los requisitos todavía pendientes. Rama `codex/orders-tablet-demo-20261102`, creada desde `test` en `4a36ddd`. No hubo push, despliegue, reinicio PM2 ni escritura en tablas de producción.

## Estado por unidad

| Unidad | Estado del requisito completo | Evidencia conseguida | Pendiente |
|---|---|---|---|
| Descubrimiento y plan | DONE | `orders-audit.md`, `orders-plan.md`, grafo validado de 12 nodos; nueve especialistas y reducción con citas verificadas del commit base | Las mediciones posteriores se añaden sin sustituir la línea base |
| Confirmación local, reserva y Bolsa | PARTIAL | Una conexión dedicada y una transacción; fallo después del movimiento real revierte las cuatro tablas; confirmación y replay reales correctos | Creación/edición/anulación, concurrencia completa entre confirmaciones y ramas de exportación |
| Cola offline y umbral | PARTIAL | Verificador independiente: 14/14; regresión del maker: 90/90; backend: 23/23. FIFO, umbral 2+1, drafts separados, cambio de cuenta y retry durable | Fecha original en servidor y recorrido con red/dispositivo reales |
| Perfil de entorno y aviso Flutter | PARTIAL | 80/80 Node, 4/4 Flutter, AppSec independiente; tres perfiles con ocho objetos DB2 correctos mediante SELECT | Instalar la versión, limpiar contradicciones heredadas y comprobar el entorno instalado; gates de producción sin activar |
| Controles de precio y cantidad | PARTIAL | 25 pruebas: dos modales en 24 combinaciones y selección correcta entre tarifas de igual precio | Pantallas completas, PNG y validación física de safe area, teclado y fluidez |
| Precios especiales y competitivo | PARTIAL | PES/CLP real vigente identificado; tabla competitiva TEST existe y estaba vacía | Precio autoritativo en creación, semilla real idempotente, lectura informativa en UI y pruebas completas |
| Reservas de 24 h y estados | PARTIAL | Bloqueo de disponibilidad durante confirmación local y rollback real | Reloj único de expiración, recuperación tras caída, auditoría durable y cancelación local conservando historia |
| Cobros y liquidación comercial | PARTIAL | Catálogo y 12 LQD reales; 11 pares de arrastre corroborados; errores de fórmula y confianza en totales del cliente identificados | Correcciones de servidor/UI, tres métodos, cierre y pruebas DB reales |
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

Dos expectativas backend obsoletas se corrigieron por separado: formato español del correo de factura y export público ya existente de la fachada de pedidos. Ambas suites pasan, 13/13, exit 0, commit `7082547`. QA identificó otras tres expectativas/fixtures obsoletos; sus correcciones y ejecución siguen pendientes en este checkpoint. No se ha modificado comportamiento productivo de reparto para resolverlas.

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

## Rendimiento medido

| Métrica | Antes | Después observado | Método y límite |
|---|---|---|---|
| Catálogo, cinco páginas frías de 50 artículos | 2179,46 / 3297,74 / 1872,33 / 2012,70 / 1979,20 ms; media 2268,29 | Pendiente | Servicio remoto y DB2; excluye HTTP y render. PH/LACLAE es candidato inferido, no coste aislado por un plan |
| Catálogo en caché del proceso | 0,03 / 0,01 / 0,01 / 0,01 / 0,01 ms | Sin cambio medido | Sólo retorno de caché del servicio; no equivale a búsqueda visible en 0,01 ms |
| Lectura independiente después de rollback con locks | Tres SQL0913 tras aproximadamente 31,5 s cada uno | 2 / 3 / 2 ms después de rollback y cierre de conexión dedicada | Sonda ODBC real sin DML en la comparación final; no es tiempo de pantalla |
| Confirmación local correcta | Sin referencia equivalente | 278 ms | Fuente nueva ejecutada en memoria con el fixture real; no incluye UI/red |
| Replay de confirmación | Sin referencia equivalente | 12 ms | Mismas filas después de repetir |
| Búsqueda visible, transición, guardado percibido y FPS | No medidos | No medidos | No se dispone de teléfono/tablet/emulador Android conectado |

## Finanzas: hechos acreditados

`db2-finance-carry-expanded.json` contiene 12 filas reales de DSEDAC.LQD del vendedor 35; `finance-carry-evidence.json` calcula determinísticamente los 11 pares consecutivos. En todos, el saldo de la siguiente liquidación coincide con `IMPORTETOTALAINGRESAR - IMPORTEINGRESOENBANCO` de la anterior. La última, número 170 de 02/11/2026, deja 29,15 €: 1314,15 - 1285,00.

Los importes de tarjeta, cheque y postdatado aparecen separados del efectivo ingresable. Ejemplo: LQD 167 muestra efectivo 586,95, saldo 2,37, cheque 826,99 y tarjeta 232,20; total a ingresar 589,32. Los campos gastos, efectivo2 y entregado2 fueron cero en toda la muestra; su semántica con importes no nulos permanece sin acreditar y no se debe inventar una fórmula.

La primera revisión independiente del cambio FIN fue **FAIL**: identificó frescura incorrecta de SAVED, autorización de rol insuficiente, revisión optimista perdida al refrescar y éxito sin relectura persistida. Su ejecución Node dio 40/42 y Flutter 32/32; el resultado previo 42/42 informado por el productor no describe ese árbol. El veto, reproducciones y reparación se conservan en `finance-verification-round1.json`. No se hizo commit de ese cambio de producto antes de repararlo.

La segunda revisión independiente levantó el veto del código FIN: **56/56 Node y 34/34 Flutter, exit 0**, con reproducciones de los cuatro defectos y fechas de calendario válidas. El nuevo token con revisión vigente recalcula; el replay del mismo token devuelve lo persistido; REPARTIDOR queda rechazado; una edición local no adopta una revisión remota al refrescar; una relectura ausente o incoherente provoca rollback. El resultado está en `finance-verification-round2.json`. La aceptación sigue limitada a ese código y esas pruebas; faltan las escrituras DB2 reales y los tres métodos completos.

Dos sondas con la fuente nueva en memoria sí pasaron dentro de su alcance: el resumen real obtuvo 29,15 € en 723 ms y sólo ejecutó SELECT/WITH; el guardado vacío devolvió `LIQUIDACION_NO_COMMERCIAL_COLLECTIONS`, con diez filas antes y después y toda DML bloqueada en la conexión. Estas sondas no cierran los defectos detectados por QA.

TEST_COBROS contiene 16 filas COMERCIAL/CONTADO por 15.154,43 €. Este conteo anterior es una lectura; todavía no prueba tres métodos de cobro ni una liquidación nueva.

La liquidación TEST conserva diez filas previas sin duplicados de vendedor/fecha ni token. `SYSINDEXES` y `SYSKEYS` acreditan dos índices únicos ya existentes: `UX_TEST_LIQCOM_VENDOR_DAY` sobre CODIGO_VENDEDOR/FECHA y `UX_TEST_LIQCOM_TOKEN` sobre IDEMPOTENCY_TOKEN. `SYSCST` por sí solo sólo mostraba la PK y no bastaba para concluir que faltaban garantías de unicidad. No se ejecutó ningún ALTER redundante.

## Capturas y dispositivo

No hay PNG de pantalla ni capturas físicas en este checkpoint. Las pruebas de layout de modales no sustituyen una captura del pedido completo, y un renderer de tests tampoco demuestra FPS, teclado o barras del sistema en un dispositivo.

## Bloqueos y siguientes verificaciones

`/api/ready` respondió HTTP 503 por falta de hash PIN de B2 (67 de 68 vendedores activos con hash); DB2 respondió en 2 ms y Redis estaba conectado. Resolver ese bloqueo requiere el procedimiento de autenticación autorizado, sin editar los archivos protegidos ni copiar secretos.

El código está en una rama dedicada. Los cambios previos del usuario en AGENTS.md, artefactos de build borrados y scripts de ventas no forman parte de los commits de este trabajo. La comprobación final deberá conservar `git status`, diff por unidad, suites completas, analyze, lint, loop gate, reconciliación y el resultado de cada paso de demo; hasta entonces no hay aceptación global.
