-- Isolated TEST copies of commercial JAVIER app buffers.
-- NOT executed by startup. Create JAVIER.TEST_* only after QSYS2 compare.
-- Never ALTER/CREATE DSEDAC. Never dump CVC/CPC.
--
-- Idempotency: if the target exists, STOP and compare SYSCOLUMNS rather than
-- recreating. Preferred shape is LIKE the JAVIER production peer.
--
--   JAVIER.COBROS       -> JAVIER.TEST_COBROS
--   JAVIER.PEDIDOS_CAB  -> JAVIER.TEST_PEDIDOS_CAB
--   JAVIER.PEDIDOS_LIN  -> JAVIER.TEST_PEDIDOS_LIN
--
-- Apply via copy-javier-prod-to-test.js --reconcile-test-schema --schema-only
-- (CREATE TABLE LIKE) or run these statements manually against JAVIER only.

CREATE TABLE JAVIER.TEST_COBROS LIKE JAVIER.COBROS
  INCLUDING IDENTITY INCLUDING DEFAULTS;

CREATE TABLE JAVIER.TEST_PEDIDOS_CAB LIKE JAVIER.PEDIDOS_CAB
  INCLUDING IDENTITY INCLUDING DEFAULTS;

CREATE TABLE JAVIER.TEST_PEDIDOS_LIN LIKE JAVIER.PEDIDOS_LIN
  INCLUDING IDENTITY INCLUDING DEFAULTS;
