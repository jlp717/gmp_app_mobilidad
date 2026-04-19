-- =============================================================================
-- GMP APP - DB2 PERFORMANCE INDEXES
-- =============================================================================
-- These indexes optimize the most common query patterns
-- Run this script on your IBM i / AS400 to improve query performance

-- =============================================================================
-- PEDIDOS PERFORMANCE INDEXES
-- =============================================================================

-- Index for looking up orders by vendor and date (high frequency)
CREATE INDEX JAVIER.IDX_PEDIDOS_CAB_VENDEDOR_FECHA 
    ON JAVIER.PEDIDOS_CAB (CODIGOVENDEDOR, ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO);

-- Index for order status queries
CREATE INDEX JAVIER.IDX_PEDIDOS_CAB_ESTADO 
    ON JAVIER.PEDIDOS_CAB (ESTADO, ANODOCUMENTO DESC, MESDOCUMENTO DESC);

-- Index for client lookup in orders
CREATE INDEX JAVIER.IDX_PEDIDOS_CAB_CLIENTE 
    ON JAVIER.PEDIDOS_CAB (CODIGOCLIENTE, ANODOCUMENTO DESC);

-- Index for PEDIDOS_LINEAS by order
CREATE INDEX JAVIER.IDX_PEDIDOS_LINEAS_ORDEN 
    ON JAVIER.PEDIDOS_LINEAS (NUMEROORDENPREPARACION, EJERCICIOORDENPREPARACION);

-- Index for product lookup in orders
CREATE INDEX JAVIER.IDX_PEDIDOS_LINEAS_PRODUCTO 
    ON JAVIER.PEDIDOS_LINEAS (CODIGOARTICULO, ANODOCUMENTO DESC);

-- =============================================================================
-- SALES (LAC) PERFORMANCE INDEXES  
-- =============================================================================

-- Index for vendor sales by year/month (DASHBOARD)
CREATE INDEX JAVIER.IDX_LAC_VENDEDOR_FECHA 
    ON JAVIER.LAC (R1_T8CDVD, LCAADC DESC, LCAADM DESC);

-- Index for client sales (CLIENTS)
CREATE INDEX JAVIER.IDX_LAC_CLIENTE_FECHA 
    ON JAVIER.LAC (R1_T8CDCL, LCAADC DESC);

-- Index for product sales analytics (PRODUCTS)
CREATE INDEX JAVIER.IDX_LAC_ARTICULO_FECHA 
    ON JAVIER.LAC (R1_T8CDAR, LCAADC DESC);

-- =============================================================================
-- COBROS PERFORMANCE INDEXES
-- =============================================================================

-- Index for pending payments by client
CREATE INDEX JAVIER.IDX_COBROS_CLIENTE 
    ON JAVIER.COBROS (CODIGO_CLIENTE, FECHA DESC);

-- Index for vendor collection summary
CREATE INDEX JAVIER.IDX_COBROS_USUARIO_FECHA 
    ON JAVIER.COBROS (CODIGO_USUARIO, FECHA DESC);

-- =============================================================================
-- DELIVERIES (OPP - ORDENES PREPARACION) INDEXES
-- =============================================================================

-- Index for delivery schedule by date/repartidor
CREATE INDEX JAVIER.IDX_OPP_REPARTIDOR_FECHA 
    ON JAVIER.OPP (CODIGOREPARTIDOR, ANOREPARTO DESC, MESREPARTO DESC, DIAREPARTO);

-- Index for delivery status queries
CREATE INDEX JAVIER.IDX_OPP_ESTADO_FECHA 
    ON JAVIER.OPP (ESTADOrutero, ANOREPARTO DESC, MESREPARTO DESC);

-- Index for client delivery history
CREATE INDEX JAVIER.IDX_OPP_CLIENTE_FECHA 
    ON JAVIER.OPP (CODIGOCLIENTERUTERO, ANOREPARTO DESC, MESREPARTO DESC);

-- =============================================================================
-- MONITOR INDEX USAGE
-- =============================================================================

-- To see index usage statistics:
-- SELECT * FROM TABLE (SYSCIBM.SYSCOLDIST(SPECIFIC_SCHEMA 'JAVIER')) 
--     WHERE TABLENAME LIKE 'PEDIDOS%'
--     ORDER BY CREATED DESC;

-- To analyze tables:
-- CALL SYSCOLUMN.REORGCHKC('JAVIER', 'PEDIDOS_CAB');
-- CALL SYSCOLUMN.REORGCHKC('JAVIER', 'PEDIDOS_LINEAS');
-- CALL SYSCOLUMN.REORGCHKC('JAVIER', 'LAC');