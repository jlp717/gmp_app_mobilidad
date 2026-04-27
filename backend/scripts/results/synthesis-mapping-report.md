# JAVIER ↔ DSEDAC Definitive Mapping Report

## Executive Summary

After deep analysis of 1464 DSEDAC tables, 141 JAVIER tables, 89 SQL queries across 7 backend files, and column-by-column comparison of 126 JAVIER columns vs 532 DSEDAC columns, here is the **complete production-ready mapping**.

## Architecture Reality

The current code has **3 categories** of tables:

| Category | Description | Current Schema | Target Schema |
|----------|-------------|----------------|---------------|
| **ERP Read Tables** | Master data from ERP system | Hardcoded DSEDAC | DSEDAC (no change) |
| **ERP Write Tables** | App writes that mirror ERP tables | Hardcoded JAVIER | **DSEDAC** (needs refactor) |
| **App-Only Tables** | New tables with no ERP equivalent | Hardcoded JAVIER | **DSEDAC** (create new) |

## Complete Table Mapping

### Category 1: ERP Read Tables (Already DSEDAC ✅)

| Logical Name | DSEDAC Table | Purpose | Code Location |
|--------------|--------------|---------|---------------|
| Liquidaciones | `DSEDAC.LQD` | Daily liquidation records | repartidor-finance-service.js |
| Vencimientos | `DSEDAC.CVC` | Pending payments/debt | repartidor-finance-service.js |
| Cabecera Pedidos | `DSEDAC.CPC` | Order headers | repartidor-finance-service.js |
| Ordenes Preparacion | `DSEDAC.OPP` | Repartidor assignment | repartidor-finance-service.js |
| Cabecera Facturas | `DSEDAC.CAC` | Invoice headers | repartidor-finance-service.js |
| Lineas Albaran | `DSEDAC.LAC` | Invoice line items | repartidor-finance-service.js |
| Maestro Cliente | `DSEDAC.CLI` | Client master data | repartidor-finance-service.js |
| Creditos Cliente | `DSEDAC.CLCL1` | Client credit limits | repartidor-finance-service.js |
| Extensiones Cliente | `DSEDAC.CLX` | Client extensions (emails, cobro riguroso) | repartidor-finance-service.js |
| Parametros Cliente | `DSEDAC.CLP` | Client financial params | repartidor-finance-service.js |
| Planificacion Visitas | `DSEDAC.CDVI` | Route planning | repartidor-finance-service.js |
| Vendedores | `DSEDAC.VDD` | Vendor names | repartidor-finance-service.js |
| Usuarios Vendedores | `DSEDAC.VDC` | Vendor credentials | repartidor-finance-service.js |
| Vehiculos | `DSEDAC.VEH` | Vehicle data | repartidor-finance-service.js |

### Category 2: ERP Write Tables (Need DSEDAC Migration ⚠️)

These tables **mirror ERP concepts** but currently write to JAVIER. Must be refactored to write to DSEDAC.

| JAVIER Table | DSEDAC Equivalent | Match | Action |
|--------------|-------------------|-------|--------|
| `REPARTIDOR_COBROS` | `DSEDAC.CVC` | 11/29 exact cols | **Column translation needed** |
| `REPARTIDOR_LIQUIDACION_OPS` | `DSEDAC.LQD` | 1/24 exact, 14 partial | **Column translation needed** |
| `REPARTIDOR_ENTREGAS` | `DSEDAC.OPP` | 2/17 exact, 6 partial | **Column translation needed** |
| `REPARTIDOR_ENTREGA_LINEAS` | `DSEDAC.LAC` | 3/12 exact, 8 partial | **Column translation needed** |
| `REPARTIDOR_FIRMAS` | `DSEDAC.CACFIRMAS` | 3/10 exact, 3 partial | **Column translation needed** |
| `REPARTIDOR_OBJETIVOS` | `DSEDAC.CMV` | 1/11 exact, 4 partial | **Column translation needed** |
| `DELIVERY_STATUS` | `DSEDAC.CPC` | 3/8 exact, 2 partial | **Column translation needed** |
| `CLIENT_SIGNERS` | `DSEDAC.CLI` | 1/5 exact, 1 partial | **Column translation needed** |
| `COMM_CONFIG` | `DSEDAC.COMM_CONFIG` | **10/10 PERFECT** | ✅ Ready |

### Category 3: App-Only Tables (Create in DSEDAC 🆕)

These have **no DSEDAC equivalent** and must be created in DSEDAC for production.

| JAVIER Table | Purpose | DSEDAC Action |
|--------------|---------|---------------|
| `REPARTIDOR_LIQUIDACION_EMAILS` | Email delivery log | **CREATE in DSEDAC** |
| `COMMISSION_EXCEPTIONS` | Vendor commission exclusions | **CREATE in DSEDAC** |
| `COMMISSION_PAYMENTS` | Commission payment records | **CREATE in DSEDAC** |
| `REPARTIDOR_FINANCIAL_BALANCES` | Pending balance ledger | **CREATE in DSEDAC** |
| `REPARTIDOR_COMMISSION_TIERS` | Commission tier config | **CREATE in DSEDAC** |
| `RUTERO_CONFIG` | Route overrides | **CREATE in DSEDAC** or use `DSEDAC.VDP` |

## Column Translation Maps

### REPARTIDOR_COBROS → DSEDAC.CVC

| JAVIER Column | DSEDAC Column | Type Match | Notes |
|---------------|---------------|------------|-------|
| ID | NUMEROASIENTO | ⚠ INTEGER vs NUMERIC | Different meaning |
| ENTREGA_ID | NUMEROASIENTO | ⚠ | Different meaning |
| CODIGO_CLIENTE | CODIGOCLIENTEALBARAN | ✅ CHAR(10) | Truncation risk (20→10) |
| NOMBRE_CLIENTE | — | ❌ | No DSEDAC equivalent |
| CODIGO_REPARTIDOR | CODIGOVENDEDORCOBRO | ✅ CHAR(2) | Truncation risk (20→2) |
| TIPO_DOCUMENTO | TIPODOCUMENTO | ✅ CHAR(3) | |
| NUMERO_DOCUMENTO | NUMERODOCUMENTO | ✅ NUMERIC(6,0) | |
| EJERCICIO_DOCUMENTO | EJERCICIODOCUMENTO | ✅ NUMERIC(4,0) | |
| IMPORTE_COBRADO | IMPORTEVENCIMIENTO | ✅ NUMERIC(10,2) | Truncation risk (15→10) |
| IMPORTE_PENDIENTE | IMPORTEPENDIENTE | ✅ NUMERIC(10,2) | Truncation risk (15→10) |
| FORMA_PAGO | CODIGOFORMAPAGO | ✅ CHAR(2) | |
| FECHA_COBRO | DIA/MES/ANOCOBRO | ❌ TIMESTAMP vs 3 NUMERIC | **Major mismatch** |
| VALIDADO | SITUACION | ⚠ CHAR(1) | Different semantics |
| NOTAS | OBSERVACIONES | ✅ CHAR(60) | Truncation risk (500→60) |
| IDEMPOTENCY_TOKEN | — | ❌ | App-only |
| OPERADOR | CODIGOUSUARIO | ⚠ | Different meaning |
| LIQUIDADO_SN | NUMEROLIQUIDACION | ⚠ | Different meaning |
| CREATED_AT | — | ❌ | App-only |

### REPARTIDOR_LIQUIDACION_OPS → DSEDAC.LQD

| JAVIER Column | DSEDAC Column | Type Match | Notes |
|---------------|---------------|------------|-------|
| SUBEMPRESA_LIQ | SUBEMPRESALIQUIDACION | ✅ CHAR(3) | |
| EJERCICIO_LIQ | EJERCICIOLIQUIDACION | ✅ NUMERIC(4,0) | |
| SERIE_LIQ | SERIELIQUIDACION | ⚠ VARCHAR(5)→CHAR(1) | Truncation |
| TERMINAL_LIQ | TERMINALLIQUIDACION | ⚠ INTEGER→NUMERIC(3,0) | |
| NUMERO_LIQ | NUMEROLIQUIDACION | ✅ NUMERIC(6,0) | |
| CODIGO_REPARTIDOR | CODIGOVENDEDOR | ⚠ VARCHAR(20)→CHAR(2) | Truncation |
| TOTAL_EFECTIVO | IMPORTEEFECTIVO | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| TOTAL_CHEQUES | IMPORTECHEQUES | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| TOTAL_TARJETA | IMPORTETARJETA | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| TOTAL_POSTDATADOS | IMPORTEPOSTDATADOS | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| SALDO_ANTERIOR | IMPORTESALDOACTUAL | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| GASTOS | IMPORTEGASTOS | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| TOTAL_A_INGRESAR | IMPORTETOTALAINGRESAR | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| INGRESO_BANCO | IMPORTEINGRESOENBANCO | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| EFECTIVO_2 | IMPORTEEFECTIVO2 | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| ENTREGADO_2 | IMPORTEENTREGADO2 | ⚠ DECIMAL(15,2)→NUMERIC(10,2) | Truncation |
| PANTALLA_ORIGEN | — | ❌ | App-only |
| CREADO_POR | CODIGOUSUARIO | ⚠ | Different meaning |
| STATUS | REVISADOSN | ⚠ | Different semantics |
| CREATED_AT | — | ❌ | App-only |

### REPARTIDOR_FIRMAS → DSEDAC.CACFIRMAS

| JAVIER Column | DSEDAC Column | Type Match | Notes |
|---------------|---------------|------------|-------|
| FIRMA_BASE64 | FIRMABASE64 | ✅ VARCHAR→CLOB | Compatible |
| FIRMANTE_NOMBRE | FIRMANOMBRE | ✅ VARCHAR(100) | |
| FIRMANTE_DNI | FIRMADNI | ✅ VARCHAR(20) | |
| LATITUD | LATITUD | ✅ NUMERIC(15,6) | |
| LONGITUD | LONGITUD | ✅ NUMERIC(15,6) | |
| ENTREGA_ID | NUMEROALBARAN | ⚠ | Different meaning |
| FECHA_FIRMA | DIA/MES/ANO/HORA | ❌ TIMESTAMP vs 4 NUMERIC | **Major mismatch** |
| DISPOSITIVO | — | ❌ | App-only |

## Critical Risks for Production Cutover

| Risk | Severity | Tables | Detail | Mitigation |
|------|----------|--------|--------|------------|
| **Date format mismatch** | 🔴 HIGH | COBROS→CVC, LIQ→LQD | JAVIER uses TIMESTAMP, DSEDAC uses separate DIA/MES/ANO NUMERIC columns | Create translation layer |
| **Amount truncation** | 🔴 HIGH | COBROS→CVC, LIQ→LQD | JAVIER DECIMAL(15,2) vs DSEDAC NUMERIC(10,2) | Validate amounts < 99,999,999.99 |
| **Vendor code truncation** | 🔴 HIGH | COBROS→CVC, LIQ→LQD | JAVIER VARCHAR(20) vs DSEDAC CHAR(2) | Repartidor codes are 2 chars - verify |
| **ID type conflict** | 🟡 MEDIUM | DELIVERY→CPC | JAVIER VARCHAR(50) vs DSEDAC INTEGER(4) | Use separate ID generation |
| **App-only columns** | 🟡 MEDIUM | All tables | 39 columns have no DSEDAC equivalent | Keep in separate audit table |
| **Missing env var** | 🟡 MEDIUM | .env.produccion | REPARTIDOR_FINANCE_ERP_SCHEMA not set | Add before cutover |

## Recommended Production Strategy

### Phase 1: Create App-Only Tables in DSEDAC
```sql
-- Run in DSEDAC schema
CREATE TABLE DSEDAC.REPARTIDOR_LIQUIDACION_EMAILS (...);
CREATE TABLE DSEDAC.COMMISSION_EXCEPTIONS (...);
CREATE TABLE DSEDAC.COMMISSION_PAYMENTS (...);
CREATE TABLE DSEDAC.REPARTIDOR_FINANCIAL_BALANCES (...);
CREATE TABLE DSEDAC.REPARTIDOR_COMMISSION_TIERS (...);
```

### Phase 2: Create Column Translation Layer
Create a new service module `backend/services/schema-translation.js` that:
- Maps logical column names to DSEDAC physical column names
- Handles type conversions (TIMESTAMP → DIA/MES/ANO)
- Validates data before writing to DSEDAC

### Phase 3: Refactor All SQL Queries
Replace hardcoded `JAVIER.TABLE` with:
- `DSEDAC.TABLE` for ERP tables
- Translation layer for column names
- Schema variable for LQD (already implemented)

### Phase 4: Testing & Validation
- Run all queries against DSEDAC in test mode
- Validate data integrity
- Verify no truncation or type errors

## Files Requiring Refactoring

| File | Queries | Priority |
|------|---------|----------|
| `backend/services/repartidor-finance-service.js` | 38 | 🔴 CRITICAL |
| `backend/routes/repartidor.js` | 22 | 🔴 CRITICAL |
| `backend/routes/entregas.js` | 12 | 🟡 HIGH |
| `backend/routes/commissions.js` | 8 | 🟡 HIGH |
| `backend/routes/planner.js` | 5 | 🟢 MEDIUM |
| `backend/server.js` | 3 | 🟢 MEDIUM |
| `backend/src/modules/repartidor/infrastructure/db2-repartidor-repository.js` | 2 | 🟢 MEDIUM |
