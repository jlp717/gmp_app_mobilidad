-- ============================================================
-- DB2 INDEX RECOMMENDATIONS FOR GMP APP MOBILIDAD
-- ============================================================
-- Generated from query audit of all backend services.
-- Execute on IBM i / DB2 as needed.
-- These indexes target the most frequently used WHERE/JOIN/ORDER BY patterns.
--
-- PRIORITY LEGEND:
--   P1 = Critical (N+1 fix, high-traffic endpoints)
--   P2 = High (pagination, dashboard)
--   P3 = Medium (detail views, less frequent)
-- ============================================================

-- ============================================================
-- P1: CAC - Main albaranes/facturas table (most queried)
-- ============================================================

-- Used by: dashboard (ventas periodo, clientes atendidos, pedidos pendientes, ultimas ventas)
-- Pattern: WHERE TRIM(CODIGOPROMOTORPREVENTA) = ? OR TRIM(CODIGOVENDEDOR) = ?
--          AND ELIMINADOSN <> 'S' AND date range filters
CREATE INDEX DSEDAC.IDX_CAC_VENDEDOR_FECHA
  ON DSEDAC.CAC (CODIGOVENDEDOR, ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO)
  WHERE ELIMINADOSN <> 'S';

CREATE INDEX DSEDAC.IDX_CAC_PROMOTOR_FECHA
  ON DSEDAC.CAC (CODIGOPROMOTORPREVENTA, ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO)
  WHERE ELIMINADOSN <> 'S';

-- Used by: roles.obtenerAlbaranesConductor
-- Pattern: WHERE TRIM(CODIGOCONDUCTOR) = ? AND date = today
CREATE INDEX DSEDAC.IDX_CAC_CONDUCTOR_FECHA
  ON DSEDAC.CAC (CODIGOCONDUCTOR, ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO);

-- Used by: facturas.getFacturas, facturas.getSummary
-- Pattern: WHERE EJERCICIOFACTURA = ? AND NUMEROFACTURA > 0 AND vendor filter
CREATE INDEX DSEDAC.IDX_CAC_FACTURA
  ON DSEDAC.CAC (EJERCICIOFACTURA, CODIGOVENDEDOR, NUMEROFACTURA);

-- Used by: facturas.getFacturaDetail
-- Pattern: WHERE SERIEFACTURA = ? AND NUMEROFACTURA = ? AND EJERCICIOFACTURA = ?
CREATE INDEX DSEDAC.IDX_CAC_FACTURA_DETAIL
  ON DSEDAC.CAC (SERIEFACTURA, NUMEROFACTURA, EJERCICIOFACTURA);

-- Used by: entregas.obtenerAlbaranesPendientes
-- Pattern: WHERE date = CURRENT_DATE
CREATE INDEX DSEDAC.IDX_CAC_HOY
  ON DSEDAC.CAC (ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO, NUMEROALBARAN);

-- Used by: dashboard.getTopClientes
-- Pattern: GROUP BY CODIGOCLIENTEALBARAN WHERE vendor + year
CREATE INDEX DSEDAC.IDX_CAC_CLIENTE_VENDEDOR
  ON DSEDAC.CAC (CODIGOCLIENTEALBARAN, CODIGOVENDEDOR, ANODOCUMENTO)
  WHERE ELIMINADOSN <> 'S';

-- ============================================================
-- P2: CLI - Clients table (JOIN target for N+1 elimination)
-- ============================================================

-- Used by: dashboard LEFT JOIN, cliente.listarClientes, facturas LEFT JOIN
-- Pattern: JOIN ON TRIM(CODIGOCLIENTE) = ?
CREATE INDEX DSEDAC.IDX_CLI_CODIGO
  ON DSEDAC.CLI (CODIGOCLIENTE);

-- Used by: dashboard.getTotalClientesAsignados
-- Pattern: WHERE TRIM(CODIGOVENDEDOR) = ? AND TRIM(FECHABAJA) = ''
CREATE INDEX DSEDAC.IDX_CLI_VENDEDOR
  ON DSEDAC.CLI (CODIGOVENDEDOR);

-- Used by: cliente.listarClientes search
-- Pattern: WHERE UPPER(NOMBRECLIENTE) LIKE ?
CREATE INDEX DSEDAC.IDX_CLI_NOMBRE
  ON DSEDAC.CLI (NOMBRECLIENTE);

-- ============================================================
-- P2: LAC - Invoice/albaran lines
-- ============================================================

-- Used by: facturas.getFacturaDetail (JOIN pattern)
-- Pattern: JOIN ON EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN
CREATE INDEX DSEDAC.IDX_LAC_ALBARAN
  ON DSEDAC.LAC (EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN, SECUENCIA);

-- Used by: products.obtenerProductos
-- Pattern: WHERE client + GROUP BY articulo
CREATE INDEX DSEDAC.IDX_LAC_CLIENTE_ARTICULO
  ON DSEDAC.LAC (CODIGOCLIENTEFACTURA, CODIGOARTICULO);

-- Used by: cliente.obtenerTopProductos
-- Pattern: WHERE CODIGOCLIENTEFACTURA = ? AND ANODOCUMENTO >= ?
CREATE INDEX DSEDAC.IDX_LAC_CLIENTE_ANO
  ON DSEDAC.LAC (CODIGOCLIENTEFACTURA, ANODOCUMENTO);

-- ============================================================
-- P3: VEH - Vehicle assignment (role detection)
-- ============================================================

-- Used by: roles.detectarRol
-- Pattern: WHERE TRIM(CODIGOVENDEDOR) = ?
CREATE INDEX DSEDAC.IDX_VEH_VENDEDOR
  ON DSEDAC.VEH (CODIGOVENDEDOR);

-- ============================================================
-- P3: VDD/VDP - Vendor auth tables
-- ============================================================

-- Used by: auth.buscarVendedor
-- Pattern: WHERE TRIM(CODIGOVENDEDOR) = ?
CREATE INDEX DSEDAC.IDX_VDD_CODIGO
  ON DSEDAC.VDD (CODIGOVENDEDOR);

-- Used by: auth.obtenerPIN
-- Pattern: WHERE TRIM(CODIGOVENDEDOR) = ?
CREATE INDEX DSEDAC.IDX_VDP_CODIGO
  ON DSEDAC.VDP (CODIGOVENDEDOR);

-- ============================================================
-- P3: FPA - Payment methods (used in CTR detection JOIN)
-- ============================================================

-- Used by: roles.obtenerAlbaranesConductor LEFT JOIN
-- Pattern: JOIN ON TRIM(CODFPA) = TRIM(CODIGOFORMAPAGO)
CREATE INDEX DSEDAC.IDX_FPA_CODIGO
  ON DSEDAC.FPA (CODFPA);

-- ============================================================
-- P3: CVC - Payment status
-- ============================================================

-- Used by: cliente.obtenerFacturas, cliente.obtenerEstadisticasFacturas
-- Pattern: JOIN ON SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO, NUMERODOCUMENTO
CREATE INDEX DSEDAC.IDX_CVC_DOCUMENTO
  ON DSEDAC.CVC (SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO, NUMERODOCUMENTO);

-- ============================================================
-- NOTES
-- ============================================================
-- 1. Check existing indexes before creating (avoid duplicates):
--    SELECT * FROM QSYS2.SYSINDEXES WHERE TABLE_SCHEMA = 'DSEDAC';
--
-- 2. DB2 for i may not support filtered indexes (WHERE clause).
--    If so, remove the WHERE clause from the CREATE INDEX statements.
--
-- 3. After creating indexes, run:
--    CALL SYSPROC.ADMIN_CMD('RUNSTATS ON TABLE DSEDAC.CAC WITH DISTRIBUTION AND DETAILED INDEXES ALL');
--    for each table to update statistics.
--
-- 4. Monitor index usage with:
--    SELECT * FROM QSYS2.SYSINDEXSTAT WHERE TABLE_SCHEMA = 'DSEDAC';
