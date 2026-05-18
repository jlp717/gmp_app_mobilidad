-- P5: SQL Indexes for DB2/AS400 performance optimization
-- Run these on your IBM i to optimize queries

-- Primary index for LACLAE sales queries (most used)
CREATE INDEX DSED.LACLAE_IDX01 ON DSED.LACLAE (
    LCAADC ASC,    -- year
    LCMMDC ASC,    -- month
    LCCDCL ASC     -- client code (for DISTINCT)
)
INCLUDE (LCIMVT, LCIMCT, LCTPVT, LCCLLN, LCSRAB)
;

-- Composite for vendor filtering
CREATE INDEX DSED.LACLAE_IDX02 ON DSED.LACLAE (
    R1_T8CDVD ASC, -- vendor code (new column)
    LCAADC ASC,
    LCMMDC ASC
)
INCLUDE (LCIMVT, LCIMCT)
;

-- For LINDTO (line items) - similar structure
CREATE INDEX DSEDAC.LINDTO_IDX01 ON DSEDAC.LINDTO (
    ANODOCUMENTO ASC,
    MESDOCUMENTO ASC,
    CODIGOCLIENTEALBARAN ASC
)
INCLUDE (IMPORTEVENTA, IMPORTEMARGENREAL)
;

-- Optional: Materialized View for monthly aggregates (P5b)
-- Run nightly to pre-compute:
/*
CREATE TABLE JAVIER.MV_MONTHLY_SALES AS (
    SELECT 
        L.LCAADC as YEAR,
        L.LCMMDC as MONTH,
        TRIM(L.R1_T8CDVD) as VENDOR_CODE,
        SUM(L.LCIMVT) as TOTAL_SALES,
        SUM(L.LCIMVT - L.LCIMCT) as TOTAL_MARGIN,
        COUNT(DISTINCT L.LCNRAB) as ORDER_COUNT,
        COUNT(DISTINCT L.LCCDCL) as CLIENT_COUNT
    FROM DSED.LACLAE L
    WHERE L.TPDC = 'LAC'
        AND L.LCTPVT IN ('CC', 'VC')
        AND L.LCCLLN IN ('AB', 'VT')
        AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
    GROUP BY L.LCAADC, L.LCMMDC, TRIM(L.R1_T8CDVD)
)
WITH DATA;

-- Refresh nightly:
REFRESH TABLE JAVIER.MV_MONTHLY_SALES;
*/