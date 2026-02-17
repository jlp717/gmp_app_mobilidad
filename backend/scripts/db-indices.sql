-- =============================================================================
-- GMP APP - DATABASE INDICES
-- Recommended indices for DB2/i5/OS performance optimization
-- 
-- USAGE: Run this script on the IBM i via STRSQL or ACS SQL Script tool.
--        Each CREATE INDEX is wrapped in a comment block for selective execution.
-- =============================================================================

-- NOTE: On DB2 for i, indices are created as logical files.
-- If an index already exists, the CREATE INDEX will fail with SQL0601.
-- This is safe - the index simply already exists.

-- =============================================================================
-- 1. LACLAE (DSED.LACLAE) - Main sales table, most queried
-- =============================================================================

-- Index for vendor code lookups (used by buildVendedorFilterLACLAE)
CREATE INDEX DSED.LACLAE_VENDOR_IDX 
  ON DSED.LACLAE (LCCDVD, LCYEAB, LCMMDC);

-- Index for date-based queries (year/month filtering)
CREATE INDEX DSED.LACLAE_DATE_IDX 
  ON DSED.LACLAE (LCYEAB, LCMMDC, TPDC);

-- Index for client lookups by vendor
CREATE INDEX DSED.LACLAE_CLIENT_VENDOR_IDX 
  ON DSED.LACLAE (LCCDVD, LCCDCL, LCYEAB);

-- Composite index for sales calculations (covers most dashboard queries)
CREATE INDEX DSED.LACLAE_SALES_IDX 
  ON DSED.LACLAE (TPDC, LCTPVT, LCCLLN, LCSRAB, LCYEAB, LCMMDC, LCCDVD);

-- =============================================================================
-- 2. LAC (DSEDAC.LAC) - Alternative sales table
-- =============================================================================

-- Index for vendor + date filtering
CREATE INDEX DSEDAC.LAC_VENDOR_DATE_IDX 
  ON DSEDAC.LAC (LCCDVD, LCYEAB, LCMMDC);

-- Index for document type filtering
CREATE INDEX DSEDAC.LAC_DOCTYPE_IDX 
  ON DSEDAC.LAC (LCTPVT, LCCLLN, LCSRAB, LCYEAB);

-- =============================================================================
-- 3. CAC (DSEDAC.CAC) - Albaranes (delivery notes)
-- =============================================================================

-- Index for albaran type lookups (used in EXISTS subqueries)
CREATE INDEX DSEDAC.CAC_ALBARAN_IDX 
  ON DSEDAC.CAC (CCSBAB, CCYEAB, CCSRAB, CCTRAB, CCNRAB, CODIGOTIPOALBARAN);

-- =============================================================================
-- 4. OPP (DSEDAC.OPP) - Objectives/targets table
-- =============================================================================

-- Index for vendor objectives lookup
CREATE INDEX DSEDAC.OPP_VENDOR_IDX 
  ON DSEDAC.OPP (CODIGOVENDEDOR, ANODOCUMENTO, MESDOCUMENTO);

-- =============================================================================
-- 5. CPC (DSEDAC.CPC) - Commission payments
-- =============================================================================

-- Index for commission lookups by vendor/year
CREATE INDEX DSEDAC.CPC_COMMISSION_IDX 
  ON DSEDAC.CPC (CODIGOVENDEDOR, ANODOCUMENTO);

-- =============================================================================
-- 6. CLI (DSEDAC.CLI) - Client master data
-- =============================================================================

-- Index for client by vendor
CREATE INDEX DSEDAC.CLI_VENDOR_IDX 
  ON DSEDAC.CLI (CODIGOVENDEDOR, CODIGOCLIENTE);

-- =============================================================================
-- 7. JAVIER.DELIVERY_STATUS - Delivery tracking (custom table)
-- =============================================================================

-- Index for status lookups
CREATE INDEX JAVIER.DELIVERY_STATUS_IDX 
  ON JAVIER.DELIVERY_STATUS (STATUS, REPARTIDOR_ID);

-- Index for date-based queries
CREATE INDEX JAVIER.DELIVERY_STATUS_DATE_IDX 
  ON JAVIER.DELIVERY_STATUS (UPDATED_AT DESC);

-- =============================================================================
-- 8. JAVIER.COMMISSION_PAYMENTS - Commission payment history
-- =============================================================================

CREATE INDEX JAVIER.COMMISSION_PAY_IDX 
  ON JAVIER.COMMISSION_PAYMENTS (VENDOR_CODE, YEAR, MONTH);

-- =============================================================================
-- VERIFICATION: Check existing indices
-- =============================================================================
-- Run this to see all indices on LACLAE:
-- SELECT INDEX_NAME, COLUMN_NAME FROM QSYS2.SYSKEYS 
-- WHERE INDEX_SCHEMA = 'DSED' 
--   AND TABLE_NAME = 'LACLAE' 
-- ORDER BY INDEX_NAME, ORDINAL_POSITION;
