# 000 — Baseline

Punto de partida documental para instalaciones DB2 ya existentes. No ejecuta SQL ni declara tablas o columnas de negocio.

Antes de crear migración, inventariar objetos reales con `QSYS2.SYSTABLES` y columnas con `QSYS2.SYSCOLUMNS`. `JAVIER.KPI_MIGRATIONS` ya existe como tabla de control; cualquier diferencia entre entornos se resuelve con evidencia QSYS2 y gate separado, nunca suponiendo esquema desde este baseline.
