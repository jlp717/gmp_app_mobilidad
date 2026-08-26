# Migraciones DB2

## Convención

- Ubicación: `db/migrations/`.
- Nombre: `001_descripcion.sql`, `002_descripcion.sql`, en orden ascendente.
- Cada fichero contiene un único batch SQL ejecutable por driver ODBC.
- Runner calcula SHA-256 y registra `<nombre_sin_extension>__<sha8>` en `JAVIER.KPI_MIGRATIONS.NAME`.
- `KPI_MIGRATIONS` no tiene columna checksum; sufijo de ocho caracteres evita DDL adicional.
- Cambiar contenido de migración aplicada produce error de checksum. Crear siguiente número en vez de editar historial.
- No dirigir DDL/DML a `DSEDAC`; guard central lo bloquea.

## Uso

Desde `backend/`:

`node scripts/run-migrations.js` consulta migraciones aplicadas y muestra pendientes sin ejecutar SQL.

`node scripts/run-migrations.js --apply` ejecuta pendientes y registra cada una solo tras éxito. Requiere gate DB2/producción independiente; no se ejecuta automáticamente durante arranque o deploy.

Tabla de control existente: `JAVIER.KPI_MIGRATIONS`. Su esquema real debe verificarse mediante `QSYS2.SYSTABLES` y `QSYS2.SYSCOLUMNS` antes de cambiar runner o convención.
