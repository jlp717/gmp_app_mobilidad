# Verificacion DSEDAC -> JAVIER — finanzas de reparto

Fecha de comprobacion: 2026-08-28

## Resultado

No se puede afirmar que exista una copia completa y directa de produccion en las tablas test de reparto. La comprobacion se hizo por SSH contra el servidor de test y por DB2/ODBC, sin ejecutar escrituras sobre DSEDAC.

El modelo operativo actual es distinto: el ERP se lee desde DSEDAC y las operaciones de la app se escriben en tablas internas de JAVIER. Las tablas TEST_REPARTIDOR_* son buffers/fixtures de pruebas, no un espejo 1:1 de DSEDAC.CVC, DSEDAC.CPC, DSEDAC.OPP, DSEDAC.LQD y sus lineas.

## Evidencia DB2 observada

Se verifico previamente el catalogo QSYS2.SYSTABLES/QSYS2.SYSCOLUMNS y despues se consultaron recuentos. En DSEDAC habia, entre otras, 14.083 filas en CLCL1, 767.965 en CPC, 173.970 en CVC, 2.950.011 en LAC, 62.286 en LQD y 310.121 en OPP. En JAVIER, los buffers aislados observados incluian 813 TEST_REPARTIDOR_COBROS, 653 TEST_REPARTIDOR_LIQUIDACION_OPS, 534 TEST_REPARTIDOR_LIQUIDACION_INGRESOS y cero TEST_REPARTIDOR_ENTREGAS/TEST_REPARTIDOR_ENTREGA_LINEAS.

Tambien se comprobo que JAVIER.TEST_COBROS procede de JAVIER.COBROS (813 filas, copia fechada 2026-08-25 11:44:18), no de DSEDAC.CVC/DSEDAC.CRC. El snapshot anterior de esa tabla tenia 828 filas el 2026-08-19.

## Implicacion

Los casos de cobro/liquidacion pueden validarse en el aislamiento de JAVIER con deuda y maestros leidos de DSEDAC, pero no deben etiquetarse como copia de produccion hasta disponer de un mapping aprobado tabla a tabla y de un proceso reproducible de snapshot hacia las tablas test. Ese proceso debe ser explicitamente solo lectura en DSEDAC, escritura controlada en JAVIER, con conteos, claves, sumas monetarias y fecha de snapshot verificables.

## Comprobacion de trazabilidad en test

Consulta solo lectura ejecutada por SSH el 2026-08-28, tras verificar QSYS2.SYSTABLES/SYSCOLUMNS:

- TEST_REPARTIDOR_COBROS: 813 filas; 797 con LIQUIDADO_SN=S y 16 con LIQUIDADO_SN=N. IMPORTEVENCIMIENTO acumulado: 1.042.447,00 EUR; IMPORTEPENDIENTE: 2.762,08 EUR.
- TEST_REPARTIDOR_LIQUIDACION_OPS: 653 cierres; efectivo 610.868,93 EUR; tarjeta 154.625,45 EUR; cheques 112.360,95 EUR; postdatados 162.856,58 EUR; total a ingresar 695.283,71 EUR; ingreso banco 609.334,66 EUR; gastos 71,51 EUR.
- TEST_REPARTIDOR_LIQUIDACION_INGRESOS: 534 ingresos; suma 609.334,66 EUR.
- TEST_REPARTO_VARIANCE_OUTBOX: 1 aviso con STATUS=SENT.

Estas sumas reflejan el estado acumulado de los buffers test y no se presentan como un unico snapshot DSEDAC correlacionado: las claves y el alcance no son equivalentes tabla a tabla. No existe evidencia de una copia integral directa de produccion.
