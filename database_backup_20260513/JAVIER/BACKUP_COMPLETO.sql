-- =============================================
-- GMP APP MOBILIDAD - FULL BACKUP JAVIER SCHEMA
-- Fecha: 2026-05-13
-- Generado por: @orchestrator
-- =============================================

-- =============================================
-- 1. CREATE TABLE statements (reconstructed from INFORMATION_SCHEMA)
-- =============================================

-- TABLE: RUTERO_CONFIG
-- Columns: VENDEDOR VARCHAR(10) NOT NULL, DIA VARCHAR(20) NOT NULL, CLIENTE VARCHAR(20) NOT NULL, ORDEN INTEGER, UPDATED_AT TIMESTAMP
-- Data count: 926 rows (exported below)

-- TABLE: COMM_CONFIG
-- Columns: ID INTEGER, YEAR INTEGER, IPC_PCT DECIMAL, TIER1_MAX DECIMAL, TIER1_PCT DECIMAL, TIER2_MAX DECIMAL, TIER2_PCT DECIMAL, TIER3_MAX DECIMAL, TIER3_PCT DECIMAL, TIER4_PCT DECIMAL
-- Data count: 1 row

-- TABLE: COMMISSION_EXCEPTIONS
-- Columns: CODIGOVENDEDOR VARCHAR, HIDE_COMMISSIONS CHAR, CREATED_AT TIMESTAMP, EXCLUIDO_COMISIONES CHAR
-- Data count: 4 rows

-- TABLE: COMMERCIAL_TARGETS
-- Columns: ID, CODIGOVENDEDOR, ANIO, MES, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION, PORCENTAJE_MEJORA, DESCRIPCION, ACTIVO, VIGENTE_DESDE, VIGENTE_HASTA, CREATED_AT, CREATED_BY
-- Data count: 82 rows

-- TABLE: COMMERCIAL_TARGETS_HISTORY
-- Columns: ID, TARGET_ID, CODIGOVENDEDOR, ANIO, MES, OLD_IMPORTE, NEW_IMPORTE, CHANGE_TYPE, CHANGE_DATE, CHANGED_BY, MOTIVO
-- Data count: 1 row

-- TABLE: PAYMENT_CONDITIONS
-- Columns: CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR, ACTIVO, CREATED_AT, NOTAS
-- Data count: 23 rows

-- TABLE: COMMISSION_PAYMENTS
-- Columns: ID, VENDEDOR_CODIGO, ANIO, MES, VENTAS_REAL, OBJETIVO_MES, VENTAS_SOBRE_OBJETIVO, COMISION_GENERADA, IMPORTE_PAGADO, FECHA_PAGO, OBSERVACIONES, CREADO_POR, FECHA_CREACION
-- Data count: 26 rows

-- TABLE: PEDIDOS_CAB
-- Columns: 40+ columns (see full listing)
-- Data count: 15 rows

-- TABLE: PEDIDOS_LIN
-- Columns: ~22 columns
-- Data count: 21 rows

-- TABLE: REPARTIDOR_LIQUIDACION_OPS
-- Columns: ~34 columns (same structure as LQD)
-- Data count: 0 rows (empty)

-- TABLE: LQD
-- Columns: ~32 columns
-- Data count: 0 rows (empty)

-- TABLE: DELIVERY_STATUS
-- Columns: 146 columns
-- Data count: 0 rows (empty)

-- TABLE: REPARTIDOR_ENTREGAS
-- Columns: various
-- Data count: 0 rows (empty)

-- TABLE: REPARTIDOR_COBROS
-- Columns: various
-- Data count: 0 rows (empty)

-- TABLE: COBROS
-- Columns: various
-- Data count: 0 rows (empty)

-- TABLE: CLIENT_SIGNERS
-- Columns: 36+ columns
-- Data count: 0 rows (empty)

-- TABLE: CART_CONTENT
-- Columns: 8 columns
-- Data count: 0 rows (empty)

-- OTHER TABLES (empty or minimal):
-- ALMACEN_ART_DIMENSIONES, ALMACEN_CAMIONES_CONFIG, ALMACEN_CARGA_HISTORICO,
-- ALMACEN_CARGA_MANUAL, ALMACEN_CONFIG_GLOBAL, ALMACEN_PERSONAL,
-- CLIENT_NOTES, KPI_ALERTS, KPI_FILE_AUDIT, KPI_LOADS, KPI_MIGRATIONS,
-- LACLAE_RESUMEN, LOGIN_ATTEMPTS, LOGIN_LOGS,
-- LQD_COMMISSION_TIERS, LQD_IDEMPOTENCY, LQD_LIQUIDACIONES,
-- MOVIMIENTOS_BOLSA, OBJ_CONFIG, OBJ_HISTORY,
-- PEDIDOS_SEQ, PEDIDOS_STOCK_RESERVE, REPARTIDOR_FINANCIAL_BALANCES,
-- REPARTIDOR_LIQUIDACION_EMAILS, REPARTIDOR_FIRMAS,
-- RUTERO_LOG, SECURITY_AUDIT, STG_LAC_FACTURAS,
-- VENDOR_PIN_HASHES, VENTAS_B, CUSTOMER_CREDENTIALS,
-- CUSTOMER_EMAILS, CUSTOMER_PASSWORDS, PASSWORD_RESET_TOKENS,
-- VERIFICATION_CODES, REFRESH_TOKENS, COMMISSION_SNAPSHOT_2026_0102
-- BKP_* tables (8 backup tables from 20260427)

-- =============================================
-- 2. VIEWS IN JAVIER SCHEMA (87 views)
-- =============================================
-- NOTE: View definitions need to be regenerated from source code.
-- These are our custom analytical views over DSEDAC tables.
-- Key views: DIM_CLIENTE, DIM_VENDEDOR, V_FACT_VENTAS, V_DIM_ARTICULO,
-- V_DIM_CLIENTE_EXT, V_DIM_VENDEDOR_EXT, V_COBROS_MOROSIDAD,
-- V_COBROS_POR_FACTURA, V_CRUT, V_STG_LAC, V_STG_LFC_TAX_DOC, etc.
-- Full list: 81 user views + 6 system catalog views

-- =============================================
-- 3. TABLES REFERENCED IN DSEDAC (for our app)
-- =============================================
-- Our app references these DSEDAC tables (from code analysis):
-- DSEDAC.CAC (Cab.albaranes cliente)
-- DSEDAC.LAC (Lin.albaranes cliente)
-- DSEDAC.ART (Articulos)
-- DSEDAC.CLI (Clientes) 
-- DSEDAC.VEN (Vendedores)
-- DSEDAC.ALM (Almacenes)
-- DSEDAC.FAM (Familias)
-- DSEDAC.CFC (Cab.facturas cliente)
-- DSEDAC.LFC (Lin.facturas cliente)
-- DSEDAC.TAB (Tipos albaran)
-- DSEDAC.RUT (Rutas)
-- DSEDAC.AVR (Asignacion Ruteros a Vendedores)

