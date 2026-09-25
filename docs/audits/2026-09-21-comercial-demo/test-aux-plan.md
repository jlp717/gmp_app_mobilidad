# Auxiliares isolated_test pendientes de DDL

La sesión de catálogo confirmó que no existen las cinco tablas `JAVIER.TEST_*` auxiliares. La API debe fallar cerrada: no se permite volver a `JAVIER.*` mientras `REPARTO_TABLE_SET=isolated_test`.

Tras aprobación explícita de Javier, ejecutar una sola vez, revisando primero índices y constraints de origen:

```sql
CREATE TABLE JAVIER.TEST_PEDIDOS_SEQ LIKE JAVIER.PEDIDOS_SEQ INCLUDING IDENTITY INCLUDING COLUMN DEFAULTS;
CREATE TABLE JAVIER.TEST_PEDIDO_IDEMPOTENCY LIKE JAVIER.PEDIDO_IDEMPOTENCY INCLUDING IDENTITY INCLUDING COLUMN DEFAULTS;
CREATE TABLE JAVIER.TEST_PEDIDOS_STOCK_RESERVE LIKE JAVIER.PEDIDOS_STOCK_RESERVE INCLUDING IDENTITY INCLUDING COLUMN DEFAULTS;
CREATE TABLE JAVIER.TEST_BOLSA_COMERCIAL LIKE JAVIER.BOLSA_COMERCIAL INCLUDING IDENTITY INCLUDING COLUMN DEFAULTS;
CREATE TABLE JAVIER.TEST_MOVIMIENTOS_BOLSA LIKE JAVIER.MOVIMIENTOS_BOLSA INCLUDING IDENTITY INCLUDING COLUMN DEFAULTS;
```

Antes de usar escritura TEST, verificar en `QSYS2.SYSTABLES`, `QSYS2.SYSCOLUMNS`, `QSYS2.SYSINDEXES` y `QSYS2.SYSKEYS` que se materializaron las columnas, la unicidad de `PEDIDO_IDEMPOTENCY.IDEMPOTENCY_KEY` y las claves necesarias para bolsa/movimientos. No se ejecutó DDL, DML ni limpieza durante esta auditoría.

El script enumera PK: `PEDIDOS_SEQ(EJERCICIO)`, `PEDIDO_IDEMPOTENCY(IDEMPOTENCY_KEY)`, `PEDIDOS_STOCK_RESERVE(ID)`, `BOLSA_COMERCIAL(ID)`, `MOVIMIENTOS_BOLSA(ID)`; UQ: bolsa por vendedor/mes y movimiento por idempotencia; e índices `PID`, bolsa-vendedor, movimiento-bolsa y movimiento-pedido. La única recuperación pendiente fuera de TEST es revisar primero el marcador `demo1789986705834assigned` del pedido 64 y su reserva 64; no se incluye ningún DELETE compartido ni se toca la secuencia global.
