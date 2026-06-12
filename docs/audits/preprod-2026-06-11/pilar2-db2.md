# PILAR 2 — Auditoría total de base de datos DB2 (pre-producción 2026-06-12)

- **Fecha de ejecución:** 2026-06-11 (noche previa a la presentación)
- **Alcance:** pestañas Pedidos, Cobros y Bolsa comercial — verificación directa contra DB2 for i (AS400, 192.168.1.22, DSN=GMP, paquete `odbc`)
- **Regla aplicada sin excepción:** el schema de producción es **SOLO LECTURA**. Todas las escrituras (DML/DDL) de esta auditoría se ejecutaron exclusivamente sobre `JAVIER` y con limpieza final verificada.
- **Scripts de evidencia** (nuevos, en `backend/scripts/`): `pilar2-sql-runner.js`, `pilar2-catalog-audit.js`, `pilar2-render-comparison.js`, `pilar2-align-defaults-additive.js`, `pilar2-integrity-checks.js`, `pilar2-crud-smoke.js`, `pilar2-perf-checks.js`, `pilar2-views-smoke.js`, `pilar2-render-pending-ddl.js`, `pilar2-build-report.js`
- **Artefactos JSON/MD crudos:** `backend/tmp/db-exploration/pilar2-*-2026-06-11.*`

---

## 1. Verificación del schema de producción real (¿DSEDAC o DSEDSC?)

El encargo mencionaba "DSEDSC"; las reglas del proyecto dicen "DSEDAC". Verificado contra el catálogo:

```sql
SELECT SCHEMA_NAME, SCHEMA_OWNER, SCHEMA_TEXT
FROM QSYS2.SYSSCHEMAS
WHERE SCHEMA_NAME IN ('JAVIER','DSEDAC','DSEDSC')
```

Resultado (2 filas, 397 ms):

| SCHEMA_NAME | SCHEMA_OWNER | SCHEMA_TEXT |
|---|---|---|
| DSEDAC | GIOVA | ERP - Distribución: Datos |
| JAVIER | JAVIER | COLECCION - creada por SQL |

**Conclusión:** `DSEDAC` **existe** y es el schema ERP de producción. `DSEDSC` **no existe** en el catálogo (la consulta pedía los tres nombres y devolvió solo dos). "DSEDSC" era un error tipográfico. Toda la auditoría usa `DSEDAC`.

---

## 2. Inventario de tablas implicadas (grep sobre el código backend)

Método: búsqueda de `FROM / JOIN / INSERT INTO / UPDATE / DELETE FROM` sobre `JAVIER.*`, `DSEDAC.*` y plantillas `${APP_SCHEMA}/${ERP_SCHEMA}` en: `routes/pedidos.js`, `routes/cobros.js`, `routes/bolsa.js`, `services/pedidos.service.js`, `services/bolsa-comercial.service.js`, `services/cache-preloader.js`, `services/dsedac-exports.service.js`, `src/modules/cobros/**` (incl. `db2-cobros-repository.js`).

Resolución de schema verificada en código: `PEDIDOS_CONFIRMATION_SCHEMA` no está definido en `backend/.env` → default `'JAVIER'`; `PEDIDOS_DSEDAC_STORAGE_APPROVED` default `false` (`pedidos.service.js:10-14`, `routes/cobros.js:17-21`, `db2-cobros-repository.js:14-18`). Por tanto `${APP_SCHEMA}` y `${ERP_SCHEMA}` resuelven a **JAVIER** en este entorno.

### 2.1 Tablas JAVIER (app) y sus operaciones

| Tabla | Operaciones | Archivos que la usan (líneas clave) |
|---|---|---|
| JAVIER.PEDIDOS_CAB | **R/W** (INSERT, UPDATE, DELETE, SELECT) | services/pedidos.service.js (INSERT vía db2InsertSql L1823/L1865; UPDATE L1063, L2801, L2840, L3101, L3170, L3241, L3309; DELETE L2124, L2140; SELECT L22-23, L252, L2041, L2190, L2471, L2781, L2864, L3211, L3383-3401, L3461, L3763) · routes/pedidos.js (UPDATE L1671; SELECT L1701/L1710) · routes/cobros.js (SELECT L274, L452) · db2-cobros-repository.js (SELECT L387, L977) |
| JAVIER.PEDIDOS_LIN | **R/W** | services/pedidos.service.js (INSERT L1928/L1963/L2654; UPDATE L2737; DELETE L2139, L2760; SELECT L2196, L2486, L2632, L2702, L2782, L2947) |
| JAVIER.PEDIDOS_SEQ | **R/W** (contador de numeración) | services/pedidos.service.js (INSERT L1745; UPDATE L1725, L1753; SELECT L1734, L1757) |
| JAVIER.PEDIDOS_STOCK_RESERVE | **R/W** | services/pedidos.service.js (INSERT L1100; DELETE L18-20, L3104, L3253; SELECT L1305, L1643, L1696, L3250) |
| JAVIER.COBROS | **R/W** | routes/cobros.js (INSERT vía db2InsertSql L147 + POST L637; SELECT L318, L469, L609, L809) · db2-cobros-repository.js (INSERT L865/L882; SELECT L581, L641, L710, L774, L801, L922, L952, L961, L1025, L1044) |
| JAVIER.REPARTIDOR_COBROS | **R** (en las pestañas auditadas; la escritura vive en el flujo repartidor, fuera de alcance) | routes/cobros.js (SELECT L302, L474, L587, L834) · db2-cobros-repository.js (SELECT L608, L663, L696, L814) |
| JAVIER.BOLSA_COMERCIAL | **R/W** | services/bolsa-comercial.service.js (INSERT L103; UPDATE L169, L205, L515, L521, L526; SELECT L22, L443) — consumido por routes/bolsa.js (sin SQL directo) |
| JAVIER.MOVIMIENTOS_BOLSA | **R/W** | services/bolsa-comercial.service.js (INSERT L305; SELECT L23, L26-35) · services/pedidos.service.js (SELECT L2409) |

### 2.2 Tablas DSEDAC leídas por las 3 pestañas (SOLO LECTURA)

| Tabla DSEDAC | Uso | Archivos |
|---|---|---|
| CLI | clientes (límite crédito, nombres) | routes/pedidos.js L206/L1098/L1841 · routes/cobros.js L492/L780 · db2-cobros-repository.js L513 · cache-preloader.js L144 |
| CLP | vendedor comercial por cliente (filtro semi-join) | routes/pedidos.js L253 · routes/cobros.js L744/L758 · db2-cobros-repository.js L234/L247/L481/L495/L997 |
| CLC | datos comerciales cliente (tarifa) | services/pedidos.service.js L1314, L1594, L4034 |
| CVC | deuda viva / vencimientos (fuente real de Cobros) | routes/cobros.js L251, L439, L779, L812, L837 · db2-cobros-repository.js L318, L512, L584, L611, L644, L666, L1004 · services/pedidos.service.js L4087 |
| ART / ARO / ARA / ALM / FAM / TRF | catálogo artículos, stock, tarifas | services/pedidos.service.js (múltiples: L1277-1321, L1456-1476, L3631-3643, L3686-3733, L3912-3913, L4165-4177) · routes/pedidos.js L1017, L1138, L1156, L1811-1841 |
| LINDTO / LAC / CAC | histórico líneas/albaranes | services/pedidos.service.js L1321, L1566, L3477, L3528-3585, L4165 · cache-preloader.js L90 |
| CRUT / OPP / VEH / PMR / VDD | rutas, reparto, vehículos, promociones, vendedores | services/pedidos.service.js L513, L531, L642-646, L724, L3973 · cache-preloader.js L172 |
| CRC / CLV | lectura de idempotencia para exports | dsedac-exports.service.js L80, L90, L147, L161 |

### 2.3 Escrituras a DSEDAC existentes en código — VERIFICADAS COMO DESACTIVADAS

| Destino | Archivo | Gating verificado |
|---|---|---|
| DSEDAC.CRC, CLV, CAC, LAC (INSERT) | dsedac-exports.service.js L100, L174, L246, L267 | `isEnabled()` (L51-53) exige `PEDIDOS_EXPORT_TO_SYSTEM=true` **y** `PEDIDOS_DSEDAC_EXPORT_APPROVED=true` **y** `ERP_SCHEMA==='DSEDAC'` — los tres faltan en `.env` (defaults `false`/`JAVIER`) → **desactivado** |
| DSEDAC.CPC, LPC, OCPC (INSERT export pedidos) | services/pedidos.service.js L861-984 (buildDsedacCpcInsert/LpcInsert) | `getPedidosConfirmationTarget()` L282-301: `shouldExportToSystem = schema==='DSEDAC' && exportEnabled && exportApproved` → **modo LOCAL (JAVIER)** en este entorno |

Esta auditoría **no ejecutó ninguna** de esas rutas de escritura.

---

## 3. Comparativa estructural completa (valores reales de QSYS2.SYSCOLUMNS / SYSCST / SYSKEYCST / SYSINDEXES / SYSTRIGGERS / SYSSEQUENCES)

Pares comparados (equivalencias de producción según `compare-javier-dsedac-alignment.js`, ya vetado en el repo):

| JAVIER (escritura) | Equivalente producción | Resultado global |
|---|---|---|
| PEDIDOS_CAB | DSEDAC.CPC | 1 idéntica, 140 desajustes (137 nullable/default, 3 tipo) , 0 columnas faltantes, 35 solo-app |
| PEDIDOS_LIN | DSEDAC.LPC | 1 idéntica, 70 desajustes (todos nullable/default), 0 faltantes, 12 solo-app |
| COBROS | DSEDAC.CRC | 0 idénticas, 31 desajustes (30 nullable/default, 1 tipo semántico ID), 0 faltantes, 12 solo-app |
| REPARTIDOR_COBROS | DSEDAC.CRCA | 10 idénticas, 18 desajustes (nullable/default), 0 faltantes, 102 solo-app |
| PEDIDOS_SEQ / PEDIDOS_STOCK_RESERVE / BOLSA_COMERCIAL / MOVIMIENTOS_BOLSA | (solo-app por diseño; bolsa "siempre JAVIER" — dsedac-exports.service.js L29) | estructuras documentadas abajo |

**Lectura clave:** tras las migraciones aditivas del 2026-06-07 **no falta ninguna columna** de producción en JAVIER. El desajuste dominante es **sistemático**: las tablas DSEDAC (ficheros físicos DDS) son `NOT NULL WITH DEFAULT` en todas sus columnas, mientras las tablas JAVIER (creadas por SQL) son mayoritariamente nullable. Detalle completo por columna a continuación; tratamiento en §4 y BLOQUEOS.

> Nota de lectura: "Default PROD = ' '" es blanco DDS; "(HAS_DEFAULT=Y)" en JAVIER con columna nullable significa default implícito NULL. CCSID 284 = EBCDIC España; "-" = no aplica (numérico). La columna **Acción** marca `VER ANALISIS` → consolidado en §4/§9.

### JAVIER.PEDIDOS_CAB vs DSEDAC.CPC

Columnas: DSEDAC.CPC=141, JAVIER.PEDIDOS_CAB=176

| Columna | Tipo PROD | CCSID PROD | Null PROD | Default PROD | Tipo JAVIER | CCSID JAVIER | Null JAVIER | Default JAVIER | ¿Idéntico? | Acción |
|---|---|---|---|---|---|---|---|---|---|---|
| SUBEMPRESAPEDIDO | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOPEDIDO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIEPEDIDO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | 'M' | No (nullable,default) | VER ANALISIS |
| TERMINALPEDIDO | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROPEDIDO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | NO | sin default | No (default) | VER ANALISIS |
| DIADOCUMENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESDOCUMENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANODOCUMENTO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| HORADOCUMENTO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | 0 | No (nullable) | VER ANALISIS |
| CODIGOCLIENTEALBARAN | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCLIENTEFACTURA | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCLIENTECADENA | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDOR | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | NO | sin default | No (default) | VER ANALISIS |
| CODIGOVENDEDORCOBRO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOPROMOTORPREVENTA | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCOMERCIAL | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGORUTA | CHAR(4) | 284 | NO | ' ' | CHAR(4) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOFORMAPAGO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | '02' | No (nullable,default) | VER ANALISIS |
| CODIGOTARIFA | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | 1 | No (nullable,default) | VER ANALISIS |
| CODIGOALMACEN | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | 1 | No (nullable,default) | VER ANALISIS |
| RECARGOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLEBRUTA1 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLE1 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJEIVA1 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEIVA1 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJERECARGO1 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTERECARGO1 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLEBRUTA2 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLE2 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJEIVA2 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEIVA2 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJERECARGO2 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTERECARGO2 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLEBRUTA3 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLE3 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJEIVA3 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEIVA3 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJERECARGO3 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTERECARGO3 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLEBRUTA4 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLE4 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJEIVA4 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEIVA4 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJERECARGO4 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTERECARGO4 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLEBRUTA5 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBASEIMPONIBLE5 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJEIVA5 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEIVA5 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJERECARGO5 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTERECARGO5 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTETOTAL | NUMERIC(10,2) | - | NO | 0 | NUMERIC(11,2) | - | SI | 0 | No (tipo,nullable) | VER ANALISIS |
| IMPORTECOSTO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(11,2) | - | SI | 0 | No (tipo,nullable) | VER ANALISIS |
| IMPORTEMARGEN | NUMERIC(10,2) | - | NO | 0 | NUMERIC(11,2) | - | SI | 0 | No (tipo,nullable) | VER ANALISIS |
| PORCENTAJEDESCUENTO1 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJEDESCUENTO2 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBRUTO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEDEVOLUCION | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEDESCUENTO1 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEDESCUENTO2 | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBONIFICACION | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTESINCARGO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EMPRESACONTABLE | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SITUACIONALBARAN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SUBEMPRESAALBARAN | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOALBARAN | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIEALBARAN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALALBARAN | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROALBARAN | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SITUACIONCARGA | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SUBEMPRESACARGA | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOCARGA | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIECARGA | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALCARGA | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROCARGA | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SITUACIONPEDIDO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOSUBDISTRIBUIDOR | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOOPERACION | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| OBSERVACION1 | CHAR(50) | 284 | NO | ' ' | CHAR(50) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| OBSERVACION2 | CHAR(50) | 284 | NO | ' ' | CHAR(50) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIACREACION | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESCREACION | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOCREACION | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| HORACREACION | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| LATITUD | NUMERIC(15,6) | - | NO | 0 | NUMERIC(15,6) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| LONGITUD | NUMERIC(15,6) | - | NO | 0 | NUMERIC(15,6) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOORDENPREPARACION | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROORDENPREPARACION | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ESTADOORDENPREPARACION | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDORUSUARIO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDORPUNTEO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EFECTIVOTALON | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTECOBRADO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEREDONDEO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEBONIFICACIONDIRECTA | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IDENTICKETCLIENTE | CHAR(15) | 284 | NO | ' ' | CHAR(15) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IDENTICKET | CHAR(15) | 284 | NO | ' ' | CHAR(15) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| LINEASKILOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PROCESADOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| REMOTOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIALLEGADA | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESLLEGADA | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOLLEGADA | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| HORALLEGADA | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOUSUARIO | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIAPRIMERPAGO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESPRIMERPAGO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOPRIMERPAGO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOTIPOPEDIDO | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| REFERENCIAPEDIDOCLIENTE | CHAR(17) | 284 | NO | ' ' | CHAR(17) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TRAZABILIDADPEDIDO | CHAR(30) | 284 | NO | ' ' | CHAR(30) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOLOCALIZACIONENTREGA | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIASERVICIO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESSERVICIO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOSERVICIO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGODELEGACION | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ESTADOPRODUCCION | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ESTADOPRODUCCIONWEB | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CONFORMADOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| FACTORCONVERSION | NUMERIC(10,4) | - | NO | 0 | NUMERIC(10,4) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIAESTADO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESESTADO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOESTADO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SUBEMPRESAPROYECTO | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOPROYECTO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIEPROYECTO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALPROYECTO | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROPROYECTO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MATRICULA | CHAR(20) | 284 | NO | ' ' | CHAR(20) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPRESOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIAIMPRESO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESIMPRESO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOIMPRESO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ENVIADOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIAENVIADO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESENVIADO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOENVIADO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROBULTOS | NUMERIC(5,0) | - | NO | 0 | NUMERIC(5,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCONDUCTOR | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ID | INTEGER | - | NO | (HAS_DEFAULT=I) | INTEGER | - | NO | (HAS_DEFAULT=I) | Sí | - |
| MARCAACTUALIZACION | VARCHAR(50) | 284 | NO | ' ' | VARCHAR(50) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |

Resumen: 1 idénticas, 140 desajustes, 35 columnas solo-app en JAVIER.

Columnas solo-app en JAVIER.PEDIDOS_CAB (no existen en DSEDAC.CPC, no bloquean):
`SUBEMPRESA` CHAR(3), `EJERCICIO` NUMERIC(4,0), `TERMINAL` NUMERIC(3,0), `CODIGOCLIENTE` CHAR(10), `NOMBRECLIENTE` VARCHAR(60), `TIPOVENTA` CHAR(2), `ESTADO` VARCHAR(12), `IMPORTEBASE` NUMERIC(11,2), `IMPORTEIVA` NUMERIC(11,2), `OBSERVACIONES` VARCHAR(200), `CREATED_AT` TIMESTMP, `UPDATED_AT` TIMESTMP, `ORIGEN` CHAR(1), `FECHAREPARTO` DATE, `DIAREPARTO` NUMERIC(2,0), `MESREPARTO` NUMERIC(2,0), `ANOREPARTO` NUMERIC(4,0), `CODIGOREPARTIDOR` CHAR(2), `CODIGOVEHICULO` CHAR(10), `RUTA` VARCHAR(10), `DIASREPARTO` VARCHAR(80), `REPARTO_VALIDADO_SN` CHAR(1), `REPARTO_VALIDADO_AT` TIMESTMP, `TARGET_SCHEMA` CHAR(10), `SYNC_STATUS` VARCHAR(16), `SYNC_AT` TIMESTMP, `SYSTEM_SUBEMPRESAPEDIDO` CHAR(3), `SYSTEM_EJERCICIOPEDIDO` NUMERIC(4,0), `SYSTEM_SERIEPEDIDO` CHAR(1), `SYSTEM_TERMINALPEDIDO` NUMERIC(3,0), `SYSTEM_NUMEROPEDIDO` NUMERIC(6,0), `DESCUENTO_GLOBAL` DECIMAL(5,2), `IMPORTETOTAL_NEW` NUMERIC(10,2), `IMPORTECOSTO_NEW` NUMERIC(10,2), `IMPORTEMARGEN_NEW` NUMERIC(10,2)

- DSEDAC.CPC: constraints: PRIMARY KEY Q_DSEF_CPC_ID_00001 (ID)
- DSEDAC.CPC: índices: ninguno
- DSEDAC.CPC: triggers: ninguno
- JAVIER.PEDIDOS_CAB: constraints: PRIMARY KEY Q_JAVIER_PEDID00001_ID_00001 (ID)
- JAVIER.PEDIDOS_CAB: índices: IDX_PCAB_CLI (CODIGOCLIENTE A); IDX_PCAB_ESTADO (ESTADO A); IDX_PCAB_VND (CODIGOVENDEDOR A); IDX_PEDIDOS_ESTADO (ESTADO A)
- JAVIER.PEDIDOS_CAB: triggers: ninguno

### JAVIER.PEDIDOS_LIN vs DSEDAC.LPC

Columnas: DSEDAC.LPC=71, JAVIER.PEDIDOS_LIN=83

| Columna | Tipo PROD | CCSID PROD | Null PROD | Default PROD | Tipo JAVIER | CCSID JAVIER | Null JAVIER | Default JAVIER | ¿Idéntico? | Acción |
|---|---|---|---|---|---|---|---|---|---|---|
| SUBEMPRESAPEDIDO | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOPEDIDO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIEPEDIDO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALPEDIDO | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROPEDIDO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SECUENCIAPEDIDO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIADOCUMENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESDOCUMENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANODOCUMENTO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| HORADOCUMENTO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCLIENTEALBARAN | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCLIENTEFACTURA | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCLIENTECADENA | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDOR | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDORCOBRO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOPROMOTORPREVENTA | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCOMERCIAL | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGORUTA | CHAR(4) | 284 | NO | ' ' | CHAR(4) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOFORMAPAGO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOTARIFA | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOALMACEN | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| RECARGOSN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TIPOLINEA | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | 'R' | No (nullable,default) | VER ANALISIS |
| TIPOVENTA | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | 'CC' | No (nullable,default) | VER ANALISIS |
| CLASELINEA | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | 'VT' | No (nullable,default) | VER ANALISIS |
| CODIGOARTICULO | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | NO | sin default | No (default) | VER ANALISIS |
| CODIGOIVA | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DESCRIPCION | CHAR(40) | 284 | NO | ' ' | CHAR(40) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CANTIDADENVASES | NUMERIC(7,2) | - | NO | 0 | NUMERIC(7,2) | - | SI | 0 | No (nullable) | VER ANALISIS |
| CANTIDADUNIDADES | NUMERIC(10,5) | - | NO | 0 | NUMERIC(10,5) | - | SI | 0 | No (nullable) | VER ANALISIS |
| PRECIOVENTA | NUMERIC(9,4) | - | NO | 0 | NUMERIC(9,4) | - | SI | 0 | No (nullable) | VER ANALISIS |
| PORCENTAJEDESCUENTO | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEDESCUENTOUNIDAD | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEVENTA | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | 0 | No (nullable) | VER ANALISIS |
| PRECIOCOSTO | NUMERIC(9,4) | - | NO | 0 | NUMERIC(9,4) | - | SI | 0 | No (nullable) | VER ANALISIS |
| IMPORTECOSTO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | 0 | No (nullable) | VER ANALISIS |
| CANTIDADENVASESSERVIDOS | NUMERIC(7,2) | - | NO | 0 | NUMERIC(7,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CANTIDADUNIDADESSERVIDAS | NUMERIC(10,5) | - | NO | 0 | NUMERIC(10,5) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOLOTE | CHAR(30) | 284 | NO | ' ' | CHAR(30) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CANTIDADENVASESPICADOS | NUMERIC(7,2) | - | NO | 0 | NUMERIC(7,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CANTIDADUNIDADESPICADAS | NUMERIC(10,5) | - | NO | 0 | NUMERIC(10,5) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGODESTRUCCIONPRODUCTO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| VALORDESTRUCCIONPRODUCTO | NUMERIC(9,4) | - | NO | 0 | NUMERIC(9,4) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PRECIOKILOS | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEDESTRUCCIONPRODUCTO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOPROMOCIONREGALO | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SECUENCIAPROMOCIONREGALO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CAJASUNIDADES | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PRECIOTARIFACLIENTE | NUMERIC(9,4) | - | NO | 0 | NUMERIC(9,4) | - | SI | 0 | No (nullable) | VER ANALISIS |
| PRECIOTARIFA01 | NUMERIC(9,4) | - | NO | 0 | NUMERIC(9,4) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ORDENPREPARACION | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| PORCENTAJEDESCUENTO02 | NUMERIC(5,2) | - | NO | 0 | NUMERIC(5,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCONCEPTOFACTURACION | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROPROYECTO | CHAR(20) | 284 | NO | ' ' | CHAR(20) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOPROVEEDOR | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| UNIDADESPEDIRPROVEEDOR | NUMERIC(10,5) | - | NO | 0 | NUMERIC(10,5) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOESTADOPROVEEDOR | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SUBEMPRESAORIGEN | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOORIGEN | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIEORIGEN | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALORIGEN | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROORIGEN | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SECUENCIAORIGEN | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOFASE | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOOPERACION | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SECUENCIAMANOOBRA | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOKIT | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CANTIDADPALES | NUMERIC(9,0) | - | NO | 0 | NUMERIC(9,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOESTADO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ID | INTEGER | - | NO | (HAS_DEFAULT=I) | INTEGER | - | NO | (HAS_DEFAULT=I) | Sí | - |
| MARCAACTUALIZACION | VARCHAR(50) | 284 | NO | ' ' | VARCHAR(50) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |

Resumen: 1 idénticas, 70 desajustes, 12 columnas solo-app en JAVIER.

Columnas solo-app en JAVIER.PEDIDOS_LIN (no existen en DSEDAC.LPC, no bloquean):
`PEDIDO_ID` INTEGER, `SECUENCIA` NUMERIC(4,0), `UNIDADMEDIDA` VARCHAR(12), `UNIDADESCAJA` NUMERIC(10,5), `PRECIOTARIFA` NUMERIC(9,4), `PRECIOMINIMO` NUMERIC(9,4), `IMPORTEMARGEN` NUMERIC(10,2), `PORCENTAJEMARGEN` NUMERIC(7,2), `ORDEN` NUMERIC(4,0), `CREATED_AT` TIMESTMP, `DESCUENTO_LINEA` DECIMAL(5,2), `UNIDADESFRACCION` NUMERIC(10,5)

- DSEDAC.LPC: constraints: PRIMARY KEY Q_DSEF_LPC_ID_00001 (ID)
- DSEDAC.LPC: índices: ninguno
- DSEDAC.LPC: triggers: ninguno
- JAVIER.PEDIDOS_LIN: constraints: PRIMARY KEY Q_JAVIER_PEDID00002_ID_00001 (ID)
- JAVIER.PEDIDOS_LIN: índices: IDX_PLIN_ART (CODIGOARTICULO A); IDX_PLIN_PID (PEDIDO_ID A)
- JAVIER.PEDIDOS_LIN: triggers: ninguno

### JAVIER.COBROS vs DSEDAC.CRC

Columnas: DSEDAC.CRC=31, JAVIER.COBROS=43

| Columna | Tipo PROD | CCSID PROD | Null PROD | Default PROD | Tipo JAVIER | CCSID JAVIER | Null JAVIER | Default JAVIER | ¿Idéntico? | Acción |
|---|---|---|---|---|---|---|---|---|---|---|
| SUBEMPRESARECIBO | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIORECIBO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIERECIBO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALRECIBO | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMERORECIBO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCLIENTEFACTURA | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOSUBDISTRIBUIDOR | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDOR | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TIPORECIBO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIADOCUMENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESDOCUMENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANODOCUMENTO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| HORADOCUMENTO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTECOBRADO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTEREDONDEO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EFECTIVOTALON | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROTALON | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIAVENCIMIENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| MESVENCIMIENTO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ANOVENCIMIENTO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOENTIDADBANCARIA | CHAR(4) | 284 | NO | ' ' | CHAR(4) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| OFICINIEXTERIOR | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDORUSUARIO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SUBEMPRESALIQUIDACION | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOLIQUIDACION | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIELIQUIDACION | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALLIQUIDACION | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROLIQUIDACION | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IDMARCALIQUIDACION | CHAR(30) | 284 | NO | ' ' | CHAR(30) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| ID | INTEGER | - | NO | (HAS_DEFAULT=I) | VARCHAR(36) | 284 | SI | (HAS_DEFAULT=Y) | No (tipo,ccsid,nullable,default) | VER ANALISIS |
| MARCAACTUALIZACION | VARCHAR(50) | 284 | NO | ' ' | VARCHAR(50) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |

Resumen: 0 idénticas, 31 desajustes, 12 columnas solo-app en JAVIER.

Columnas solo-app en JAVIER.COBROS (no existen en DSEDAC.CRC, no bloquean):
`CODIGO_CLIENTE` VARCHAR(20), `REFERENCIA` VARCHAR(100), `IMPORTE` DECIMAL(15,2), `FORMA_PAGO` VARCHAR(10), `TIPO_VENTA` VARCHAR(5), `TIPO_MODO` VARCHAR(10), `TIPO_USUARIO` VARCHAR(20), `CODIGO_USUARIO` VARCHAR(20), `OBSERVACIONES` VARCHAR(255), `FECHA` TIMESTMP, `IDEMPOTENCY_TOKEN` VARCHAR(128), `CREATED_AT` TIMESTMP

- DSEDAC.CRC: constraints: PRIMARY KEY Q_DSEF_CRC_ID_00001 (ID)
- DSEDAC.CRC: índices: ninguno
- DSEDAC.CRC: triggers: ninguno
- JAVIER.COBROS: constraints: CHECK Q_JAVIER_COBROS_PRIKEYCHK_00001 (); PRIMARY KEY Q_JAVIER_COBROS_ID_00001 (ID)
- JAVIER.COBROS: índices: IDX_COBROS_CLI (CODIGO_CLIENTE A); IDX_COBROS_IDEM (IDEMPOTENCY_TOKEN A)
- JAVIER.COBROS: triggers: ninguno

### JAVIER.REPARTIDOR_COBROS vs DSEDAC.CRCA

Columnas: DSEDAC.CRCA=28, JAVIER.REPARTIDOR_COBROS=130

| Columna | Tipo PROD | CCSID PROD | Null PROD | Default PROD | Tipo JAVIER | CCSID JAVIER | Null JAVIER | Default JAVIER | ¿Idéntico? | Acción |
|---|---|---|---|---|---|---|---|---|---|---|
| SUBEMPRESAREGISTRO | CHAR(3) | 284 | NO | ' ' | CHAR(3) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EJERCICIOREGISTRO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| SERIEREGISTRO | CHAR(1) | 284 | NO | ' ' | CHAR(1) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| TERMINALREGISTRO | NUMERIC(3,0) | - | NO | 0 | NUMERIC(3,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROREGISTRO | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| NUMEROREGISTROORIGINAL | NUMERIC(6,0) | - | NO | 0 | NUMERIC(6,0) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DIACOBRO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | NO | 0 | Sí | - |
| MESCOBRO | NUMERIC(2,0) | - | NO | 0 | NUMERIC(2,0) | - | NO | 0 | Sí | - |
| ANOCOBRO | NUMERIC(4,0) | - | NO | 0 | NUMERIC(4,0) | - | NO | 0 | Sí | - |
| CUENTACOBRADO | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CUENTATALONES | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CUENTAOTROS | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | NO | ' ' | Sí | - |
| CUENTADESCUENTO | CHAR(10) | 284 | NO | ' ' | CHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOVENDEDOR | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | NO | ' ' | Sí | - |
| IMPORTETOTALCOBRADO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTETOTALTALONES | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTETOTALOTROS | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTETOTALDESCUENTO | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| IMPORTETOTALPENDIENTE | NUMERIC(10,2) | - | NO | 0 | NUMERIC(10,2) | - | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCONCEPTO | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | NO | ' ' | Sí | - |
| DESCRIPCIONCONCEPTO | CHAR(40) | 284 | NO | ' ' | CHAR(40) | 284 | NO | ' ' | Sí | - |
| EXTENSIONCONCEPTO | CHAR(40) | 284 | NO | ' ' | CHAR(40) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| CODIGOCONCEPTOCONTRAPARTIDA | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| DESCCONCEPTOCONTRAPARTIDA | CHAR(40) | 284 | NO | ' ' | CHAR(40) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EXTCONCEPTOCONTRAPARTIDA | CHAR(40) | 284 | NO | ' ' | CHAR(40) | 284 | SI | (HAS_DEFAULT=Y) | No (nullable,default) | VER ANALISIS |
| EMPRESACONTABLE | CHAR(2) | 284 | NO | ' ' | CHAR(2) | 284 | NO | ' ' | Sí | - |
| ID | INTEGER | - | NO | (HAS_DEFAULT=I) | INTEGER | - | NO | (HAS_DEFAULT=I) | Sí | - |
| MARCAACTUALIZACION | VARCHAR(50) | 284 | NO | ' ' | VARCHAR(50) | 284 | NO | ' ' | Sí | - |

Resumen: 10 idénticas, 18 desajustes, 102 columnas solo-app en JAVIER.

Columnas solo-app en JAVIER.REPARTIDOR_COBROS (no existen en DSEDAC.CRCA, no bloquean):
`TIPODOCUMENTO` CHAR(3), `ORIGENDOCUMENTO` CHAR(1), `SUBEMPRESADOCUMENTO` CHAR(3), `EJERCICIODOCUMENTO` NUMERIC(4,0), `SERIEDOCUMENTO` CHAR(1), `TERMINALDOCUMENTO` NUMERIC(3,0), `NUMERODOCUMENTO` NUMERIC(6,0), `XDEDOCUMENTO` NUMERIC(2,0), `DEXDOCUMENTO` NUMERIC(2,0), `SITUACION` CHAR(1), `CLAVEAGRUPAMIENTO` CHAR(1), `CODIGOFORMATOIMPRESION` CHAR(3), `CUENTABANCOREMESA` CHAR(10), `DIAREMESABANCO` NUMERIC(2,0), `MESREMESABANCO` NUMERIC(2,0), `ANOREMESABANCO` NUMERIC(4,0), `DIAREMESACLIENTE` NUMERIC(2,0), `MESREMESACLIENTE` NUMERIC(2,0), `ANOREMESACLIENTE` NUMERIC(4,0), `CUENTALIBRADO` CHAR(10), `CUENTAPAGO` CHAR(10), `CUENTABANCO` CHAR(10), `CUENTABANCOEFECTOSDESCONTADOS` CHAR(10), `CUENTAEFECTOSDESCONTADOS` CHAR(10), `CODIGOCLIENTEALBARAN` CHAR(10), `CODIGOCLIENTEFACTURA` CHAR(10), `CODIGOCLIENTECADENA` CHAR(10), `CODIGOVENDEDORCOBRO` CHAR(2), `CODIGORUTA` CHAR(4), `CODIGOFORMAPAGO` CHAR(2), `DIAVENCIMIENTO` NUMERIC(2,0), `MESVENCIMIENTO` NUMERIC(2,0), `ANOVENCIMIENTO` NUMERIC(4,0), `DIAEMISION` NUMERIC(2,0), `MESEMISION` NUMERIC(2,0), `ANOEMISION` NUMERIC(4,0), `IMPORTEVENCIMIENTO` NUMERIC(10,2), `IMPORTECANCELADO` NUMERIC(10,2), `IMPORTEPENDIENTE` NUMERIC(10,2), `IBAN01` CHAR(4), `IBAN02` CHAR(4), `IBAN03` CHAR(4), `IBAN04` CHAR(4), `IBAN05` CHAR(4), `IBAN06` CHAR(20), `CLAUSULASBANCO` CHAR(20), `DIRECCIONBANCO` CHAR(60), `CODIGOPOSTALBANCO` CHAR(5), `SECUENCIACODIGOPOSTALBANCO` CHAR(4), `POBLACIONBANCO` CHAR(25), `PROVINCIABANCO` CHAR(34), `OBSERVACIONES` CHAR(60), `EMPRESACONTABLE2` CHAR(2), `NUMEROLIQUIDACION` NUMERIC(6,0), `EJERCICIODELDOCUMENTO` NUMERIC(4,0), `DOCUMENTO` CHAR(20), `LUGAREMISION` CHAR(15), `DESDESERIENROPAG` CHAR(4), `DESDENUMERONROPAG` NUMERIC(7,0), `DESDECTRLNUMERONROPAG` NUMERIC(1,0), `DESDENUMERO2NROPAG` NUMERIC(4,0), `DESDECTRLNUMERO2NROPAG` NUMERIC(1,0), `DESCRIPCIONCONCEPTO_1` CHAR(30), `NUMEROASIGNADO` NUMERIC(10,0), `SUBEMPRESADOCUMENTOASOCIADO` CHAR(3), `EJERCICIODOCUMENTOASOCIADO` NUMERIC(4,0), `SERIEDOCUMENTOASOCIADO` CHAR(1), `TERMINALDOCUMENTOASOCIADO` NUMERIC(3,0), `NUMERODOCUMENTOASOCIADO` NUMERIC(6,0), `CODIGOMETODOPAGO` CHAR(2), `REFERENCIACARTERA` CHAR(20), `REFERENCIATIPODOCUMENTO` CHAR(5), `COMISIONESSN` CHAR(1), `IMPORTECOMISION` NUMERIC(10,2), `CODIGOIVA` CHAR(1), `IMPORTEIVACOMISION` NUMERIC(10,2), `IMPORTEOTROS` NUMERIC(10,2), `IMPORTEGASTOS` NUMERIC(10,2), `IMPUTARGASTOSSN` CHAR(1), `CUENTAACREEDORA` CHAR(10), `CUENTAGASTOS` CHAR(10), `CODIGOCANAL` CHAR(5), `ANULADOSN` CHAR(1), `CODIGOFORMAPAGOORIGINAL` CHAR(2), `CODIGOMETODOPAGOORIGINAL` CHAR(2), `CUENTACARGOABONO` CHAR(10), `SUBEMPRESAASIENTO` CHAR(3), `EJERCICIOASIENTO` NUMERIC(4,0), `SERIEASIENTO` CHAR(1), `TERMINALASIENTO` NUMERIC(3,0), `NUMEROASIENTO` NUMERIC(6,0), `SECUENCIAASIENTO` NUMERIC(4,0), `SITUACIONORIGINAL` CHAR(1), `CODIGOVENDEDORPOSEEDOR` CHAR(2), `IDEMPOTENCY_TOKEN` VARCHAR(128), `CREATED_AT` TIMESTMP, `UPDATED_AT` TIMESTMP, `STATUS` VARCHAR(20), `OPERADOR` VARCHAR(50), `PANTALLA_ORIGEN` VARCHAR(20), `LIQUIDADO_SN` CHAR(1), `LIQUIDACION_TOKEN` VARCHAR(128)

- DSEDAC.CRCA: constraints: PRIMARY KEY Q_DSEF_CRCA_ID_00001 (ID)
- DSEDAC.CRCA: índices: ninguno
- DSEDAC.CRCA: triggers: ninguno
- JAVIER.REPARTIDOR_COBROS: constraints: PRIMARY KEY Q_JAVIER_REPAR00001_ID_00001 (ID)
- JAVIER.REPARTIDOR_COBROS: índices: IDX_REP_COBROS_CLIENTE (CODIGOCLIENTEALBARAN A, CODIGOCLIENTEFACTURA A); IDX_REP_COBROS_DOC (SUBEMPRESADOCUMENTO A, EJERCICIODOCUMENTO A, SERIEDOCUMENTO A, TERMINALDOCUMENTO A, NUMERODOCUMENTO A); IDX_REP_COBROS_REP_LIQ_FECHA (CODIGOVENDEDOR A, NUMEROLIQUIDACION A, DIACOBRO A, MESCOBRO A, ANOCOBRO A); REP_COBROS_VENDEDOR (CODIGOVENDEDOR A, CODIGOVENDEDORCOBRO A); UX_REP_COBROS_TOKEN [U] (IDEMPOTENCY_TOKEN A)
- JAVIER.REPARTIDOR_COBROS: triggers: ninguno

## Tablas solo-app JAVIER (sin equivalente ERP por diseño)

### JAVIER.PEDIDOS_SEQ (2 columnas)

| Columna | Tipo | CCSID | Null | Default | Identity |
|---|---|---|---|---|---|
| EJERCICIO | NUMERIC(4,0) | - | NO | sin default | - |
| ULTIMO_NUMERO | NUMERIC(6,0) | - | SI | 0 | - |

- Constraints: PRIMARY KEY Q_JAVIER_PEDID00003_EJERCICIO_00001 (EJERCICIO)
- Índices: ninguno
- Triggers: ninguno

### JAVIER.PEDIDOS_STOCK_RESERVE (6 columnas)

| Columna | Tipo | CCSID | Null | Default | Identity |
|---|---|---|---|---|---|
| ID | INTEGER | - | NO | (HAS_DEFAULT=I) | SI |
| PEDIDO_ID | INTEGER | - | NO | sin default | - |
| CODIGOARTICULO | CHAR(10) | 284 | NO | sin default | - |
| CANTIDADENVASES | NUMERIC(7,2) | - | SI | 0 | - |
| CANTIDADUNIDADES | NUMERIC(10,5) | - | SI | 0 | - |
| CREATED_AT | TIMESTMP | 284 | SI | CURRENT_TIMESTAMP | - |

- Constraints: PRIMARY KEY Q_JAVIER_PEDID00004_ID_00001 (ID)
- Índices: IDX_PSR_PID (PEDIDO_ID A)
- Triggers: ninguno

### JAVIER.BOLSA_COMERCIAL (11 columnas)

| Columna | Tipo | CCSID | Null | Default | Identity |
|---|---|---|---|---|---|
| ID | INTEGER | - | NO | (HAS_DEFAULT=I) | SI |
| CODIGOVENDEDOR | VARCHAR(10) | 284 | NO | sin default | - |
| EJERCICIO | NUMERIC(4,0) | - | NO | sin default | - |
| MES | NUMERIC(2,0) | - | NO | sin default | - |
| LIMITE_PCT | DECIMAL(5,2) | - | SI | 3.00 | - |
| LIMITE_IMPORTE | DECIMAL(11,2) | - | SI | 0 | - |
| SALDO_DISPONIBLE | DECIMAL(11,2) | - | SI | 0 | - |
| CONSUMIDO | DECIMAL(11,2) | - | SI | 0 | - |
| ACUMULADO | DECIMAL(11,2) | - | SI | 0 | - |
| CREATED_AT | TIMESTMP | 284 | SI | CURRENT_TIMESTAMP | - |
| UPDATED_AT | TIMESTMP | 284 | SI | CURRENT_TIMESTAMP | - |

- Constraints: PRIMARY KEY Q_JAVIER_BOLSA00001_ID_00001 (ID)
- Índices: IDX_BOLSA_VND (CODIGOVENDEDOR A, EJERCICIO A); UQ_BOLSA_VND_MES (CODIGOVENDEDOR A, EJERCICIO A, MES A)
- Triggers: ninguno

### JAVIER.MOVIMIENTOS_BOLSA (17 columnas)

| Columna | Tipo | CCSID | Null | Default | Identity |
|---|---|---|---|---|---|
| ID | INTEGER | - | NO | (HAS_DEFAULT=I) | SI |
| BOLSA_ID | INTEGER | - | NO | sin default | - |
| PEDIDO_ID | INTEGER | - | SI | (HAS_DEFAULT=Y) | - |
| TIPO | VARCHAR(20) | 284 | NO | sin default | - |
| IMPORTE | DECIMAL(11,2) | - | NO | sin default | - |
| SALDO_ANTERIOR | DECIMAL(11,2) | - | SI | (HAS_DEFAULT=Y) | - |
| SALDO_POSTERIOR | DECIMAL(11,2) | - | SI | (HAS_DEFAULT=Y) | - |
| CODIGO_ARTICULO | VARCHAR(20) | 284 | SI | (HAS_DEFAULT=Y) | - |
| DESCRIPCION | VARCHAR(200) | 284 | SI | (HAS_DEFAULT=Y) | - |
| CREATED_AT | TIMESTMP | 284 | SI | CURRENT_TIMESTAMP | - |
| CODIGOVENDEDOR | VARCHAR(10) | 284 | SI | (HAS_DEFAULT=Y) | - |
| LINEA_ID | INTEGER | - | SI | (HAS_DEFAULT=Y) | - |
| PRECIO_MINIMO_CONGELADO | DECIMAL(9,4) | - | SI | (HAS_DEFAULT=Y) | - |
| PRECIO_VENTA | DECIMAL(9,4) | - | SI | (HAS_DEFAULT=Y) | - |
| CANTIDAD | DECIMAL(12,5) | - | SI | (HAS_DEFAULT=Y) | - |
| UNIDAD_MEDIDA | VARCHAR(12) | 284 | SI | (HAS_DEFAULT=Y) | - |
| IDEMPOTENCY_KEY | VARCHAR(128) | 284 | SI | (HAS_DEFAULT=Y) | - |

- Constraints: PRIMARY KEY Q_JAVIER_MOVIM00001_ID_00001 (ID)
- Índices: IDX_MOV_BOLSA (BOLSA_ID A); IDX_MOV_PED (PEDIDO_ID A); UQ_MOV_BOLSA_IDEMP (IDEMPOTENCY_KEY A)
- Triggers: ninguno

## Secuencias en JAVIER

- ninguna (PEDIDOS_SEQ es tabla contador, no secuencia nativa)

## Vistas en JAVIER

- DIM_CLIENTE (insertable: YES)
- DIM_VENDEDOR (insertable: YES)
- SYSCHKCST (insertable: NO)
- SYSCST (insertable: NO)
- SYSCSTCOL (insertable: NO)
- SYSCSTDEP (insertable: NO)
- SYSKEYCST (insertable: NO)
- SYSREFCST (insertable: NO)
- V_ACTIVE_SESSIONS (insertable: NO)
- V_COBROS_MOROSIDAD (insertable: YES)
- V_COBROS_POR_FACTURA (insertable: NO)
- V_COMISIONES_REPARTIDOR (insertable: NO)
- V_CRUT (insertable: YES)
- V_CUSTOMERS_NEED_HASH_UPDATE (insertable: NO)
- V_DEBUG_FINAL (insertable: NO)
- V_DEBUG_LAC_ONLY (insertable: YES)
- V_DEBUG_1 (insertable: NO)
- V_DEBUG_2 (insertable: YES)
- V_DEBUG_3 (insertable: YES)
- V_DIM_ALMACEN (insertable: NO)
- V_DIM_ARTICULO (insertable: NO)
- V_DIM_CLIENTE (insertable: NO)
- V_DIM_CLIENTE_EXT (insertable: NO)
- V_DIM_CUENTA (insertable: NO)
- V_DIM_FECHA (insertable: NO)
- V_DIM_GEOGRAFIA (insertable: NO)
- V_DIM_MARCA (insertable: YES)
- V_DIM_MONEDA (insertable: YES)
- V_DIM_ORDEN (insertable: NO)
- V_DIM_PAIS (insertable: YES)
- V_DIM_PREFAMILIA (insertable: NO)
- V_DIM_PRESENTACION (insertable: YES)
- V_DIM_PROVEEDOR (insertable: NO)
- V_DIM_RUTA (insertable: YES)
- V_DIM_SUBFAMILIA (insertable: YES)
- V_DIM_TIPO (insertable: NO)
- V_DIM_TIPO_VEHICULO (insertable: YES)
- V_DIM_VEHICULO (insertable: YES)
- V_DIM_VENDEDOR (insertable: NO)
- V_DIM_VENDEDOR_EXT (insertable: YES)
- V_ENTREGAS_HOY (insertable: YES)
- V_ERROR_TRIGGER (insertable: NO)
- V_FACT_CAJA (insertable: YES)
- V_FACT_COMISIONES_2015 (insertable: YES)
- V_FACT_MUESTRAS (insertable: NO)
- V_FACT_PESAJES_SALIDAS (insertable: NO)
- V_FACT_PREPARACION_PEDIDOS (insertable: NO)
- V_FACT_REMESAS_PAGO (insertable: YES)
- V_FACT_RESUMEN_VENTAS (insertable: YES)
- V_FACT_TARIFAS_PROVEEDOR (insertable: YES)
- V_FACT_VENTAS (insertable: NO)
- V_FACT_VENTAS_GB (insertable: NO)
- V_GPS_TERMINALES (insertable: YES)
- V_LACLAE_MASTER (insertable: NO)
- V_LEGACY_PASSWORD_CUSTOMERS (insertable: NO)
- V_MAYOR (insertable: YES)
- V_MEDIOS_POWERBI (insertable: NO)
- V_MIGRATION_STATS (insertable: NO)
- V_PROD_METODOLOGIAS (insertable: NO)
- V_PROD_OPERACIONES (insertable: YES)
- V_PROD_ORDENES (insertable: YES)
- V_PROMO_PRECIO_UNIDAD (insertable: YES)
- V_PROMO_PRECIOS_CLIENTE (insertable: YES)
- V_PROMO_PRECIOS_PROVEEDOR (insertable: YES)
- V_PUENTE_PED_ALB_FRA (insertable: YES)
- V_RECENT_FAILED_LOGINS (insertable: NO)
- V_RRHH_JORNADA (insertable: YES)
- V_SII_FACTURAS_EXPEDIDAS (insertable: NO)
- V_SII_METALICO (insertable: YES)
- V_STG_LAC (insertable: YES)
- V_STG_LFC_TAX_DOC (insertable: NO)
- V_STG_LFC_TAX_DOC_IVA (insertable: NO)
- V_STOCK_VALOR_DIARIO (insertable: YES)
- V_TEST (insertable: NO)
- V_VEHICULO_COMBUSTIBLE (insertable: YES)
- VISTA_DEUDA_BASE (insertable: NO)
- VW_DIM_ARTICULO (insertable: YES)
- VW_DIM_CLIENTE (insertable: YES)
- VW_DIM_FORMAPAGO (insertable: YES)
- VW_DIM_RUTA (insertable: NO)
- VW_DIM_VENDEDOR (insertable: YES)
- VW_FACT_VENTAS (insertable: NO)
- VW_FACT_VENTAS_DIA (insertable: NO)
- VW_FACT_VENTAS_UNIDADES (insertable: NO)
- VX_KEYS_CAC (insertable: NO)
- VX_KEYS_LAC (insertable: YES)
- VX_KEYS_LGV (insertable: NO)
- VX_LGV_FECHA_DOC (insertable: NO)

---

## 4. Resolución de desajustes

### 4.1 Migración ADITIVA aplicada (solo JAVIER): defaults idénticos a producción

Los 3 únicos desajustes resolubles de forma 100% aditiva (ambos lados `NOT NULL`, solo difería el default; `SET DEFAULT` no toca datos) se corrigieron con el patrón de migraciones existente. Archivos generados:

- `backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.sql`
- `backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.json`

```sql
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOARTICULO SET DEFAULT ' ';
```

Verificación ANTES → DESPUÉS contra `QSYS2.SYSCOLUMNS` (incluida en el JSON de la migración):

| Tabla.Columna | ANTES (IS_NULLABLE / HAS_DEFAULT / COLUMN_DEFAULT) | DESPUÉS | PROD (referencia) |
|---|---|---|---|
| JAVIER.PEDIDOS_CAB.NUMEROPEDIDO | N / N / (sin default) | N / Y / 0 | DSEDAC.CPC: N / 0 — **idéntico** |
| JAVIER.PEDIDOS_CAB.CODIGOVENDEDOR | N / N / (sin default) | N / Y / ' ' | DSEDAC.CPC: N / ' ' — **idéntico** |
| JAVIER.PEDIDOS_LIN.CODIGOARTICULO | N / N / (sin default) | N / Y / ' ' | DSEDAC.LPC: N / ' ' — **idéntico** |

Estado de aplicación: las 3 sentencias `OK` (campo `applied` del JSON).

### 4.2 Desajustes NO aditivos — NO aplicados (ver BLOQUEOS PENDIENTES §9)

1. **256 columnas nullable en JAVIER que en producción son NOT NULL** (PEDIDOS_CAB 138, PEDIDOS_LIN 69, COBROS 31, REPARTIDOR_COBROS 18). Alinearlas exige backfill + `SET NOT NULL` (reorganización de tabla, cambio de comportamiento ante INSERT con NULL explícito) → **no aditivo**, no se aplica la noche previa. DDL exacto completo en **Apéndice A**.
2. **IMPORTETOTAL / IMPORTECOSTO / IMPORTEMARGEN**: JAVIER `NUMERIC(11,2)` vs CPC `NUMERIC(10,2)` — JAVIER es MÁS ancho; estrecharlo sería destructivo. No se aplica.
3. **COBROS.ID** `VARCHAR(36)` (UUID app) vs **CRC.ID** `INTEGER` identity — desajuste semántico documentado y aceptado en el repo (`ACCEPTED_SEMANTIC_TYPE_MISMATCHES`, compare-javier-dsedac-alignment.js L96-104); el export usa `IDMARCALIQUIDACION` como puente.

---

## 5. Integridad de datos actuales en JAVIER (solo SELECT)

### 5.1 Dominios reales extraídos

Dominio de estados en código: `VALID_ORDER_STATES = ['BORRADOR','PENDIENTE_APROBACION','CONFIRMANDO','CONFIRMADO','ENVIADO','ANULADO']` (pedidos.service.js:207). Importante: el servicio almacena `PENDIENTE_APROBACION` como `'PEND_APROB'` (`STORAGE_ORDER_STATE`, pedidos.service.js:203-205) para caber en `VARCHAR(12)`.

**dominio_estados_pedidos_cab**

```sql
SELECT ESTADO, COUNT(*) AS N FROM (SELECT COALESCE(TRIM(ESTADO), '(NULL)') AS ESTADO FROM JAVIER.PEDIDOS_CAB) T GROUP BY ESTADO ORDER BY N DESC
```

| ESTADO | N |
|---|---|
| ANULADO | 16 |
| CONFIRMADO | 2 |
| BORRADOR | 2 |
| ENVIADO | 1 |

**dominio_tipo_movimientos_bolsa**

```sql
SELECT TIPO, COUNT(*) AS N, MIN(IMPORTE) AS MIN_IMPORTE, MAX(IMPORTE) AS MAX_IMPORTE FROM (SELECT TRIM(TIPO) AS TIPO, IMPORTE FROM JAVIER.MOVIMIENTOS_BOLSA) T GROUP BY TIPO ORDER BY N DESC
```

Resultado: 0 filas (tabla vacía).

**dominio_referencia_cobros**

```sql
SELECT PATRON, COUNT(*) AS N FROM ( SELECT CASE WHEN REFERENCIA IS NULL THEN '(NULL)' WHEN REFERENCIA LIKE 'PEDIDO:%' THEN 'PEDIDO:id:serie-num' WHEN REFERENCIA LIKE 'CVC:%' THEN 'CVC:serie-num' ELSE 'serie-num (legacy)' END AS PATRON FROM JAVIER.COBROS) T GROUP BY PATRON ORDER BY N DESC
```

Resultado: 0 filas (tabla vacía).

**totales_filas**

```sql
SELECT 'PEDIDOS_CAB' AS TABLA, COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB UNION ALL SELECT 'PEDIDOS_LIN', COUNT(*) FROM JAVIER.PEDIDOS_LIN UNION ALL SELECT 'COBROS', COUNT(*) FROM JAVIER.COBROS UNION ALL SELECT 'REPARTIDOR_COBROS', COUNT(*) FROM JAVIER.REPARTIDOR_COBROS UNION ALL SELECT 'BOLSA_COMERCIAL', COUNT(*) FROM JAVIER.BOLSA_COMERCIAL UNION ALL SELECT 'MOVIMIENTOS_BOLSA', COUNT(*) FROM JAVIER.MOVIMIENTOS_BOLSA UNION ALL SELECT 'PEDIDOS_STOCK_RESERVE', COUNT(*) FROM JAVIER.PEDIDOS_STOCK_RESERVE UNION ALL SELECT 'PEDIDOS_SEQ', COUNT(*) FROM JAVIER.PEDIDOS_SEQ
```

| TABLA | N |
|---|---|
| PEDIDOS_CAB | 21 |
| PEDIDOS_LIN | 30 |
| COBROS | 0 |
| REPARTIDOR_COBROS | 0 |
| BOLSA_COMERCIAL | 15 |
| MOVIMIENTOS_BOLSA | 0 |
| PEDIDOS_STOCK_RESERVE | 3 |
| PEDIDOS_SEQ | 1 |


### 5.2 Verificaciones (COUNT > 0 habría incluido hasta 5 filas de ejemplo; todos dieron 0)

| # | Verificación | SQL (compactada) | COUNT | Resultado |
|---|---|---|---|---|
| 1 | estados_null_o_fuera_dominio | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE ESTADO IS NULL OR TRIM(ESTADO) NOT IN ('BORRADOR','PENDIENTE_APROBACION','CONFIRMANDO','CONFIRMADO','ENVIADO','ANULADO')` | 0 | OK |
| 2 | lineas_sin_cabecera | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN L LEFT JOIN JAVIER.PEDIDOS_CAB C ON L.PEDIDO_ID = C.ID WHERE C.ID IS NULL` | 0 | OK |
| 3 | reservas_stock_sin_cabecera | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_STOCK_RESERVE R LEFT JOIN JAVIER.PEDIDOS_CAB C ON R.PEDIDO_ID = C.ID WHERE C.ID IS NULL` | 0 | OK |
| 4 | cobros_huerfanos_de_pedido | `SELECT COUNT(*) AS N FROM JAVIER.COBROS CO WHERE CO.REFERENCIA LIKE 'PEDIDO:%' AND NOT EXISTS ( SELECT 1 FROM JAVIER.PEDIDOS_CAB PC WHERE PC.ID = CAST(SUBSTR(CO.REFERENCIA, 8, LOCATE(':', CO.REFERENCIA, 8) - 8) AS INTEGER))` | 0 | OK |
| 5 | movimientos_bolsa_sin_bolsa | `SELECT COUNT(*) AS N FROM JAVIER.MOVIMIENTOS_BOLSA M LEFT JOIN JAVIER.BOLSA_COMERCIAL B ON M.BOLSA_ID = B.ID WHERE B.ID IS NULL` | 0 | OK |
| 6 | movimientos_bolsa_pedido_inexistente | `SELECT COUNT(*) AS N FROM JAVIER.MOVIMIENTOS_BOLSA M LEFT JOIN JAVIER.PEDIDOS_CAB C ON M.PEDIDO_ID = C.ID WHERE M.PEDIDO_ID IS NOT NULL AND C.ID IS NULL` | 0 | OK |
| 7 | lineas_cantidades_no_positivas | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(CANTIDADENVASES,0) <= 0 AND COALESCE(CANTIDADUNIDADES,0) <= 0` | 0 | OK |
| 8 | lineas_cantidades_negativas | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(CANTIDADENVASES,0) < 0 OR COALESCE(CANTIDADUNIDADES,0) < 0` | 0 | OK |
| 9 | pedidos_importe_negativo | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE COALESCE(IMPORTETOTAL,0) < 0` | 0 | OK |
| 10 | lineas_importe_negativo | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_LIN WHERE COALESCE(IMPORTEVENTA,0) < 0` | 0 | OK |
| 11 | cobros_importe_no_positivo | `SELECT COUNT(*) AS N FROM JAVIER.COBROS WHERE IMPORTE <= 0` | 0 | OK |
| 12 | bolsa_saldo_negativo | `SELECT COUNT(*) AS N FROM JAVIER.BOLSA_COMERCIAL WHERE COALESCE(SALDO_DISPONIBLE,0) < 0` | 0 | OK |
| 13 | pedidos_fechas_absurdas | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE (EJERCICIO < 2000 OR EJERCICIO > 2027) OR (ANODOCUMENTO IS NOT NULL AND ANODOCUMENTO <> 0 AND (ANODOCUMENTO < 2000 OR ANODOCUMENTO > 2027)) OR (CREATED_AT IS NOT NULL AND (CREATED_AT < TIMESTAMP('2000-01-01-00.00.00') OR CREATED_AT > TIMESTAMP('2027-12-31-23.59.59')))` | 0 | OK |
| 14 | cobros_fechas_absurdas | `SELECT COUNT(*) AS N FROM JAVIER.COBROS WHERE (ANODOCUMENTO IS NOT NULL AND ANODOCUMENTO <> 0 AND (ANODOCUMENTO < 2000 OR ANODOCUMENTO > 2027)) OR (CREATED_AT IS NOT NULL AND (CREATED_AT < TIMESTAMP('2000-01-01-00.00.00') OR CREATED_AT > TIMESTAMP('2027-12-31-23.59.59')))` | 0 | OK |
| 15 | estado_excede_varchar12 | `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB WHERE LENGTH(TRIM(ESTADO)) > 12` | 0 | OK |

**Resultado: 15/15 verificaciones en 0.** Sin estados NULL ni fuera de dominio, sin huérfanos (líneas↔cabecera, reservas↔cabecera, cobros↔pedidos vía `REFERENCIA LIKE 'PEDIDO:%'`, movimientos↔bolsa, movimientos↔pedido), sin cantidades ≤0, sin importes negativos, sin fechas <2000 ni >2027, sin saldos de bolsa negativos. Nota: `COBROS`, `REPARTIDOR_COBROS` y `MOVIMIENTOS_BOLSA` están vacías en JAVIER (0 filas), por lo que sus checks pasan por vacuidad — verificado también su DDL/índices en §3.

---

## 6. CRUD de humo a nivel SQL en JAVIER (con limpieza verificada)

Diseño: claves improbables (`CODIGOCLIENTE='ZZTEST9999'`, `NUMEROPEDIDO=999999`, `CODIGOVENDEDOR='ZZ'`, artículos `ZZTESTART*`), column-set idéntico al INSERT real de la app (`buildLegacyPedidoCabInsert`, pedidos.service.js:1848-1858 + DESCUENTO_GLOBAL/ORIGEN), pre-limpieza y limpieza final en `finally` (se ejecuta incluso si un paso falla). Evidencia completa: `backend/tmp/db-exploration/pilar2-crud-smoke-2026-06-11.json`. **Resultado global: OK, base de datos limpia (residuo 0/0).**

**Paso 1 — CLEANUP**

```sql
DELETE FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID IN (SELECT ID FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ?); DELETE FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ?
```
Parámetros: `["ZZTEST9999"]`

Resultado:
```json
"executed"
```

**Paso 2 — BASELINE_COUNTS**

```sql
SELECT (SELECT COUNT(*) FROM JAVIER.PEDIDOS_CAB) AS CAB, (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN) AS LIN FROM SYSIBM.SYSDUMMY1
```

Resultado:
```json
[
 {
  "CAB": 21,
  "LIN": 30
 }
]
```

**Paso 3 — INSERT_CAB**

```sql
INSERT INTO JAVIER.PEDIDOS_CAB ( EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO, CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO, CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, OBSERVACIONES, DESCUENTO_GLOBAL, ORIGEN ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```
Parámetros: `[2026,999999,11,6,2026,230024,"ZZTEST9999","PILAR2 AUDIT SMOKE TEST","ZZ","02",1,1,"CC","PILAR2 SMOKE 2026-06-11 DELETE ME",0,"A"]`

Resultado:
```json
[]
```

**Paso 4 — VERIFY_CAB_INSERT**

```sql
SELECT ID, EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO, TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE, TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE, TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, TRIM(CODIGOFORMAPAGO) AS CODIGOFORMAPAGO, CODIGOTARIFA, CODIGOALMACEN, TRIM(TIPOVENTA) AS TIPOVENTA, TRIM(OBSERVACIONES) AS OBSERVACIONES, DESCUENTO_GLOBAL, TRIM(ORIGEN) AS ORIGEN, TRIM(ESTADO) AS ESTADO, IMPORTETOTAL, CREATED_AT, UPDATED_AT FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ? AND NUMEROPEDIDO = ?
```
Parámetros: `["ZZTEST9999",999999]`

Resultado:
```json
[
 {
  "ID": 81,
  "EJERCICIO": 2026,
  "NUMEROPEDIDO": 999999,
  "DIADOCUMENTO": 11,
  "MESDOCUMENTO": 6,
  "ANODOCUMENTO": 2026,
  "HORADOCUMENTO": 230024,
  "CODIGOCLIENTE": "ZZTEST9999",
  "NOMBRECLIENTE": "PILAR2 AUDIT SMOKE TEST",
  "CODIGOVENDEDOR": "ZZ",
  "CODIGOFORMAPAGO": "02",
  "CODIGOTARIFA": 1,
  "CODIGOALMACEN": 1,
  "TIPOVENTA": "CC",
  "OBSERVACIONES": "PILAR2 SMOKE 2026-06-11 DELETE ME",
  "DESCUENTO_GLOBAL": 0,
  "ORIGEN": "A",
  "ESTADO": "BORRADOR",
  "IMPORTETOTAL": 0,
  "CREATED_AT": "2026-06-11 23:39:08.779230",
  "UPDATED_AT": "2026-06-11 23:39:08.779230"
 }
]
```

**Paso 5 — FIELD_BY_FIELD_CAB**

```sql
(comparacion en memoria contra valores insertados)
```

Resultado:
```json
"TODOS LOS CAMPOS COINCIDEN (incl. default ESTADO=BORRADOR)"
```

**Paso 6 — INSERT_LIN_1**

```sql
INSERT INTO JAVIER.PEDIDOS_LIN ( PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION, CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA, PRECIOVENTA, IMPORTEVENTA, CLASELINEA ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```
Parámetros: `[81,1,"ZZTESTART1","ARTICULO PRUEBA PILAR2",2,12,"CAJ",6,1.5,18,"VT"]`

Resultado:
```json
[]
```

**Paso 7 — INSERT_LIN_2**

```sql
INSERT INTO JAVIER.PEDIDOS_LIN ( PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION, CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA, PRECIOVENTA, IMPORTEVENTA, CLASELINEA ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```
Parámetros: `[81,2,"ZZTESTART2","ARTICULO PRUEBA PILAR2 B",1,6,"CAJ",6,2.25,13.5,"VT"]`

Resultado:
```json
[]
```

**Paso 8 — VERIFY_LIN_INSERT**

```sql
SELECT ID, PEDIDO_ID, SECUENCIA, TRIM(CODIGOARTICULO) AS ART, CANTIDADENVASES, CANTIDADUNIDADES, PRECIOVENTA, IMPORTEVENTA, TRIM(CLASELINEA) AS CLASE FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ? ORDER BY SECUENCIA
```
Parámetros: `[81]`

Resultado:
```json
[
 {
  "ID": 61,
  "PEDIDO_ID": 81,
  "SECUENCIA": 1,
  "ART": "ZZTESTART1",
  "CANTIDADENVASES": 2,
  "CANTIDADUNIDADES": 12,
  "PRECIOVENTA": 1.5,
  "IMPORTEVENTA": 18,
  "CLASE": "VT"
 },
 {
  "ID": 62,
  "PEDIDO_ID": 81,
  "SECUENCIA": 2,
  "ART": "ZZTESTART2",
  "CANTIDADENVASES": 1,
  "CANTIDADUNIDADES": 6,
  "PRECIOVENTA": 2.25,
  "IMPORTEVENTA": 13.5,
  "CLASE": "VT"
 }
]
```

**Paso 9 — UPDATE_FIELD**

```sql
UPDATE JAVIER.PEDIDOS_CAB SET OBSERVACIONES = ?, IMPORTETOTAL = ?, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?
```
Parámetros: `["PILAR2 SMOKE UPDATED OK",31.5,81]`

Resultado:
```json
[]
```

**Paso 10 — VERIFY_UPDATE_FIELD**

```sql
SELECT TRIM(OBSERVACIONES) AS OBSERVACIONES, IMPORTETOTAL FROM JAVIER.PEDIDOS_CAB WHERE ID = ?
```
Parámetros: `[81]`

Resultado:
```json
[
 {
  "OBSERVACIONES": "PILAR2 SMOKE UPDATED OK",
  "IMPORTETOTAL": 31.5
 }
]
```

**Paso 11 — UPDATE_ESTADO**

```sql
UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'CONFIRMADO', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?
```
Parámetros: `[81]`

Resultado:
```json
[]
```

**Paso 12 — VERIFY_ESTADO**

```sql
SELECT TRIM(ESTADO) AS ESTADO FROM JAVIER.PEDIDOS_CAB WHERE ID = ?
```
Parámetros: `[81]`

Resultado:
```json
[
 {
  "ESTADO": "CONFIRMADO"
 }
]
```

**Paso 13 — NEGATIVE_ESTADO_20CHARS**

```sql
UPDATE ... SET ESTADO='PENDIENTE_APROBACION' (20 chars > VARCHAR(12))
```
Parámetros: `[81]`

Resultado:
```json
{
 "CONFIRMADO_BUG": true,
 "error": "[odbc] Error executing the sql statement",
 "odbc": [
  {
   "state": "HY000",
   "code": -404,
   "message": "[IBM][Controlador ODBC de System i Access][DB2 para i5/OS]SQL0404 - Valor para columna o variable ESTADO demasiado largo."
  }
 ]
}
```

**Paso 14 — DELETE_LIN**

```sql
DELETE FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?
```
Parámetros: `[81]`

Resultado:
```json
[]
```

**Paso 15 — DELETE_CAB**

```sql
DELETE FROM JAVIER.PEDIDOS_CAB WHERE ID = ?
```
Parámetros: `[81]`

Resultado:
```json
[]
```

**Paso 16 — VERIFY_DELETE**

```sql
SELECT (SELECT COUNT(*) FROM JAVIER.PEDIDOS_CAB WHERE ID = 81) AS CAB_RESTANTE, (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = 81) AS LIN_RESTANTES, (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN L LEFT JOIN JAVIER.PEDIDOS_CAB C ON L.PEDIDO_ID = C.ID WHERE C.ID IS NULL) AS HUERFANAS_GLOBAL FROM SYSIBM.SYSDUMMY1
```

Resultado:
```json
[
 {
  "CAB_RESTANTE": 0,
  "LIN_RESTANTES": 0,
  "HUERFANAS_GLOBAL": 0
 }
]
```

**Paso 17 — CLEANUP**

```sql
DELETE FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID IN (SELECT ID FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ?); DELETE FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = ?
```
Parámetros: `["ZZTEST9999"]`

Resultado:
```json
"executed"
```

**Paso 18 — VERIFY_ZERO_RESIDUE**

```sql
SELECT (SELECT COUNT(*) FROM JAVIER.PEDIDOS_CAB WHERE TRIM(CODIGOCLIENTE) = 'ZZTEST9999' OR OBSERVACIONES LIKE 'PILAR2 SMOKE%') AS CAB_RESIDUO, (SELECT COUNT(*) FROM JAVIER.PEDIDOS_LIN WHERE TRIM(CODIGOARTICULO) LIKE 'ZZTESTART%') AS LIN_RESIDUO FROM SYSIBM.SYSDUMMY1
```

Resultado:
```json
[
 {
  "CAB_RESIDUO": 0,
  "LIN_RESIDUO": 0
 }
]
```


**Hallazgo del test negativo (paso NEGATIVE_ESTADO_20CHARS):** `UPDATE ... SET ESTADO='PENDIENTE_APROBACION'` (20 caracteres) falla con **SQL0404** ("valor demasiado largo") porque `ESTADO` es `VARCHAR(12)`. El flujo de servicio es correcto (almacena `PEND_APROB`, ≤12), pero el endpoint `/api/pedidos/debug/set-estado` (routes/pedidos.js:1655-1682) pasa el literal sin mapear → BLOQUEO B4 en §9.

---

## 7. Rendimiento: índices y tiempos reales (3 repeticiones por query)

### 7.1 Tiempos medidos (SQL extraído literal del código)

| Query (origen en código) | Repetición 1/2/3 (ms) | Filas | Estado |
|---|---|---|---|
| PEDIDOS getOrders (service 2167, vendor unico + join lineas, ORDER BY ID DESC, 50) | 226 / 231 / 222 | 21 | OK |
| PEDIDOS list-estados (route 1698, vendor, 50) | - | - | ERROR SQL0206 (ver BLOQUEOS) |
| COBROS pendientes CVC por cliente (route 251, 100) | 247 / 241 / 222 | 7 | OK |
| COBROS pending-summary global JEFE_VENTAS (route 769, sin filtro vendedor) | - | - | ERROR SQL0205 (ver BLOQUEOS) |
| BOLSA por vendedor/mes (service 22) | 229 / 224 / 224 | 1 | OK |
| BOLSA historial 12 meses (service 441) | 219 / 223 / 228 | 1 | OK |
| COBROS pending-summary **DDD** (db2-cobros-repository.js:503, query activa) | 1695 / 1545 / 1544 | 7134 | OK |

Contexto de parámetros reales: cliente CVC `4300003663`, vendedor bolsa `80` (2026/06), vendedor pedidos `95`. Latencia base de red/ODBC observada: ~220-250 ms incluso para tablas de ≤21 filas (suelo de conexión, no de plan de acceso).

### 7.2 Volúmenes reales (QSYS2.SYSPARTITIONSTAT)

| Tabla | Filas |
|---|---|
| DSEDAC.CVC | 142.060 |
| DSEDAC.CLI | 14.010 |
| DSEDAC.CLP | 12.093 |
| DSEDAC.CPC | 739.522 |
| DSEDAC.LPC | 2.435.773 |
| DSEDAC.CRC / CRCA | 0 / 0 (estructuras listas, sin datos aún) |
| JAVIER.PEDIDOS_CAB / PEDIDOS_LIN | 21 / 30 |
| JAVIER.BOLSA_COMERCIAL | 15 |
| JAVIER.COBROS / REPARTIDOR_COBROS / MOVIMIENTOS_BOLSA | 0 / 0 / 0 |

### 7.3 Índices existentes sobre columnas de filtro/ordenación (QSYS2.SYSINDEXES + SYSKEYS + SYSPARTITIONINDEXSTAT)

**JAVIER (todas las consultas de las 3 pestañas tienen índice de apoyo):**

| Tabla | Índice | Columnas | Cubre |
|---|---|---|---|
| PEDIDOS_CAB | IDX_PCAB_VND | CODIGOVENDEDOR | filtro vendedor de getOrders/list-estados |
| PEDIDOS_CAB | IDX_PCAB_ESTADO + IDX_PEDIDOS_ESTADO (duplicado) | ESTADO | filtro estado |
| PEDIDOS_CAB | IDX_PCAB_CLI | CODIGOCLIENTE | fallback cobros por cliente |
| PEDIDOS_CAB | PK (ID) | ID | ORDER BY ID DESC / joins |
| PEDIDOS_LIN | IDX_PLIN_PID | PEDIDO_ID | join líneas↔cabecera (GROUP BY PEDIDO_ID) |
| PEDIDOS_LIN | IDX_PLIN_ART | CODIGOARTICULO | búsquedas por artículo |
| COBROS | IDX_COBROS_CLI / IDX_COBROS_IDEM | CODIGO_CLIENTE / IDEMPOTENCY_TOKEN | resta app-side + replay idempotencia |
| REPARTIDOR_COBROS | IDX_REP_COBROS_CLIENTE, IDX_REP_COBROS_DOC, UX_REP_COBROS_TOKEN (único) | cliente / documento / token | resta app-side y dedupe |
| BOLSA_COMERCIAL | UQ_BOLSA_VND_MES (único) + IDX_BOLSA_VND | CODIGOVENDEDOR+EJERCICIO+MES | lookup mensual y histórico |
| MOVIMIENTOS_BOLSA | IDX_MOV_BOLSA, IDX_MOV_PED, UQ_MOV_BOLSA_IDEMP (único) | BOLSA_ID / PEDIDO_ID / IDEMPOTENCY_KEY | listado y dedupe |

**DSEDAC (solo lectura):** `CVC` no tiene índices SQL en `SYSINDEXES`; sus access paths reales son `CVCL1` y la PK (`SYSPARTITIONINDEXSTAT`, 142.060 claves cada uno; las claves de `CVCL1` no se exponen en `QSYS2.SYSKEYS` por ser access path DDS). `CLI` tiene 3 índices SQL; `CLP` access paths `CLPL1` + PK.

### 7.4 Índices ausentes / observaciones de impacto

1. **DSEDAC.CVC sin índice por `CODIGOCLIENTEALBARAN`+`IMPORTEPENDIENTE` visible:** el listado por cliente (240 ms) y el GROUP BY global (1,5 s sobre 142k filas → 7.134 grupos) funcionan, pero el global escanea la tabla. Impacto hoy: aceptable con caché Redis (`TTL.SHORT`, cobros.js:792). Recomendación (NO ejecutada — producción solo lectura): pedir al DBA del ERP un índice `CVC(CODIGOCLIENTEALBARAN, IMPORTEPENDIENTE)` si el resumen global se usa sin caché.
2. **Anti-patrón `TRIM(col) = ?` en los WHERE** (p.ej. `TRIM(C.CODIGOVENDEDOR) = ?`, `TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(...)`): impide el uso directo de índices. Con 21 filas en JAVIER es irrelevante; contra CVC/CPC/LPC (142k-2,4M filas) es el factor dominante del coste. Recomendación de código (equipo backend): comparar contra valores ya padded/trimmed sin función sobre la columna.
3. **IDX_PCAB_ESTADO e IDX_PEDIDOS_ESTADO son duplicados exactos** (ambos ESTADO A) — uno sobra; coste de mantenimiento mínimo, limpieza opcional.

---

## 8. Vistas

1. **El código runtime de las 3 pestañas no usa ninguna vista**: grep de `VW_|VX_|VISTA_` sobre `backend/routes/`, `backend/services/` y `backend/src/` → **0 coincidencias** (las vistas de deuda solo aparecen en scripts utilitarios `backend/scripts/*` y `create_view*.js`).
2. Smoke de validez sobre **las 88 vistas existentes en JAVIER** (`SELECT 1 ... FETCH FIRST 1 ROW ONLY` por vista): **88/88 VÁLIDAS**, 0 errores. Incluye `VISTA_DEUDA_BASE` (2.756 ms). Evidencia: `backend/tmp/db-exploration/pilar2-views-smoke-2026-06-11.json`.
3. Vistas lentas detectadas (artefactos de debug, no usadas por la app): JAVIER.V_DEBUG_1 (34464 ms), JAVIER.V_TEST (34564 ms), JAVIER.VISTA_DEUDA_BASE (2756 ms). Candidatas a borrado posterior (no se tocan hoy).

---

## 9. BLOQUEOS PENDIENTES

> Criterio del encargo: cualquier "No" en ¿Idéntico? es un BLOQUEO. Se consolidan aquí con su DDL exacto y riesgo. Ninguno impide el funcionamiento actual de la app contra JAVIER (integridad 15/15, CRUD OK); condicionan la **migración futura a DSEDAC** y dos endpoints de debug.

### B1 — 256 columnas nullable en JAVIER que en producción son NOT NULL (no aditivo)

- **Tablas:** PEDIDOS_CAB (138), PEDIDOS_LIN (69), COBROS (31), REPARTIDOR_COBROS (18).
- **DDL exacto propuesto:** Apéndice A (768 sentencias: backfill `UPDATE ... WHERE col IS NULL` + `SET DEFAULT` + `SET NOT NULL` por columna, generadas desde el catálogo).
- **Riesgo si se aplica ahora:** reorganización/bloqueo de tabla la noche previa; cualquier INSERT del código que envíe NULL explícito pasaría a fallar (hoy es legal). **Riesgo si NO se aplica antes del cutover a DSEDAC:** filas JAVIER con NULL en esas columnas no serían insertables en CPC/LPC/CRC/CRCA (hoy: 0 filas con NULL problemático según §5, riesgo latente, no actual).
- **Decisión:** NO aplicado. Ventana recomendada: post-presentación, con backup y re-ejecución de §5.

### B2 — Importes JAVIER más anchos que producción (no aditivo, NO aplicar)

- `PEDIDOS_CAB.IMPORTETOTAL/IMPORTECOSTO/IMPORTEMARGEN`: JAVIER `NUMERIC(11,2)` NULL vs CPC `NUMERIC(10,2)` NOT NULL.
- DDL que NO debe ejecutarse tal cual: `ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTETOTAL SET DATA TYPE NUMERIC(10,2)` (estrechamiento = riesgo de pérdida). 
- **Riesgo real:** un pedido con importe > 99.999.999,99 € no cabría en CPC al migrar (máximo actual en JAVIER: 31,50 € — riesgo teórico). Tratar junto a B1 en el plan de cutover.

### B3 — COBROS.ID (VARCHAR(36) UUID) vs CRC.ID (INTEGER identity) — semántico aceptado

- Ya documentado y aceptado en el repo (`ACCEPTED_SEMANTIC_TYPE_MISMATCHES`); el export real usa `CRC.IDMARCALIQUIDACION` con el token truncado a 30 chars (`dsedac-exports.service.js` / `buildCobroInsert` L125: `String(id).slice(0, 30)`).
- **Riesgo residual:** dos tokens distintos que compartan los primeros 30 caracteres colisionarían en la comprobación de idempotencia del export. Con UUIDs v4 la probabilidad es despreciable, pero conviene ampliar `IDMARCALIQUIDACION` o usar hash de 30 chars cuando el ERP lo permita. Sin acción hoy.

### B4 — Endpoint debug `/api/pedidos/debug/set-estado` revienta con SQL0404 (código backend)

- **Evidencia ejecutada:** `UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'PENDIENTE_APROBACION' WHERE ID = ?` → SQL0404 (valor demasiado largo para `VARCHAR(12)`), reproducido en el CRUD de humo (§6).
- **Causa:** routes/pedidos.js:1658 valida `'PENDIENTE_APROBACION'` como entrada y L1671 lo escribe sin mapear por `storedOrderStatus()` (que almacena `'PEND_APROB'`).
- **Fix propuesto (equipo backend, NO aplicado por esta auditoría):** mapear con `storedOrderStatus()` antes del UPDATE, o validar contra el dominio almacenado. Nota adicional: `pedidos.service.js:2844` filtra `ESTADO IN ('BORRADOR','PEND_APROB')` — coherente con el almacenamiento, pero el dominio mixto código/BD merece un único mapa.

### B5 — Endpoint debug `/api/pedidos/debug/list-estados` roto: columna `SERIE` no existe (código backend)

- **Evidencia ejecutada:** la SQL literal de routes/pedidos.js:1699 falla con **SQL0206 "SERIE no encontrada"**. La columna real en `JAVIER.PEDIDOS_CAB` es `SERIEPEDIDO` (catálogo §3; default `'M'`).
- **Fix propuesto:** `SERIE` → `SERIEPEDIDO` (o alias). Ambos B4/B5 están tras `debugMiddleware`, no afectan al flujo comercial normal, pero son demostrables en demo si alguien los toca.

### B6 — Query legacy de `pending-summary` usa `CLI.DESCRIPCIONCLIENTE`, columna inexistente (código backend, riesgo de fallback)

- **Evidencia ejecutada:** la SQL literal de routes/cobros.js:778 falla con **SQL0205** (columna no existe en la tabla). Catálogo: `DSEDAC.CLI` solo tiene `NOMBRECLIENTE` y `NOMBREALTERNATIVO`.
- La query equivalente del módulo DDD (db2-cobros-repository.js:505) usa `NOMBRECLIENTE` y **funciona** (1,5 s, 7.134 filas — medida en §7). `USE_DDD_ROUTES` default `true` (server.js:63), así que la ruta activa es la correcta.
- **Riesgo real:** server.js:628 hace **fallback automático a rutas legacy** (`USE_DDD_ROUTES='false'`) si el arranque DDD falla → el resumen de cobros pendientes de JEFE_VENTAS quedaría roto silenciosamente (solo caché Redis lo taparía temporalmente). **Fix propuesto:** `DESCRIPCIONCLIENTE` → `NOMBRECLIENTE` en la query legacy.

### B7 — Dato ERP: 1.143 vencimientos con cliente vacío y 7,36 M€ pendientes (solo lectura, decisión de producto)

- **Evidencia:** `SELECT COUNT(*), SUM(IMPORTEPENDIENTE) FROM DSEDAC.CVC WHERE TRIM(CODIGOCLIENTEALBARAN)='' AND IMPORTEPENDIENTE<>0 AND (ANULADOSN IS NULL OR ANULADOSN<>'S')` → **N=1.143, TOTAL=7.356.388,92**. Son mayoritariamente serie `O` y aparecen como primeras filas (sin nombre) en el resumen global de Cobros (§7, top-3 del resultado real).
- **Impacto en demo:** la pestaña Cobros en modo JEFE_VENTAS muestra filas con cliente en blanco por importes enormes. DSEDAC es solo lectura: la corrección es de presentación (filtrar/etiquetar `TRIM(CODIGOCLIENTEALBARAN) <> ''` en backend o UI) o de datos en el ERP (fuera de alcance).

### Correcciones ya aplicadas en esta auditoría (no pendientes)

- 3 defaults alineados con producción vía migración aditiva sobre JAVIER (§4.1), re-verificados contra catálogo.

---

## Apéndice A — DDL exacto pendiente (B1): NO EJECUTAR sin ventana planificada

Generado desde el catálogo el 2026-06-11 (`pilar2-render-pending-ddl.js`). 256 columnas en 4 tablas; por columna: backfill, default y NOT NULL.

```sql
-- ============================================================
-- JAVIER.PEDIDOS_CAB (referencia DSEDAC.CPC): 138 columnas NOT NULL pendientes
-- ============================================================
UPDATE JAVIER.PEDIDOS_CAB SET SUBEMPRESAPEDIDO = ' ' WHERE SUBEMPRESAPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESAPEDIDO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESAPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET EJERCICIOPEDIDO = 0 WHERE EJERCICIOPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SERIEPEDIDO = ' ' WHERE SERIEPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIEPEDIDO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIEPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET TERMINALPEDIDO = 0 WHERE TERMINALPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIADOCUMENTO = 0 WHERE DIADOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIADOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIADOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESDOCUMENTO = 0 WHERE MESDOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESDOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESDOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANODOCUMENTO = 0 WHERE ANODOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANODOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANODOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET HORADOCUMENTO = 0 WHERE HORADOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN HORADOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN HORADOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOCLIENTEALBARAN = ' ' WHERE CODIGOCLIENTEALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCLIENTEALBARAN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCLIENTEALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOCLIENTEFACTURA = ' ' WHERE CODIGOCLIENTEFACTURA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCLIENTEFACTURA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCLIENTEFACTURA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOCLIENTECADENA = ' ' WHERE CODIGOCLIENTECADENA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCLIENTECADENA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCLIENTECADENA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOVENDEDORCOBRO = ' ' WHERE CODIGOVENDEDORCOBRO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDORCOBRO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDORCOBRO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOPROMOTORPREVENTA = ' ' WHERE CODIGOPROMOTORPREVENTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOPROMOTORPREVENTA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOPROMOTORPREVENTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOCOMERCIAL = ' ' WHERE CODIGOCOMERCIAL IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCOMERCIAL SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCOMERCIAL SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGORUTA = ' ' WHERE CODIGORUTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGORUTA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGORUTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOFORMAPAGO = ' ' WHERE CODIGOFORMAPAGO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOFORMAPAGO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOFORMAPAGO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOTARIFA = 0 WHERE CODIGOTARIFA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOTARIFA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOTARIFA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOALMACEN = 0 WHERE CODIGOALMACEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOALMACEN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOALMACEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET RECARGOSN = ' ' WHERE RECARGOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN RECARGOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN RECARGOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLEBRUTA1 = 0 WHERE IMPORTEBASEIMPONIBLEBRUTA1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLE1 = 0 WHERE IMPORTEBASEIMPONIBLE1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJEIVA1 = 0 WHERE PORCENTAJEIVA1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEIVA1 = 0 WHERE IMPORTEIVA1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJERECARGO1 = 0 WHERE PORCENTAJERECARGO1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTERECARGO1 = 0 WHERE IMPORTERECARGO1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLEBRUTA2 = 0 WHERE IMPORTEBASEIMPONIBLEBRUTA2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLE2 = 0 WHERE IMPORTEBASEIMPONIBLE2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJEIVA2 = 0 WHERE PORCENTAJEIVA2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEIVA2 = 0 WHERE IMPORTEIVA2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJERECARGO2 = 0 WHERE PORCENTAJERECARGO2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTERECARGO2 = 0 WHERE IMPORTERECARGO2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLEBRUTA3 = 0 WHERE IMPORTEBASEIMPONIBLEBRUTA3 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA3 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA3 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLE3 = 0 WHERE IMPORTEBASEIMPONIBLE3 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE3 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE3 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJEIVA3 = 0 WHERE PORCENTAJEIVA3 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA3 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA3 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEIVA3 = 0 WHERE IMPORTEIVA3 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA3 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA3 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJERECARGO3 = 0 WHERE PORCENTAJERECARGO3 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO3 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO3 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTERECARGO3 = 0 WHERE IMPORTERECARGO3 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO3 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO3 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLEBRUTA4 = 0 WHERE IMPORTEBASEIMPONIBLEBRUTA4 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA4 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA4 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLE4 = 0 WHERE IMPORTEBASEIMPONIBLE4 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE4 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE4 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJEIVA4 = 0 WHERE PORCENTAJEIVA4 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA4 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA4 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEIVA4 = 0 WHERE IMPORTEIVA4 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA4 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA4 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJERECARGO4 = 0 WHERE PORCENTAJERECARGO4 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO4 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO4 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTERECARGO4 = 0 WHERE IMPORTERECARGO4 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO4 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO4 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLEBRUTA5 = 0 WHERE IMPORTEBASEIMPONIBLEBRUTA5 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA5 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLEBRUTA5 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBASEIMPONIBLE5 = 0 WHERE IMPORTEBASEIMPONIBLE5 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE5 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBASEIMPONIBLE5 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJEIVA5 = 0 WHERE PORCENTAJEIVA5 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA5 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEIVA5 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEIVA5 = 0 WHERE IMPORTEIVA5 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA5 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEIVA5 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJERECARGO5 = 0 WHERE PORCENTAJERECARGO5 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO5 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJERECARGO5 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTERECARGO5 = 0 WHERE IMPORTERECARGO5 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO5 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTERECARGO5 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTETOTAL = 0 WHERE IMPORTETOTAL IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTETOTAL SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTETOTAL SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTECOSTO = 0 WHERE IMPORTECOSTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTECOSTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTECOSTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEMARGEN = 0 WHERE IMPORTEMARGEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEMARGEN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEMARGEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJEDESCUENTO1 = 0 WHERE PORCENTAJEDESCUENTO1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEDESCUENTO1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEDESCUENTO1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PORCENTAJEDESCUENTO2 = 0 WHERE PORCENTAJEDESCUENTO2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEDESCUENTO2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PORCENTAJEDESCUENTO2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBRUTO = 0 WHERE IMPORTEBRUTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBRUTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBRUTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEDEVOLUCION = 0 WHERE IMPORTEDEVOLUCION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEDEVOLUCION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEDEVOLUCION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEDESCUENTO1 = 0 WHERE IMPORTEDESCUENTO1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEDESCUENTO1 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEDESCUENTO1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEDESCUENTO2 = 0 WHERE IMPORTEDESCUENTO2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEDESCUENTO2 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEDESCUENTO2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBONIFICACION = 0 WHERE IMPORTEBONIFICACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBONIFICACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBONIFICACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTESINCARGO = 0 WHERE IMPORTESINCARGO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTESINCARGO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTESINCARGO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET EMPRESACONTABLE = ' ' WHERE EMPRESACONTABLE IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EMPRESACONTABLE SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EMPRESACONTABLE SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SITUACIONALBARAN = ' ' WHERE SITUACIONALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SITUACIONALBARAN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SITUACIONALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SUBEMPRESAALBARAN = ' ' WHERE SUBEMPRESAALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESAALBARAN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESAALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET EJERCICIOALBARAN = 0 WHERE EJERCICIOALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOALBARAN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SERIEALBARAN = ' ' WHERE SERIEALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIEALBARAN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIEALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET TERMINALALBARAN = 0 WHERE TERMINALALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALALBARAN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET NUMEROALBARAN = 0 WHERE NUMEROALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROALBARAN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SITUACIONCARGA = ' ' WHERE SITUACIONCARGA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SITUACIONCARGA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SITUACIONCARGA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SUBEMPRESACARGA = ' ' WHERE SUBEMPRESACARGA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESACARGA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESACARGA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET EJERCICIOCARGA = 0 WHERE EJERCICIOCARGA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOCARGA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOCARGA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SERIECARGA = ' ' WHERE SERIECARGA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIECARGA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIECARGA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET TERMINALCARGA = 0 WHERE TERMINALCARGA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALCARGA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALCARGA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET NUMEROCARGA = 0 WHERE NUMEROCARGA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROCARGA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROCARGA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SITUACIONPEDIDO = ' ' WHERE SITUACIONPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SITUACIONPEDIDO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SITUACIONPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOSUBDISTRIBUIDOR = ' ' WHERE CODIGOSUBDISTRIBUIDOR IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOSUBDISTRIBUIDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOSUBDISTRIBUIDOR SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOOPERACION = ' ' WHERE CODIGOOPERACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOOPERACION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOOPERACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET OBSERVACION1 = ' ' WHERE OBSERVACION1 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN OBSERVACION1 SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN OBSERVACION1 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET OBSERVACION2 = ' ' WHERE OBSERVACION2 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN OBSERVACION2 SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN OBSERVACION2 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIACREACION = 0 WHERE DIACREACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIACREACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIACREACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESCREACION = 0 WHERE MESCREACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESCREACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESCREACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANOCREACION = 0 WHERE ANOCREACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOCREACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOCREACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET HORACREACION = 0 WHERE HORACREACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN HORACREACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN HORACREACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET LATITUD = 0 WHERE LATITUD IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN LATITUD SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN LATITUD SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET LONGITUD = 0 WHERE LONGITUD IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN LONGITUD SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN LONGITUD SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET EJERCICIOORDENPREPARACION = 0 WHERE EJERCICIOORDENPREPARACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOORDENPREPARACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOORDENPREPARACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET NUMEROORDENPREPARACION = 0 WHERE NUMEROORDENPREPARACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROORDENPREPARACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROORDENPREPARACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ESTADOORDENPREPARACION = ' ' WHERE ESTADOORDENPREPARACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ESTADOORDENPREPARACION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ESTADOORDENPREPARACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOVENDEDORUSUARIO = ' ' WHERE CODIGOVENDEDORUSUARIO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDORUSUARIO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDORUSUARIO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOVENDEDORPUNTEO = ' ' WHERE CODIGOVENDEDORPUNTEO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDORPUNTEO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOVENDEDORPUNTEO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET EFECTIVOTALON = ' ' WHERE EFECTIVOTALON IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EFECTIVOTALON SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EFECTIVOTALON SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTECOBRADO = 0 WHERE IMPORTECOBRADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTECOBRADO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTECOBRADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEREDONDEO = 0 WHERE IMPORTEREDONDEO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEREDONDEO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEREDONDEO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPORTEBONIFICACIONDIRECTA = 0 WHERE IMPORTEBONIFICACIONDIRECTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBONIFICACIONDIRECTA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPORTEBONIFICACIONDIRECTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IDENTICKETCLIENTE = ' ' WHERE IDENTICKETCLIENTE IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IDENTICKETCLIENTE SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IDENTICKETCLIENTE SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IDENTICKET = ' ' WHERE IDENTICKET IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IDENTICKET SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IDENTICKET SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET LINEASKILOSN = ' ' WHERE LINEASKILOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN LINEASKILOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN LINEASKILOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET PROCESADOSN = ' ' WHERE PROCESADOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PROCESADOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN PROCESADOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET REMOTOSN = ' ' WHERE REMOTOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN REMOTOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN REMOTOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIALLEGADA = 0 WHERE DIALLEGADA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIALLEGADA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIALLEGADA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESLLEGADA = 0 WHERE MESLLEGADA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESLLEGADA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESLLEGADA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANOLLEGADA = 0 WHERE ANOLLEGADA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOLLEGADA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOLLEGADA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET HORALLEGADA = 0 WHERE HORALLEGADA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN HORALLEGADA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN HORALLEGADA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOUSUARIO = ' ' WHERE CODIGOUSUARIO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOUSUARIO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOUSUARIO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIAPRIMERPAGO = 0 WHERE DIAPRIMERPAGO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAPRIMERPAGO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAPRIMERPAGO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESPRIMERPAGO = 0 WHERE MESPRIMERPAGO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESPRIMERPAGO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESPRIMERPAGO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANOPRIMERPAGO = 0 WHERE ANOPRIMERPAGO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOPRIMERPAGO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOPRIMERPAGO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOTIPOPEDIDO = ' ' WHERE CODIGOTIPOPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOTIPOPEDIDO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOTIPOPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET REFERENCIAPEDIDOCLIENTE = ' ' WHERE REFERENCIAPEDIDOCLIENTE IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN REFERENCIAPEDIDOCLIENTE SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN REFERENCIAPEDIDOCLIENTE SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET TRAZABILIDADPEDIDO = ' ' WHERE TRAZABILIDADPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TRAZABILIDADPEDIDO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TRAZABILIDADPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOLOCALIZACIONENTREGA = ' ' WHERE CODIGOLOCALIZACIONENTREGA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOLOCALIZACIONENTREGA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOLOCALIZACIONENTREGA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIASERVICIO = 0 WHERE DIASERVICIO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIASERVICIO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIASERVICIO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESSERVICIO = 0 WHERE MESSERVICIO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESSERVICIO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESSERVICIO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANOSERVICIO = 0 WHERE ANOSERVICIO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOSERVICIO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOSERVICIO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGODELEGACION = ' ' WHERE CODIGODELEGACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGODELEGACION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGODELEGACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ESTADOPRODUCCION = ' ' WHERE ESTADOPRODUCCION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ESTADOPRODUCCION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ESTADOPRODUCCION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ESTADOPRODUCCIONWEB = ' ' WHERE ESTADOPRODUCCIONWEB IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ESTADOPRODUCCIONWEB SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ESTADOPRODUCCIONWEB SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CONFORMADOSN = ' ' WHERE CONFORMADOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CONFORMADOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CONFORMADOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET FACTORCONVERSION = 0 WHERE FACTORCONVERSION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN FACTORCONVERSION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN FACTORCONVERSION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIAESTADO = 0 WHERE DIAESTADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAESTADO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAESTADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESESTADO = 0 WHERE MESESTADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESESTADO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESESTADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANOESTADO = 0 WHERE ANOESTADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOESTADO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOESTADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SUBEMPRESAPROYECTO = ' ' WHERE SUBEMPRESAPROYECTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESAPROYECTO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SUBEMPRESAPROYECTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET EJERCICIOPROYECTO = 0 WHERE EJERCICIOPROYECTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOPROYECTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN EJERCICIOPROYECTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET SERIEPROYECTO = ' ' WHERE SERIEPROYECTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIEPROYECTO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN SERIEPROYECTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET TERMINALPROYECTO = 0 WHERE TERMINALPROYECTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALPROYECTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN TERMINALPROYECTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET NUMEROPROYECTO = 0 WHERE NUMEROPROYECTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROPROYECTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROPROYECTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MATRICULA = ' ' WHERE MATRICULA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MATRICULA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MATRICULA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET IMPRESOSN = ' ' WHERE IMPRESOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPRESOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN IMPRESOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIAIMPRESO = 0 WHERE DIAIMPRESO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAIMPRESO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAIMPRESO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESIMPRESO = 0 WHERE MESIMPRESO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESIMPRESO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESIMPRESO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANOIMPRESO = 0 WHERE ANOIMPRESO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOIMPRESO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOIMPRESO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ENVIADOSN = ' ' WHERE ENVIADOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ENVIADOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ENVIADOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET DIAENVIADO = 0 WHERE DIAENVIADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAENVIADO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN DIAENVIADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MESENVIADO = 0 WHERE MESENVIADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESENVIADO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MESENVIADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET ANOENVIADO = 0 WHERE ANOENVIADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOENVIADO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN ANOENVIADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET NUMEROBULTOS = 0 WHERE NUMEROBULTOS IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROBULTOS SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN NUMEROBULTOS SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET CODIGOCONDUCTOR = ' ' WHERE CODIGOCONDUCTOR IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCONDUCTOR SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN CODIGOCONDUCTOR SET NOT NULL;
UPDATE JAVIER.PEDIDOS_CAB SET MARCAACTUALIZACION = ' ' WHERE MARCAACTUALIZACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MARCAACTUALIZACION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_CAB ALTER COLUMN MARCAACTUALIZACION SET NOT NULL;

-- ============================================================
-- JAVIER.PEDIDOS_LIN (referencia DSEDAC.LPC): 69 columnas NOT NULL pendientes
-- ============================================================
UPDATE JAVIER.PEDIDOS_LIN SET SUBEMPRESAPEDIDO = ' ' WHERE SUBEMPRESAPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SUBEMPRESAPEDIDO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SUBEMPRESAPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET EJERCICIOPEDIDO = 0 WHERE EJERCICIOPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN EJERCICIOPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN EJERCICIOPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET SERIEPEDIDO = ' ' WHERE SERIEPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SERIEPEDIDO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SERIEPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET TERMINALPEDIDO = 0 WHERE TERMINALPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TERMINALPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TERMINALPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET NUMEROPEDIDO = 0 WHERE NUMEROPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN NUMEROPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN NUMEROPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET SECUENCIAPEDIDO = 0 WHERE SECUENCIAPEDIDO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAPEDIDO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAPEDIDO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET DIADOCUMENTO = 0 WHERE DIADOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN DIADOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN DIADOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET MESDOCUMENTO = 0 WHERE MESDOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN MESDOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN MESDOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET ANODOCUMENTO = 0 WHERE ANODOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN ANODOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN ANODOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET HORADOCUMENTO = 0 WHERE HORADOCUMENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN HORADOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN HORADOCUMENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOCLIENTEALBARAN = ' ' WHERE CODIGOCLIENTEALBARAN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCLIENTEALBARAN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCLIENTEALBARAN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOCLIENTEFACTURA = ' ' WHERE CODIGOCLIENTEFACTURA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCLIENTEFACTURA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCLIENTEFACTURA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOCLIENTECADENA = ' ' WHERE CODIGOCLIENTECADENA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCLIENTECADENA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCLIENTECADENA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOVENDEDOR = ' ' WHERE CODIGOVENDEDOR IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOVENDEDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOVENDEDOR SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOVENDEDORCOBRO = ' ' WHERE CODIGOVENDEDORCOBRO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOVENDEDORCOBRO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOVENDEDORCOBRO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOPROMOTORPREVENTA = ' ' WHERE CODIGOPROMOTORPREVENTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOPROMOTORPREVENTA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOPROMOTORPREVENTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOCOMERCIAL = ' ' WHERE CODIGOCOMERCIAL IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCOMERCIAL SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCOMERCIAL SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGORUTA = ' ' WHERE CODIGORUTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGORUTA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGORUTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOFORMAPAGO = ' ' WHERE CODIGOFORMAPAGO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOFORMAPAGO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOFORMAPAGO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOTARIFA = 0 WHERE CODIGOTARIFA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOTARIFA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOTARIFA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOALMACEN = 0 WHERE CODIGOALMACEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOALMACEN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOALMACEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET RECARGOSN = ' ' WHERE RECARGOSN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN RECARGOSN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN RECARGOSN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET TIPOLINEA = ' ' WHERE TIPOLINEA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TIPOLINEA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TIPOLINEA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET TIPOVENTA = ' ' WHERE TIPOVENTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TIPOVENTA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TIPOVENTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CLASELINEA = ' ' WHERE CLASELINEA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CLASELINEA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CLASELINEA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOIVA = ' ' WHERE CODIGOIVA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOIVA SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOIVA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET DESCRIPCION = ' ' WHERE DESCRIPCION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN DESCRIPCION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN DESCRIPCION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CANTIDADENVASES = 0 WHERE CANTIDADENVASES IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADENVASES SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADENVASES SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CANTIDADUNIDADES = 0 WHERE CANTIDADUNIDADES IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADUNIDADES SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADUNIDADES SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET PRECIOVENTA = 0 WHERE PRECIOVENTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOVENTA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOVENTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET PORCENTAJEDESCUENTO = 0 WHERE PORCENTAJEDESCUENTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PORCENTAJEDESCUENTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PORCENTAJEDESCUENTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET IMPORTEDESCUENTOUNIDAD = 0 WHERE IMPORTEDESCUENTOUNIDAD IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTEDESCUENTOUNIDAD SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTEDESCUENTOUNIDAD SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET IMPORTEVENTA = 0 WHERE IMPORTEVENTA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTEVENTA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTEVENTA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET PRECIOCOSTO = 0 WHERE PRECIOCOSTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOCOSTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOCOSTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET IMPORTECOSTO = 0 WHERE IMPORTECOSTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTECOSTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTECOSTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CANTIDADENVASESSERVIDOS = 0 WHERE CANTIDADENVASESSERVIDOS IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADENVASESSERVIDOS SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADENVASESSERVIDOS SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CANTIDADUNIDADESSERVIDAS = 0 WHERE CANTIDADUNIDADESSERVIDAS IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADUNIDADESSERVIDAS SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADUNIDADESSERVIDAS SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOLOTE = ' ' WHERE CODIGOLOTE IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOLOTE SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOLOTE SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CANTIDADENVASESPICADOS = 0 WHERE CANTIDADENVASESPICADOS IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADENVASESPICADOS SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADENVASESPICADOS SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CANTIDADUNIDADESPICADAS = 0 WHERE CANTIDADUNIDADESPICADAS IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADUNIDADESPICADAS SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADUNIDADESPICADAS SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGODESTRUCCIONPRODUCTO = ' ' WHERE CODIGODESTRUCCIONPRODUCTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGODESTRUCCIONPRODUCTO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGODESTRUCCIONPRODUCTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET VALORDESTRUCCIONPRODUCTO = 0 WHERE VALORDESTRUCCIONPRODUCTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN VALORDESTRUCCIONPRODUCTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN VALORDESTRUCCIONPRODUCTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET PRECIOKILOS = ' ' WHERE PRECIOKILOS IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOKILOS SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOKILOS SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET IMPORTEDESTRUCCIONPRODUCTO = 0 WHERE IMPORTEDESTRUCCIONPRODUCTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTEDESTRUCCIONPRODUCTO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN IMPORTEDESTRUCCIONPRODUCTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOPROMOCIONREGALO = ' ' WHERE CODIGOPROMOCIONREGALO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOPROMOCIONREGALO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOPROMOCIONREGALO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET SECUENCIAPROMOCIONREGALO = 0 WHERE SECUENCIAPROMOCIONREGALO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAPROMOCIONREGALO SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAPROMOCIONREGALO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CAJASUNIDADES = ' ' WHERE CAJASUNIDADES IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CAJASUNIDADES SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CAJASUNIDADES SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET PRECIOTARIFACLIENTE = 0 WHERE PRECIOTARIFACLIENTE IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOTARIFACLIENTE SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOTARIFACLIENTE SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET PRECIOTARIFA01 = 0 WHERE PRECIOTARIFA01 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOTARIFA01 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PRECIOTARIFA01 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET ORDENPREPARACION = 0 WHERE ORDENPREPARACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN ORDENPREPARACION SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN ORDENPREPARACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET PORCENTAJEDESCUENTO02 = 0 WHERE PORCENTAJEDESCUENTO02 IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PORCENTAJEDESCUENTO02 SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN PORCENTAJEDESCUENTO02 SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOCONCEPTOFACTURACION = ' ' WHERE CODIGOCONCEPTOFACTURACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCONCEPTOFACTURACION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOCONCEPTOFACTURACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET NUMEROPROYECTO = ' ' WHERE NUMEROPROYECTO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN NUMEROPROYECTO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN NUMEROPROYECTO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOPROVEEDOR = ' ' WHERE CODIGOPROVEEDOR IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOPROVEEDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOPROVEEDOR SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET UNIDADESPEDIRPROVEEDOR = 0 WHERE UNIDADESPEDIRPROVEEDOR IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN UNIDADESPEDIRPROVEEDOR SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN UNIDADESPEDIRPROVEEDOR SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOESTADOPROVEEDOR = ' ' WHERE CODIGOESTADOPROVEEDOR IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOESTADOPROVEEDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOESTADOPROVEEDOR SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET SUBEMPRESAORIGEN = ' ' WHERE SUBEMPRESAORIGEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SUBEMPRESAORIGEN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SUBEMPRESAORIGEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET EJERCICIOORIGEN = 0 WHERE EJERCICIOORIGEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN EJERCICIOORIGEN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN EJERCICIOORIGEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET SERIEORIGEN = ' ' WHERE SERIEORIGEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SERIEORIGEN SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SERIEORIGEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET TERMINALORIGEN = 0 WHERE TERMINALORIGEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TERMINALORIGEN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN TERMINALORIGEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET NUMEROORIGEN = 0 WHERE NUMEROORIGEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN NUMEROORIGEN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN NUMEROORIGEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET SECUENCIAORIGEN = 0 WHERE SECUENCIAORIGEN IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAORIGEN SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAORIGEN SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOFASE = ' ' WHERE CODIGOFASE IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOFASE SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOFASE SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOOPERACION = ' ' WHERE CODIGOOPERACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOOPERACION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOOPERACION SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET SECUENCIAMANOOBRA = 0 WHERE SECUENCIAMANOOBRA IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAMANOOBRA SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN SECUENCIAMANOOBRA SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOKIT = ' ' WHERE CODIGOKIT IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOKIT SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOKIT SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CANTIDADPALES = 0 WHERE CANTIDADPALES IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADPALES SET DEFAULT 0;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CANTIDADPALES SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET CODIGOESTADO = ' ' WHERE CODIGOESTADO IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOESTADO SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN CODIGOESTADO SET NOT NULL;
UPDATE JAVIER.PEDIDOS_LIN SET MARCAACTUALIZACION = ' ' WHERE MARCAACTUALIZACION IS NULL;
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN MARCAACTUALIZACION SET DEFAULT ' ';
ALTER TABLE JAVIER.PEDIDOS_LIN ALTER COLUMN MARCAACTUALIZACION SET NOT NULL;

-- ============================================================
-- JAVIER.COBROS (referencia DSEDAC.CRC): 31 columnas NOT NULL pendientes
-- ============================================================
UPDATE JAVIER.COBROS SET SUBEMPRESARECIBO = ' ' WHERE SUBEMPRESARECIBO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN SUBEMPRESARECIBO SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN SUBEMPRESARECIBO SET NOT NULL;
UPDATE JAVIER.COBROS SET EJERCICIORECIBO = 0 WHERE EJERCICIORECIBO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN EJERCICIORECIBO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN EJERCICIORECIBO SET NOT NULL;
UPDATE JAVIER.COBROS SET SERIERECIBO = ' ' WHERE SERIERECIBO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN SERIERECIBO SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN SERIERECIBO SET NOT NULL;
UPDATE JAVIER.COBROS SET TERMINALRECIBO = 0 WHERE TERMINALRECIBO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN TERMINALRECIBO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN TERMINALRECIBO SET NOT NULL;
UPDATE JAVIER.COBROS SET NUMERORECIBO = 0 WHERE NUMERORECIBO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN NUMERORECIBO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN NUMERORECIBO SET NOT NULL;
UPDATE JAVIER.COBROS SET CODIGOCLIENTEFACTURA = ' ' WHERE CODIGOCLIENTEFACTURA IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOCLIENTEFACTURA SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOCLIENTEFACTURA SET NOT NULL;
UPDATE JAVIER.COBROS SET CODIGOSUBDISTRIBUIDOR = ' ' WHERE CODIGOSUBDISTRIBUIDOR IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOSUBDISTRIBUIDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOSUBDISTRIBUIDOR SET NOT NULL;
UPDATE JAVIER.COBROS SET CODIGOVENDEDOR = ' ' WHERE CODIGOVENDEDOR IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOVENDEDOR SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOVENDEDOR SET NOT NULL;
UPDATE JAVIER.COBROS SET TIPORECIBO = ' ' WHERE TIPORECIBO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN TIPORECIBO SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN TIPORECIBO SET NOT NULL;
UPDATE JAVIER.COBROS SET DIADOCUMENTO = 0 WHERE DIADOCUMENTO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN DIADOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN DIADOCUMENTO SET NOT NULL;
UPDATE JAVIER.COBROS SET MESDOCUMENTO = 0 WHERE MESDOCUMENTO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN MESDOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN MESDOCUMENTO SET NOT NULL;
UPDATE JAVIER.COBROS SET ANODOCUMENTO = 0 WHERE ANODOCUMENTO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN ANODOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN ANODOCUMENTO SET NOT NULL;
UPDATE JAVIER.COBROS SET HORADOCUMENTO = 0 WHERE HORADOCUMENTO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN HORADOCUMENTO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN HORADOCUMENTO SET NOT NULL;
UPDATE JAVIER.COBROS SET IMPORTECOBRADO = 0 WHERE IMPORTECOBRADO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN IMPORTECOBRADO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN IMPORTECOBRADO SET NOT NULL;
UPDATE JAVIER.COBROS SET IMPORTEREDONDEO = 0 WHERE IMPORTEREDONDEO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN IMPORTEREDONDEO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN IMPORTEREDONDEO SET NOT NULL;
UPDATE JAVIER.COBROS SET EFECTIVOTALON = ' ' WHERE EFECTIVOTALON IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN EFECTIVOTALON SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN EFECTIVOTALON SET NOT NULL;
UPDATE JAVIER.COBROS SET NUMEROTALON = ' ' WHERE NUMEROTALON IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN NUMEROTALON SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN NUMEROTALON SET NOT NULL;
UPDATE JAVIER.COBROS SET DIAVENCIMIENTO = 0 WHERE DIAVENCIMIENTO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN DIAVENCIMIENTO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN DIAVENCIMIENTO SET NOT NULL;
UPDATE JAVIER.COBROS SET MESVENCIMIENTO = 0 WHERE MESVENCIMIENTO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN MESVENCIMIENTO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN MESVENCIMIENTO SET NOT NULL;
UPDATE JAVIER.COBROS SET ANOVENCIMIENTO = 0 WHERE ANOVENCIMIENTO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN ANOVENCIMIENTO SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN ANOVENCIMIENTO SET NOT NULL;
UPDATE JAVIER.COBROS SET CODIGOENTIDADBANCARIA = ' ' WHERE CODIGOENTIDADBANCARIA IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOENTIDADBANCARIA SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOENTIDADBANCARIA SET NOT NULL;
UPDATE JAVIER.COBROS SET OFICINIEXTERIOR = ' ' WHERE OFICINIEXTERIOR IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN OFICINIEXTERIOR SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN OFICINIEXTERIOR SET NOT NULL;
UPDATE JAVIER.COBROS SET CODIGOVENDEDORUSUARIO = ' ' WHERE CODIGOVENDEDORUSUARIO IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOVENDEDORUSUARIO SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN CODIGOVENDEDORUSUARIO SET NOT NULL;
UPDATE JAVIER.COBROS SET SUBEMPRESALIQUIDACION = ' ' WHERE SUBEMPRESALIQUIDACION IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN SUBEMPRESALIQUIDACION SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN SUBEMPRESALIQUIDACION SET NOT NULL;
UPDATE JAVIER.COBROS SET EJERCICIOLIQUIDACION = 0 WHERE EJERCICIOLIQUIDACION IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN EJERCICIOLIQUIDACION SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN EJERCICIOLIQUIDACION SET NOT NULL;
UPDATE JAVIER.COBROS SET SERIELIQUIDACION = ' ' WHERE SERIELIQUIDACION IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN SERIELIQUIDACION SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN SERIELIQUIDACION SET NOT NULL;
UPDATE JAVIER.COBROS SET TERMINALLIQUIDACION = 0 WHERE TERMINALLIQUIDACION IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN TERMINALLIQUIDACION SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN TERMINALLIQUIDACION SET NOT NULL;
UPDATE JAVIER.COBROS SET NUMEROLIQUIDACION = 0 WHERE NUMEROLIQUIDACION IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN NUMEROLIQUIDACION SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN NUMEROLIQUIDACION SET NOT NULL;
UPDATE JAVIER.COBROS SET IDMARCALIQUIDACION = ' ' WHERE IDMARCALIQUIDACION IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN IDMARCALIQUIDACION SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN IDMARCALIQUIDACION SET NOT NULL;
UPDATE JAVIER.COBROS SET ID = 0 WHERE ID IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN ID SET DEFAULT 0;
ALTER TABLE JAVIER.COBROS ALTER COLUMN ID SET NOT NULL;
UPDATE JAVIER.COBROS SET MARCAACTUALIZACION = ' ' WHERE MARCAACTUALIZACION IS NULL;
ALTER TABLE JAVIER.COBROS ALTER COLUMN MARCAACTUALIZACION SET DEFAULT ' ';
ALTER TABLE JAVIER.COBROS ALTER COLUMN MARCAACTUALIZACION SET NOT NULL;

-- ============================================================
-- JAVIER.REPARTIDOR_COBROS (referencia DSEDAC.CRCA): 18 columnas NOT NULL pendientes
-- ============================================================
UPDATE JAVIER.REPARTIDOR_COBROS SET SUBEMPRESAREGISTRO = ' ' WHERE SUBEMPRESAREGISTRO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN SUBEMPRESAREGISTRO SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN SUBEMPRESAREGISTRO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET EJERCICIOREGISTRO = 0 WHERE EJERCICIOREGISTRO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN EJERCICIOREGISTRO SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN EJERCICIOREGISTRO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET SERIEREGISTRO = ' ' WHERE SERIEREGISTRO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN SERIEREGISTRO SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN SERIEREGISTRO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET TERMINALREGISTRO = 0 WHERE TERMINALREGISTRO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN TERMINALREGISTRO SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN TERMINALREGISTRO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET NUMEROREGISTRO = 0 WHERE NUMEROREGISTRO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN NUMEROREGISTRO SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN NUMEROREGISTRO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET NUMEROREGISTROORIGINAL = 0 WHERE NUMEROREGISTROORIGINAL IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN NUMEROREGISTROORIGINAL SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN NUMEROREGISTROORIGINAL SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET CUENTACOBRADO = ' ' WHERE CUENTACOBRADO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CUENTACOBRADO SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CUENTACOBRADO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET CUENTATALONES = ' ' WHERE CUENTATALONES IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CUENTATALONES SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CUENTATALONES SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET CUENTADESCUENTO = ' ' WHERE CUENTADESCUENTO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CUENTADESCUENTO SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CUENTADESCUENTO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET IMPORTETOTALCOBRADO = 0 WHERE IMPORTETOTALCOBRADO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALCOBRADO SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALCOBRADO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET IMPORTETOTALTALONES = 0 WHERE IMPORTETOTALTALONES IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALTALONES SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALTALONES SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET IMPORTETOTALOTROS = 0 WHERE IMPORTETOTALOTROS IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALOTROS SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALOTROS SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET IMPORTETOTALDESCUENTO = 0 WHERE IMPORTETOTALDESCUENTO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALDESCUENTO SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALDESCUENTO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET IMPORTETOTALPENDIENTE = 0 WHERE IMPORTETOTALPENDIENTE IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALPENDIENTE SET DEFAULT 0;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN IMPORTETOTALPENDIENTE SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET EXTENSIONCONCEPTO = ' ' WHERE EXTENSIONCONCEPTO IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN EXTENSIONCONCEPTO SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN EXTENSIONCONCEPTO SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET CODIGOCONCEPTOCONTRAPARTIDA = ' ' WHERE CODIGOCONCEPTOCONTRAPARTIDA IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CODIGOCONCEPTOCONTRAPARTIDA SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN CODIGOCONCEPTOCONTRAPARTIDA SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET DESCCONCEPTOCONTRAPARTIDA = ' ' WHERE DESCCONCEPTOCONTRAPARTIDA IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN DESCCONCEPTOCONTRAPARTIDA SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN DESCCONCEPTOCONTRAPARTIDA SET NOT NULL;
UPDATE JAVIER.REPARTIDOR_COBROS SET EXTCONCEPTOCONTRAPARTIDA = ' ' WHERE EXTCONCEPTOCONTRAPARTIDA IS NULL;
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN EXTCONCEPTOCONTRAPARTIDA SET DEFAULT ' ';
ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN EXTCONCEPTOCONTRAPARTIDA SET NOT NULL;
```

## Apéndice B — Artefactos de evidencia

| Artefacto | Ruta |
|---|---|
| Catálogo completo (columnas/constraints/índices/triggers) | backend/tmp/db-exploration/pilar2-catalog-2026-06-11.json |
| Comparativa renderizada | backend/tmp/db-exploration/pilar2-comparison-2026-06-11.md |
| Integridad (SQL + counts + muestras) | backend/tmp/db-exploration/pilar2-integrity-2026-06-11.json |
| CRUD de humo paso a paso | backend/tmp/db-exploration/pilar2-crud-smoke-2026-06-11.json |
| Rendimiento + índices + volúmenes | backend/tmp/db-exploration/pilar2-perf-2026-06-11.json |
| Smoke de vistas (88) | backend/tmp/db-exploration/pilar2-views-smoke-2026-06-11.json |
| Migración aditiva aplicada (.sql/.json con before/after) | backend/scripts/sql/migrations/2026-06-11T21-33-30-660Z_align_javier_defaults_additive.* |
| DDL pendiente B1 (copia cruda) | backend/tmp/db-exploration/pilar2-pending-ddl-2026-06-11.sql |

---

## Adenda: mapeo IVA real (seguimiento 2026-06-12, 00:36)

**Motivo:** la auditoría Flutter detectó dos mapeos contradictorios de código de IVA en la app (un provider: 1→10%; la ficha de producto: 1→21%). Verificación 100% solo lectura contra DSEDAC para fijar el mapeo REAL antes de la demo.

### A.1 Fuente de verdad localizada en el catálogo

\`\`\`sql
SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_TEXT
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA='DSEDAC'
  AND (TABLE_NAME LIKE '%IVA%' OR TABLE_NAME LIKE 'TIV%' OR TABLE_NAME LIKE '%IMPU%'
       OR UPPER(TABLE_TEXT) LIKE '%IVA%' OR UPPER(TABLE_TEXT) LIKE '%IMPUESTO%')
\`\`\`

→ Existe tabla maestra **\`DSEDAC.IVA\`** ("I.V.A.", + lógico \`IVAL1\`) con columnas (SYSCOLUMNS): \`IVA CHAR(1)\` (código), \`PORCENTAJEIVA NUMERIC(5,2)\`, \`PORCENTAJERECARGO NUMERIC(6,3)\`, \`CLAVECONTABLE CHAR(2)\`, \`DESCRIPCIONIVA CHAR(40)\`.

Columnas de IVA en tablas operativas (SYSCOLUMNS, todas \`CHAR(1)\`): \`ART.CODIGOIVA\`, \`LPC.CODIGOIVA\`, \`LAC.CODIGOIVA\`, \`LFC.CODIGOIVA\` (+ \`LFC.PORCENTAJEIVA\` y \`LFC.IMPORTEIVA\` por línea; \`CFC/CPC\` llevan slots \`PORCENTAJEIVA1..5\`/\`IMPORTEIVA1..5\` en cabecera).

### A.2 La tabla maestra DSEDAC.IVA está DESACTUALIZADA (no usar sus %)

\`\`\`sql
SELECT IVA, PORCENTAJEIVA, PORCENTAJERECARGO, TRIM(CLAVECONTABLE) AS CLAVE, TRIM(DESCRIPCIONIVA) AS DESCRIPCION
FROM DSEDAC.IVA ORDER BY IVA
\`\`\`

| IVA | PORCENTAJEIVA | PORCENTAJERECARGO | DESCRIPCION |
|---|---|---|---|
| '' | 0 | 0 | |
| 1 | **7** | 1 | "Descripción IVA 1" (placeholder) |
| 2 | **16** | 4 | |
| 3 | 4 | 0,5 | |
| 4 | 0 | 0 | |
| 5 | 7 | 0 | |

7%/16% son tipos españoles anteriores a 2010: el maestro no se mantiene. **La fuente operativa real es el % aplicado línea a línea en facturas (\`LFC.PORCENTAJEIVA\`)**, contrastado además por ratio importe/base.

### A.3 Dominio real aplicado en facturas (LFC), ejercicios 2025-2026

\`\`\`sql
SELECT CODIGO, PCT, COUNT(*) AS N_LINEAS, MIN(EJ) AS DESDE, MAX(EJ) AS HASTA
FROM (SELECT TRIM(CODIGOIVA) AS CODIGO, PORCENTAJEIVA AS PCT, EJERCICIOFACTURA AS EJ
        FROM DSEDAC.LFC WHERE EJERCICIOFACTURA >= 2025) T
GROUP BY CODIGO, PCT ORDER BY CODIGO, PCT
\`\`\`

| CODIGOIVA | % aplicado | Nº líneas | Ejercicios |
|---|---|---|---|
| 1 | **10** | 41.166 | 2025-2026 |
| 1 | 0 | 6 (residuales) | solo 2025 |
| 2 | **21** | 927 | 2025-2026 |
| 3 | **4** | 14.390 | 2025-2026 |
| 3 | 0 | 1 (residual) | solo 2025 |
| 4 | **0** | 48 | 2025-2026 |
| 5 | **10** | 2.897 | 2025-2026 |

Solo ejercicio 2026 (dominio limpio, un único % por código, cero excepciones):

\`\`\`sql
SELECT CODIGO, PCT, COUNT(*) AS N_LINEAS
FROM (SELECT TRIM(CODIGOIVA) AS CODIGO, PORCENTAJEIVA AS PCT FROM DSEDAC.LFC WHERE EJERCICIOFACTURA = 2026) T
GROUP BY CODIGO, PCT ORDER BY CODIGO, PCT
\`\`\`

| CODIGOIVA | % | N_LINEAS (2026) |
|---|---|---|
| 1 | 10 | 12.328 |
| 2 | 21 | 260 |
| 3 | 4 | 4.473 |
| 4 | 0 | 3 |
| 5 | 10 | 674 |

### A.4 Verificación independiente por ratio importe_iva / base (no usa el campo %)

\`\`\`sql
SELECT CODIGO, ROUND(SUM(IVA) * 100.0 / SUM(BASE), 2) AS PCT_CALCULADO,
       ROUND(SUM(BASE),2) AS SUM_BASE, ROUND(SUM(IVA),2) AS SUM_IVA, COUNT(*) AS N
FROM (SELECT TRIM(CODIGOIVA) AS CODIGO, IMPORTEBASEIMPONIBLE AS BASE, IMPORTEIVA AS IVA
        FROM DSEDAC.LFC WHERE EJERCICIOFACTURA >= 2025 AND IMPORTEBASEIMPONIBLE <> 0) T
GROUP BY CODIGO ORDER BY CODIGO
\`\`\`

| CODIGOIVA | % calculado | SUM_BASE (€) | SUM_IVA (€) | N líneas |
|---|---|---|---|---|
| 1 | **10,00** | 18.685.275,51 | 1.868.545,03 | 39.304 |
| 2 | **21,00** | 782.965,76 | 164.423,02 | 870 |
| 3 | 3,90 (≈4; arrastra las líneas residuales a 0% de 2025 y redondeos de bases pequeñas) | 2.513.160,13 | 100.519,53 | 14.134 |
| 4 | 0,00 | 102.080,20 | 0,00 | 45 |
| 5 | **10,00** | 322.157,62 | 32.217,99 | 2.873 |

Filas de ejemplo (código 1, ejercicio 2026, \`IMPORTEBASEIMPONIBLE > 10\`):

| EJERCICIO | CODIGO | BASE | PCT_LINEA | IVA | RATIO calculado |
|---|---|---|---|---|---|
| 2026 | 1 | 237,12 | 10 | 23,71 | 10,00 |
| 2026 | 1 | 682,47 | 10 | 68,25 | 10,00 |
| 2026 | 1 | 14,23 | 10 | 1,42 | 9,98 (céntimos) |
| 2026 | 1 | 294,40 | 10 | 29,44 | 10,00 |
| 2026 | 1 | 78,13 | 10 | 7,81 | 10,00 |

### A.5 Distribución del código IVA en el maestro de artículos (contexto de impacto)

\`\`\`sql
SELECT CODIGO, COUNT(*) AS N_ARTICULOS_ACTIVOS
FROM (SELECT TRIM(CODIGOIVA) AS CODIGO FROM DSEDAC.ART WHERE ANOBAJA = 0) T
GROUP BY CODIGO ORDER BY N_ARTICULOS_ACTIVOS DESC
\`\`\`

| CODIGOIVA | Artículos activos |
|---|---|
| 1 | **2.734** |
| 3 | 320 |
| 2 | 78 |
| '' | 11 |
| 5 | 9 |

El código 1 cubre el 87% del catálogo activo: el error de mapeo afecta a la inmensa mayoría de productos mostrados.

### A.6 Tabla final código→% real y VEREDICTO

| Código IVA | % REAL (operativo 2025-2026) | Evidencia |
|---|---|---|
| 1 | **10%** | 41.166 líneas LFC + ratio 10,00% sobre 18,7 M€ de base |
| 2 | **21%** | 927 líneas + ratio 21,00% |
| 3 | **4%** | 14.390 líneas + ratio ≈4% |
| 4 | **0%** (exento) | 48 líneas, IVA acumulado 0,00 € |
| 5 | **10%** | 2.897 líneas + ratio 10,00% |
| '' (vacío) | 0% | maestro IVA fila vacía; 11 artículos activos sin código |

**VEREDICTO:** el mapeo correcto es **1→10%** (el del provider). El mapeo de la ficha de producto (**1→21%**) es **INCORRECTO**: con 21% solo factura el código 2 (78 artículos activos). Además, **ningún mapeo debe leer los % del maestro \`DSEDAC.IVA\`** (desactualizado: 7%/16%, tipos pre-2010); si se quiere una fuente dinámica, debe derivarse de \`LFC.PORCENTAJEIVA\` o corregirse el maestro en el ERP (fuera de alcance, producción solo lectura).

**Acción para el equipo Flutter:** unificar el mapeo a {1:10, 2:21, 3:4, 4:0, 5:10} y corregir la ficha de producto. Cero escrituras realizadas en esta adenda (ni en JAVIER ni en DSEDAC).
