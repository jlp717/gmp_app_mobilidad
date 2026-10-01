-- ROLLBACK for 048. JAVIER isolated_test only. Do not run against production.
-- Drops the competitive-price table and the additive evidence columns.
-- Not executed by the apply runner.

DROP INDEX JAVIER.IX_TEST_PC_LOOKUP;
DROP TABLE JAVIER.TEST_PRECIO_COMPETITIVO;
ALTER TABLE JAVIER.TEST_REPARTO_EVIDENCIAS DROP COLUMN DEVICE_ID;
ALTER TABLE JAVIER.TEST_REPARTO_EVIDENCIAS DROP COLUMN CAPTURED_AT;
