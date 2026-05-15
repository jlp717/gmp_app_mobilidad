# Mapeo exacto de columnas JAVIER ↔ DSEDAC

Fecha: 2026-05-15
Fuente: `backend/scripts/erp_diff_condensed.js` ejecutado contra producción

> **Regla**: cuando `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` la app escribe en las tablas DSEDAC. Cuando es `JAVIER` la app escribe en JAVIER. Para que esto funcione sin código condicional, **JAVIER debe tener exactamente las mismas columnas que DSEDAC** (los nombres de tabla pueden diferir).
>
> **Excepción única**: `BOLSA_COMERCIAL` y `MOVIMIENTOS_BOLSA` viven SIEMPRE en JAVIER. No tienen contrapartida en DSEDAC y no se sincronizan.

---

## Resumen de paridad estructural

| Tabla JAVIER | Tabla DSEDAC | JV cols | DS cols | Match | Solo JV | Solo DS | Estado | Migración necesaria |
|--------------|--------------|--------:|--------:|------:|--------:|--------:|--------|---------------------|
| `PEDIDOS_CAB` | `CPC` | 46 | 140 | 14 | 32 | 126 | ⚠️ Falta paridad | **027** (incluida en este repo) |
| `PEDIDOS_LIN` | `LPC` | 25 | 71 | 13 | 12 | 58 | ⚠️ Falta paridad | 028 (pendiente) |
| `COBROS` | `CRC` | 13 | 31 | 1 | 12 | 30 | ⚠️ Modelos divergentes | 029 (pendiente) |
| `REPARTIDOR_COBROS` | `CRCA` | 112 | 28 | 10 | 102 | 18 | ⚠️ JAVIER tiene más cols (modelo más rico) | Revisión arquitectónica |
| `REPARTIDOR_LIQUIDACION_OPS` | `CLV` | 38 | 13 | 6 | 32 | 7 | ⚠️ CLV = líneas por concepto, JV = fila por liquidación | Decisión modelo |
| `LQD_LIQUIDACIONES` | `CLV` | 20 | 13 | 1 | 19 | 12 | ⚠️ Misma divergencia que anterior | Decisión modelo |
| `REPARTIDOR_ENTREGAS` | `CAC` | 50 | 183 | 7 | 43 | 176 | ⚠️ JAVIER es modelo "preparación", CAC es albarán | Decisión modelo |
| `REPARTIDOR_ENTREGA_LINEAS` | `LAC` | 132 | 126 | **126** | 6 | 0 | ✅ **Mirror perfecto** | Ninguna |
| `BOLSA_COMERCIAL` | — | — | — | — | — | — | ✅ Por diseño solo JAVIER | Ninguna |
| `MOVIMIENTOS_BOLSA` | — | — | — | — | — | — | ✅ Por diseño solo JAVIER | Ninguna |

---

## Tablas que el código LEE de DSEDAC (read-only, siempre desde DSEDAC en ambos entornos)

- `DSEDAC.CLI` / `CLC` / `CLP` / `CLX` — clientes y datos comerciales
- `DSEDAC.ART` / `ARTX` / `ARO` / `ARA` / `FAM` — catálogo productos, stock, tarifas, familias
- `DSEDAC.CAC` / `LAC` — albaranes ERP existentes
- `DSEDAC.CFC` / `LFC` — facturas ERP existentes
- `DSEDAC.CVC` / `CVL` — vencimientos y deuda viva
- `DSEDAC.CPC` / `LPC` / `OCPC` — pedidos ERP existentes (cuando ya estaban antes de la app)
- `DSEDAC.VEH` / `VDD` / `OPP` / `CRUT` / `AVR` — vehículos, vendedores, rutas
- `DSEDAC.PMR` — promociones (auto-detectada por código)
- `DSEDAC.TRF` — tarifas

---

## Detalle por par crítico

### 1. PEDIDOS_CAB ↔ CPC

**Columnas que faltan en JAVIER y la migración 027 añade:**

```
SUBEMPRESAPEDIDO, EJERCICIOPEDIDO, TERMINALPEDIDO,
CODIGOCLIENTEALBARAN, CODIGOCLIENTEFACTURA, CODIGOCLIENTECADENA,
CODIGOVENDEDORCOBRO, CODIGOPROMOTORPREVENTA, CODIGOCOMERCIAL,
CODIGORUTA, RECARGOSN,
IMPORTEBASEIMPONIBLEBRUTA1..5, IMPORTEBASEIMPONIBLE1..5,
PORCENTAJEIVA1..5, IMPORTEIVA1..5,
PORCENTAJERECARGO1..5, IMPORTERECARGO1..5,
PORCENTAJEDESCUENTO1, PORCENTAJEDESCUENTO2,
IMPORTEBRUTO, IMPORTEDEVOLUCION,
IMPORTEDESCUENTO1, IMPORTEDESCUENTO2,
IMPORTEBONIFICACION, IMPORTEBONIFICACIONDIRECTA,
IMPORTESINCARGO, EMPRESACONTABLE, SITUACIONALBARAN,
SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN,
TERMINALALBARAN, NUMEROALBARAN,
SITUACIONCARGA, SUBEMPRESACARGA, EJERCICIOCARGA,
SERIECARGA, TERMINALCARGA, NUMEROCARGA,
SITUACIONPEDIDO, CODIGOSUBDISTRIBUIDOR, CODIGOOPERACION,
OBSERVACION1, OBSERVACION2,
DIACREACION, MESCREACION, ANOCREACION, HORACREACION,
LATITUD, LONGITUD,
EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION, ESTADOORDENPREPARACION,
CODIGOVENDEDORUSUARIO, CODIGOVENDEDORPUNTEO,
EFECTIVOTALON, IMPORTECOBRADO, IMPORTEREDONDEO,
IDENTICKETCLIENTE, IDENTICKET,
LINEASKILOSN, PROCESADOSN, REMOTOSN,
DIALLEGADA, MESLLEGADA, ANOLLEGADA, HORALLEGADA,
CODIGOUSUARIO, DIAPRIMERPAGO, MESPRIMERPAGO, ANOPRIMERPAGO,
CODIGOTIPOPEDIDO, REFERENCIAPEDIDOCLIENTE, TRAZABILIDADPEDIDO,
CODIGOLOCALIZACIONENTREGA,
DIASERVICIO, MESSERVICIO, ANOSERVICIO, CODIGODELEGACION,
ESTADOPRODUCCION, ESTADOPRODUCCIONWEB, CONFORMADOSN, FACTORCONVERSION,
DIAESTADO, MESESTADO, ANOESTADO,
SUBEMPRESAPROYECTO, EJERCICIOPROYECTO, SERIEPROYECTO,
TERMINALPROYECTO, NUMEROPROYECTO, MATRICULA,
IMPRESOSN, DIAIMPRESO, MESIMPRESO, ANOIMPRESO,
ENVIADOSN, DIAENVIADO, MESENVIADO, ANOENVIADO,
NUMEROBULTOS, MARCAACTUALIZACION
```

**Columnas que JAVIER tiene de más (metadata local, se mantienen):**

```
SUBEMPRESA, EJERCICIO, TERMINAL,           ← alias de SUBEMPRESAPEDIDO, etc.
CODIGOCLIENTE, NOMBRECLIENTE, TIPOVENTA,   ← redundantes pero útiles para queries rápidas
ESTADO, OBSERVACIONES, CREATED_AT, UPDATED_AT,
ORIGEN, FECHAREPARTO, DIAREPARTO, MESREPARTO, ANOREPARTO,
CODIGOREPARTIDOR, CODIGOVEHICULO, RUTA, DIASREPARTO,
REPARTO_VALIDADO_SN, REPARTO_VALIDADO_AT,
TARGET_SCHEMA, SYNC_STATUS, SYNC_AT,
SYSTEM_SUBEMPRESAPEDIDO, SYSTEM_EJERCICIOPEDIDO, SYSTEM_SERIEPEDIDO,
SYSTEM_TERMINALPEDIDO, SYSTEM_NUMEROPEDIDO,
DESCUENTO_GLOBAL
```

**Tipos a alinear (migración 026 ya ejecutada):**

| Columna | JAVIER (antes) | DSEDAC | Migración 026 |
|---------|----------------|--------|---------------|
| IMPORTETOTAL | NUMERIC(11,2) | NUMERIC(10,2) | ✅ Corregido |
| IMPORTECOSTO | NUMERIC(11,2) | NUMERIC(10,2) | ✅ Corregido |
| IMPORTEMARGEN | NUMERIC(11,2) | NUMERIC(10,2) | ✅ Corregido |

### 2. COBROS ↔ CRC (decisión arquitectónica pendiente)

DSEDAC.CRC es la cabecera de un **recibo PDA**, con un modelo muy específico del ERP (campos `SUBEMPRESARECIBO`, `EJERCICIORECIBO`, `NUMERORECIBO`, `TIPORECIBO`, `EFECTIVOTALON`, `NUMEROTALON`, `CODIGOENTIDADBANCARIA`, etc.). JAVIER.COBROS es un modelo simplificado.

**Decisión propuesta:**
- O migrar JAVIER.COBROS a tener las 31 columnas de CRC (recomendado para paridad)
- O crear una capa de "export" en código que transforme JAVIER.COBROS → DSEDAC.CRC al confirmar (más complejo pero menos invasivo)

### 3. REPARTIDOR_LIQUIDACION_OPS ↔ CLV (modelo divergente)

**DSEDAC.CLV** es una tabla de "líneas por concepto" — 1 fila por cada concepto-importe de la liquidación (`CODIGOCONCEPTO='EF'` para Efectivo, etc.).

**JAVIER.REPARTIDOR_LIQUIDACION_OPS** guarda todo en una sola fila: `IMPORTEEFECTIVO`, `IMPORTECHEQUES`, `IMPORTEPOSTDATADOS`, `IMPORTETARJETA`, etc.

**Decisión propuesta**: al exportar a DSEDAC, generar N filas en CLV (una por cada importe > 0) usando un mapping fijo:
- `IMPORTEEFECTIVO` → `CODIGOCONCEPTO='EF'`
- `IMPORTECHEQUES`  → `CODIGOCONCEPTO='CH'`
- `IMPORTETARJETA`  → `CODIGOCONCEPTO='TJ'`
- `IMPORTEPOSTDATADOS` → `CODIGOCONCEPTO='PD'`
- `IMPORTEGASTOS` → `CODIGOCONCEPTO='GT'`
- `IMPORTEINGRESOENBANCO` → `CODIGOCONCEPTO='IB'`

(Pendiente confirmar los códigos reales con el catálogo CLV o ejecutar `SELECT DISTINCT CODIGOCONCEPTO, DESCRIPCIONCONCEPTO FROM DSEDAC.CLV` en producción.)

### 4. REPARTIDOR_ENTREGAS ↔ CAC (modelo divergente)

JAVIER.REPARTIDOR_ENTREGAS está enfocada en el flujo de **preparación de almacén** (DIAINICIOPREPARACION, CODIGOPICADOR, TIEMPOPICADO, etc.) mientras que CAC es la cabecera del **albarán contable** completo (183 columnas con todos los importes, IVAs, retenciones, etc.).

Tienen finalidades distintas. **Decisión propuesta**: cuando se sincronice a DSEDAC, generar 1 fila en CAC tomando los datos de REPARTIDOR_ENTREGAS + el cliente + los importes calculados de las líneas. No es un mirror 1:1; es un proceso de mapping.

### 5. REPARTIDOR_ENTREGA_LINEAS ↔ LAC (paridad perfecta ✅)

**126 de 126 columnas alineadas**. JAVIER añade solo 6 columnas de metadata local (`IDEMPOTENCY_TOKEN`, `CREATED_AT`, `UPDATED_AT`, `STATUS`, `OPERADOR`, `PANTALLA_ORIGEN`).

Este es el patrón a seguir para los demás pares.

---

## Plan de trabajo recomendado

1. **Ya hecho** (sesión 2026-05-15):
   - Migración 026 (BOLSA, CUENTAS_LIQUIDACION, vistas faltantes, tipos PEDIDOS_CAB)
   - Migración 027 (140 columnas para paridad PEDIDOS_CAB ↔ CPC)

2. **Pendiente próxima sesión**:
   - Migración 028: alinear PEDIDOS_LIN con LPC (58 columnas faltantes)
   - Migración 029: alinear COBROS con CRC (30 columnas) o decisión arquitectónica
   - Implementar `exportCobroToSystem` (cobro JAVIER → DSEDAC.CRC + DSEDAC.CRCA)
   - Implementar `exportLiquidacionToSystem` (1 fila JAVIER → N filas DSEDAC.CLV)
   - Implementar `exportEntregaToSystem` (REPARTIDOR_ENTREGAS → DSEDAC.CAC + LAC)
   - Probar con `PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC` en entorno staging
   - Switch en producción

---

## Verificación rápida en runtime

Para regenerar el diff condensado en cualquier momento:

```bash
node backend/scripts/erp_diff_condensed.js
# Output: backend/tmp/db-exploration/erp_diff_condensed.md
```

El script:
- Lista todas las tablas/vistas que faltan en cada esquema
- Compara columna a columna cada par JAVIER↔DSEDAC
- Marca tipos divergentes
- Cabe en un solo mensaje (sin samples, sin definición de vistas)
