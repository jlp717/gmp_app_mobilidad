-- =============================================================================
-- Recommended DB2 Indices for GMP App Mobilidad
-- Generated: 2026-04-02
-- =============================================================================
-- IMPORTANT: Review existing indices before creating. Run EXPLAIN PLAN to verify.
-- All indices are in schema JAVIER unless noted otherwise.
-- =============================================================================

-- =============================================================================
-- AUTH MODULE: APP_USUARIOS
-- =============================================================================

-- Primary login lookup: findByCode(USUARIO)
CREATE INDEX JAVIER.IDX_APP_USUARIOS_USUARIO
    ON JAVIER.APP_USUARIOS (USUARIO)
    INCLUDE (NOMBRE, ROL, EMAIL, PASSWORD_HASH, ACTIVO);

-- =============================================================================
-- AUTH MODULE: APP_LOGIN_LOG
-- =============================================================================

-- Audit queries by user and date range
CREATE INDEX JAVIER.IDX_APP_LOGIN_LOG_USUARIO_FECHA
    ON JAVIER.APP_LOGIN_LOG (USUARIO, FECHA DESC);

-- =============================================================================
-- PEDIDOS MODULE: PEDIDOS_CAB
-- =============================================================================

-- Order history lookup: WHERE CODIGO_USUARIO = ? ORDER BY FECHAPEDIDO DESC
CREATE INDEX JAVIER.IDX_PEDIDOS_CAB_USUARIO_FECHA
    ON JAVIER.PEDIDOS_CAB (CODIGO_USUARIO, FECHAPEDIDO DESC)
    INCLUDE (EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, ESTADO, OBSERVACIONES, CODIGOCLIENTE);

-- Cobros: WHERE CODIGOCLIENTE = ? AND ESTADO IN ('CONFIRMADO','FACTURADO')
CREATE INDEX JAVIER.IDX_PEDIDOS_CAB_CLIENTE_ESTADO
    ON JAVIER.PEDIDOS_CAB (CODIGOCLIENTE, ESTADO)
    INCLUDE (FECHAPEDIDO, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO);

-- Stats aggregation: WHERE CODIGO_USUARIO = ? (covers all ESTADO values)
-- Already covered by IDX_PEDIDOS_CAB_USUARIO_FECHA

-- =============================================================================
-- PEDIDOS MODULE: PEDIDOS_LIN
-- =============================================================================

-- JOIN with PEDIDOS_CAB: ON PC.ID = PL.PEDIDO_ID
CREATE INDEX JAVIER.IDX_PEDIDOS_LIN_PEDIDO_ID
    ON JAVIER.PEDIDOS_LIN (PEDIDO_ID)
    INCLUDE (CODIGOARTICULO, CANTIDAD, UNIDAD, PRECIO);

-- =============================================================================
-- PEDIDOS MODULE: CART_CONTENT
-- =============================================================================

-- Cart retrieval: WHERE USER_ID = ? ORDER BY FECHA_CREACION DESC
CREATE INDEX JAVIER.IDX_CART_CONTENT_USER_ID
    ON JAVIER.CART_CONTENT (USER_ID, FECHA_CREACION DESC)
    INCLUDE (CODIGO_CLIENTE, CODIGO_PRODUCTO, CANTIDAD, UNIDAD, OBSERVACIONES);

-- =============================================================================
-- COBROS MODULE: COBROS
-- =============================================================================

-- Payment history: WHERE CODIGO_CLIENTE = ? ORDER BY FECHA DESC
CREATE INDEX JAVIER.IDX_COBROS_CLIENTE_FECHA
    ON JAVIER.COBROS (CODIGO_CLIENTE, FECHA DESC)
    INCLUDE (IMPORTE, FORMA_PAGO, REFERENCIA, OBSERVACIONES);

-- Vendor totals: WHERE CODIGO_USUARIO = ?
CREATE INDEX JAVIER.IDX_COBROS_USUARIO
    ON JAVIER.COBROS (CODIGO_USUARIO)
    INCLUDE (IMPORTE, FECHA);

-- =============================================================================
-- ENTREGAS MODULE: DELIVERY_STATUS
-- =============================================================================

-- Delivery lookup by albaran (JOIN key): ON CPC.NUMEROALBARAN = DS.ID
CREATE INDEX JAVIER.IDX_DELIVERY_STATUS_ID
    ON JAVIER.DELIVERY_STATUS (ID)
    INCLUDE (STATUS, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, UPDATED_AT, REPARTIDOR_ID);

-- Filter by status for delivery reports
CREATE INDEX JAVIER.IDX_DELIVERY_STATUS_STATUS
    ON JAVIER.DELIVERY_STATUS (STATUS)
    INCLUDE (ID, UPDATED_AT);

-- =============================================================================
-- ENTREGAS MODULE: DSEDAC.CPC (External schema)
-- =============================================================================
-- NOTE: These indices may already exist on the production system.
-- Create only if EXPLAIN PLAN shows table scan.

-- Route lookup: WHERE CODIGOREPARTIDOR = ? ORDER BY FECHAENTREGA
-- CREATE INDEX DSEDAC.IDX_CPC_REPARTIDOR_FECHA
--     ON DSEDAC.CPC (CODIGOREPARTIDOR, FECHAENTREGA)
--     INCLUDE (NUMEROALBARAN, CODIGOCLIENTE, IMPORTE, ANODOCUMENTO);

-- Gamification: WHERE CODIGOREPARTIDOR = ? AND ANODOCUMENTO = ?
-- CREATE INDEX DSEDAC.IDX_CPC_REPARTIDOR_ANO
--     ON DSEDAC.CPC (CODIGOREPARTIDOR, ANODOCUMENTO)
--     INCLUDE (NUMEROALBARAN);

-- =============================================================================
-- RUTERO MODULE: RUTERO_CONFIG
-- =============================================================================

-- Route config: WHERE VENDEDOR = ? AND DIA_SEMANA = ? AND ORDEN >= 0 ORDER BY ORDEN
CREATE INDEX JAVIER.IDX_RUTERO_CONFIG_VENDEDOR_DIA_ORDEN
    ON JAVIER.RUTERO_CONFIG (VENDEDOR, DIA_SEMANA, ORDEN)
    INCLUDE (CODIGOCLIENTE, TIEMPO_ESTIMADO);

-- Client move: WHERE CODIGOCLIENTE = ? AND VENDEDOR = ? AND DIA_SEMANA = ?
CREATE INDEX JAVIER.IDX_RUTERO_CONFIG_CLIENTE_VENDEDOR_DIA
    ON JAVIER.RUTERO_CONFIG (CODIGOCLIENTE, VENDEDOR, DIA_SEMANA)
    INCLUDE (ORDEN);

-- =============================================================================
-- SHARED: CLIENTES
-- =============================================================================

-- JOIN key used across ALL modules: TRIM(CODIGO) = TRIM(?)
-- If CODIGO is CHAR with trailing spaces, consider a generated column
CREATE INDEX JAVIER.IDX_CLIENTES_CODIGO
    ON JAVIER.CLIENTES (CODIGO)
    INCLUDE (NOMBRE);

-- =============================================================================
-- SHARED: LACLAE (Sales data - high volume table)
-- =============================================================================

-- Product search: WHERE LCCDVD IN (...) AND LCTPVT IN (...) AND LCCLLN IN (...)
-- Note: LACLAE_SALES_FILTER uses multiple columns; composite index helps
CREATE INDEX JAVIER.IDX_LACLAE_VENDOR_SALES
    ON JAVIER.LACLAE (LCCDVD, LCTPVT, LCCLLN, LCSRAB, TPDC)
    INCLUDE (CODART, DESART, PRECIO, STOCK, UNIDAD, FAMILIA, MARCA, IMAGEN,
             CODIGOCLIENTE, FECHA, IMPORTE, COMISION);

-- Commissions by vendor: WHERE VENDEDOR = ? GROUP BY CODIGOCLIENTE
CREATE INDEX JAVIER.IDX_LACLAE_VENDEDOR_CLIENTE
    ON JAVIER.LACLAE (VENDEDOR, CODIGOCLIENTE)
    INCLUDE (IMPORTE, COMISION, FECHA);

-- =============================================================================
-- SHARED: PROMOTIONS (PMRL1, PMPL1)
-- =============================================================================

-- Active promotions: WHERE CODIGOCLIENTE = ? AND FECHAINICIO <= ? AND FECHAFIN >= ?
CREATE INDEX JAVIER.IDX_PMRL1_CLIENTE_FECHAS
    ON JAVIER.PMRL1 (CODIGOCLIENTE, FECHAINICIO, FECHAFIN)
    INCLUDE (IDPROMO, DESPPROMO, TIPO);

-- Promotion lines: JOIN on IDPROMO
CREATE INDEX JAVIER.IDX_PMPL1_IDPROMO
    ON JAVIER.PMPL1 (IDPROMO)
    INCLUDE (CODART, UNIDADESMIN, UNIDADESMAX, PRECIO);

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
-- Run these to check existing indices before creating new ones:

-- List all existing indices in JAVIER schema
-- SELECT INDNAME, TABNAME, COLNAMES
--   FROM SYSCAT.INDEXES
--   WHERE TABSCHEMA = 'JAVIER'
--   ORDER BY TABNAME, INDNAME;

-- Check index usage statistics
-- SELECT INDNAME, TABNAME, SCANS, SCANS_WITH_INDEXING
--   FROM SYSCAT.INDEXES
--   WHERE TABSCHEMA = 'JAVIER'
--   ORDER BY SCANS DESC;
