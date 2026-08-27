-- Rollback migration, production only. Manual and destructive by design.
-- Run only after confirming backup/restore coverage and no active tracking.
SET CURRENT SCHEMA = 'JAVIER';

SELECT TABLE_SCHEMA, TABLE_NAME
  FROM QSYS2.SYSTABLES
 WHERE TABLE_SCHEMA = 'JAVIER'
   AND TABLE_NAME = 'REPARTIDOR_RUTERO_TRACKING';

DROP INDEX JAVIER.IX_REP_TRACKING_LATEST;
DROP TABLE JAVIER.REPARTIDOR_RUTERO_TRACKING;
