'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query } = require('../config/db');
const { comercialErpWriteForbiddenSql } = require('../utils/comercial-erp-tables');

const INDEXES = [
  'CREATE INDEX JAVIER.IX_TEST_CVC_CLIENTE ON JAVIER.TEST_CVC (CODIGOCLIENTEALBARAN)',
  'CREATE INDEX JAVIER.IX_TEST_CVC_TIPO ON JAVIER.TEST_CVC (TIPODOCUMENTO)',
  'CREATE INDEX JAVIER.IX_TEST_CAC_FAC ON JAVIER.TEST_CAC (EJERCICIOFACTURA, SERIEFACTURA, TERMINALFACTURA, NUMEROFACTURA)',
  'CREATE INDEX JAVIER.IX_TEST_CAC_VD ON JAVIER.TEST_CAC (CODIGOVENDEDOR)',
  'CREATE INDEX JAVIER.IX_TEST_LQD_VD ON JAVIER.TEST_LQD (CODIGOVENDEDOR, ANOLIQUIDACION, MESLIQUIDACION, DIALIQUIDACION)',
  'CREATE INDEX JAVIER.IX_TEST_CLX_CLI ON JAVIER.TEST_CLX (CODIGOCLIENTE)',
];

const COUNT_SQL = `
  SELECT CAST('TEST_FPG' AS VARCHAR(32)) AS T, COUNT(*) AS N FROM JAVIER.TEST_FPG
  UNION ALL SELECT 'TEST_VDDX', COUNT(*) FROM JAVIER.TEST_VDDX
  UNION ALL SELECT 'TEST_CLX', COUNT(*) FROM JAVIER.TEST_CLX
  UNION ALL SELECT 'TEST_LQD', COUNT(*) FROM JAVIER.TEST_LQD
  UNION ALL SELECT 'TEST_CVC', COUNT(*) FROM JAVIER.TEST_CVC
  UNION ALL SELECT 'TEST_CAC', COUNT(*) FROM JAVIER.TEST_CAC
  UNION ALL SELECT 'TEST_CPC', COUNT(*) FROM JAVIER.TEST_CPC
  UNION ALL SELECT 'TEST_LACLAE', COUNT(*) FROM JAVIER.TEST_LACLAE
  UNION ALL SELECT 'TEST_PMR', COUNT(*) FROM JAVIER.TEST_PMR
  UNION ALL SELECT 'TEST_COBROS', COUNT(*) FROM JAVIER.TEST_COBROS
  UNION ALL SELECT 'TEST_PEDIDOS_CAB', COUNT(*) FROM JAVIER.TEST_PEDIDOS_CAB
  UNION ALL SELECT 'TEST_LIQCOM', COUNT(*) FROM JAVIER.TEST_LIQUIDACION_COMERCIAL
  UNION ALL SELECT 'TEST_DEVCOM', COUNT(*) FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL
`;

async function main() {
  await initDb();
  try {
    for (const sql of INDEXES) {
      if (comercialErpWriteForbiddenSql(sql)) throw new Error(sql);
      try {
        await query(sql);
        console.log('OK', sql.split(' INDEX ')[1].split(' ON ')[0]);
      } catch (error) {
        const message = String(error.message || error);
        console.log(
          /SQL0601|already exists/i.test(message) ? 'EXISTS' : 'FAIL',
          sql.split(' INDEX ')[1].split(' ON ')[0],
          message.slice(0, 140),
        );
      }
    }
    const rows = await query(COUNT_SQL);
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
