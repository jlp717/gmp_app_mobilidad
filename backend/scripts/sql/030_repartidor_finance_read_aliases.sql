-- ============================================================================
-- Optional development aliases for repartidor-finanzas ERP read tables
-- ============================================================================
--
-- Normal configuration does NOT need these aliases:
--   REPARTIDOR_FINANCE_READ_SCHEMA=DSEDAC
--
-- Use this file only if a developer explicitly wants:
--   REPARTIDOR_FINANCE_READ_SCHEMA=JAVIER
--
-- The aliases make JAVIER.CLI/CVC/CPC/OPP/LAC/ART/CLCL1/CLX resolve to the
-- real DSEDAC tables without copying production data into JAVIER. If an object
-- already exists in JAVIER, skip that CREATE ALIAS statement and inspect the
-- existing object before replacing it.

CREATE ALIAS JAVIER.CLI FOR DSEDAC.CLI;
CREATE ALIAS JAVIER.CVC FOR DSEDAC.CVC;
CREATE ALIAS JAVIER.CPC FOR DSEDAC.CPC;
CREATE ALIAS JAVIER.OPP FOR DSEDAC.OPP;
CREATE ALIAS JAVIER.LAC FOR DSEDAC.LAC;
CREATE ALIAS JAVIER.ART FOR DSEDAC.ART;
CREATE ALIAS JAVIER.CLCL1 FOR DSEDAC.CLCL1;
CREATE ALIAS JAVIER.CLX FOR DSEDAC.CLX;

-- Verification:
-- SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
-- FROM QSYS2.SYSTABLES
-- WHERE TABLE_SCHEMA = 'JAVIER'
--   AND TABLE_NAME IN ('CLI','CVC','CPC','OPP','LAC','ART','CLCL1','CLX')
-- ORDER BY TABLE_NAME;
