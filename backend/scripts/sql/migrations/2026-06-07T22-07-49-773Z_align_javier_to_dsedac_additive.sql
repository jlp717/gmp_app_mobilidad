-- JAVIER vs DSEDAC additive alignment
-- Generated: 2026-06-07T22:07:49.774Z
-- App schema: JAVIER
-- ERP schema: DSEDAC
--
-- Review before running. This migration only adds missing columns
-- and widens compatible CHAR/VARCHAR columns when DSEDAC is longer.
-- It does not drop, rename, recreate, shorten, or narrow columns.

-- Notes
-- - COBROS_COMERCIAL: skipped ID by rule

ALTER TABLE JAVIER.REPARTIDOR_COBROS ALTER COLUMN DESCRIPCIONCONCEPTO SET DATA TYPE CHAR(40);
ALTER TABLE JAVIER.DELIVERY_STATUS ADD COLUMN CODIGOCONDUCTOR CHAR(10);
