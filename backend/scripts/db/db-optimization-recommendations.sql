-- =============================================================================
-- GMP SALES APP - DATABASE OPTIMIZATION SUGGESTIONS
-- =============================================================================
-- Execute these commands in your DB2 SQL Interface (System i Navigator or CLI)
-- to achieve sub-50ms query performance for large datasets.
-- =============================================================================

-- 1. CRITICAL: Accelerate Initial Cache Load & Rutero Logic
-- Most queries filter by Year (LCAADC) and Vendor (R1_T8CDVD).
-- This index will drastically reduce the 'loadLaclaeCache' time.
CREATE INDEX DSED.IDX_LACLAE_YEAR_VENDOR 
ON DSED.LACLAE (LCAADC, R1_T8CDVD, LCCDCL);

-- 2. Accelerate YoY Sales Evolution & History
-- Used in /sales-evolution and /rutero/day/:day (Previous Year)
CREATE INDEX DSED.IDX_LACLAE_CLIENT_YEAR_MONTH
ON DSED.LACLAE (LCCDCL, LCAADC, LCMMDC);

-- 3. Accelerate Dashboard Range Queries
-- Used for 'Current Month' and 'YTD' calculations
CREATE INDEX DSED.IDX_LACLAE_YEAR_MONTH_DAY
ON DSED.LACLAE (LCAADC, LCMMDC, LCDDDC);

-- 4. Accelerate Client Text Search (Metrics)
-- Optional: Only if text search is slow
-- CREATE INDEX DSEDAC.IDX_CLI_NAME ON DSEDAC.CLI (NOMBRECLIENTE);

-- =============================================================================
-- VERIFICATION COMMANDS
-- =============================================================================
-- Check if indexes exist:
-- SELECT * FROM SYSIBM.SYSINDEXES WHERE TBNAME = 'LACLAE';
