-- Rollback migration, production only. Manual and destructive by design.
-- Run only after confirming backup/restore coverage and no active move request.
-- Never run automatically and never use against DSEDAC.
SET CURRENT SCHEMA = 'JAVIER';

SELECT TABLE_SCHEMA, TABLE_NAME
  FROM QSYS2.SYSTABLES
 WHERE TABLE_SCHEMA = 'JAVIER'
   AND TABLE_NAME IN (
     'REPARTIDOR_RUTERO_DIA_OVERRIDE',
     'REPARTIDOR_RUTERO_MOVE_REQUESTS'
   );

DROP INDEX JAVIER.IX_REP_RUT_DIA_TARGET;
DROP TABLE JAVIER.REPARTIDOR_RUTERO_DIA_OVERRIDE;
DROP TABLE JAVIER.REPARTIDOR_RUTERO_MOVE_REQUESTS;
