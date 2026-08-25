# 0004 — Esquemas DB2: DSEDAC solo-lectura (producción) vs JAVIER (pruebas/escritura)

- Estado: Aceptada (retroactiva)
- Fecha: 2026-08-25
- Decisores: Javier (@jlp717)
- Etiquetas: db2, as400, datos, seguridad

## Contexto

IBM DB2 for i en `192.168.1.22` (DSN ODBC `GMP`) aloja dos esquemas con roles opuestos:

- **DSEDAC**: ERP real en producción. Escribir aquí sin pasar por las reglas del ERP corrompe pedidos, cobros y stock.
- **JAVIER**: sandbox de pruebas donde la app puede crear tablas/vistas propias y validar migraciones.

El historial demuestra el riesgo: discrepancias de importes en reparto obligaron a mapear columnas JAVIER↔DSEDAC (`docs/MAPEO_COLUMNAS_JAVIER_DSEDAC.md`) y a construir gates fail-closed en `.env.example` (`DB2_READ_SCHEMA`, `DB2_WRITE_SCHEMA`, `REPARTO_TABLE_SET=isolated_test|production`, `REPARTO_PRODUCTION_ERP_WRITES_APPROVED`, etc.).

## Decisión

1. **Lecturas por defecto contra DSEDAC** (`DB2_READ_SCHEMA=DSEDAC`); **escrituras de app solo en JAVIER** (`DB2_WRITE_SCHEMA=JAVIER`) salvo gates de exportación explícitos que escriben tablas ERP reales (CPC/LPC/CRC) con aprobación humana.
2. Antes de usar cualquier tabla/columna: verificar existencia con `QSYS2.SYSTABLES` / `QSYS2.SYSCOLUMNS`. Nunca inventar nombres.
3. Para deuda: preferir la vista `VISTA_DEUDA_BASE` antes que SQL ad-hoc complejo.
4. `CPC` contiene duplicados: deduplicar siempre con `ROW_NUMBER()`.
5. Objetivos comerciales leen `R1_T8CDVD`, no `LCCDVD`.
6. Todo flag de escritura a producción es fail-closed: valor ausente/desconocido = bloqueo, no permiso.

## Consecuencias

**Positivas**
- El ERP queda intacto por defecto; los errores de la app explotan en JAVIER, no en facturación real.
- Gates explícitos audibles: cada escritura peligrosa exige una variable booleana con nombre y evidencia previa (staging, QA, AppSec, SRE).

**Negativas / riesgos**
- Doble mantenimiento JAVIER↔DSEDAC (mitigado con scripts `db2:align-*` y mapeo documentado).
- Un dev nuevo puede asumir que "el esquema de pruebas" es desechable: JAVIER contiene objetos que la app necesita; borrarlo rompe entornos.

## Alternativas consideradas

1. **Esquema único con roles DB2** — requiere coordinación con el proveedor del ERP; inviable a corto plazo.
2. **Réplica a PostgreSQL/otra BD** — prohibido por reglas del proyecto (DB2 es fuente de verdad; no PostgreSQL/Supabase sin orden expresa).
3. **Escritura directa a DSEDAC siempre con revisión manual** — sin barrera técnica, un bug llega al ERP; rechazada frente a gates fail-closed.
