const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

(async () => {
  const pool = await odbc.pool(db2ConnectionString());
  const conn = await pool.connect();

  try {
    // Search DSEDAC for tables that might be the real equivalents
    // The app tables we created:
    // 1. REPARTIDOR_COBROS - cobros/pagos del repartidor
    // 2. REPARTIDOR_LIQUIDACION_OPS - liquidaciones diarias
    // 3. REPARTIDOR_FINANCIAL_BALANCES - saldos pendientes
    // 4. REPARTIDOR_COMMISSION_TIERS - tramos de comisiones
    // 5. REPARTIDOR_LIQUIDACION_EMAILS - emails de liquidacion
    // 6. DELIVERY_STATUS - estado de entregas/firmas

    // Search for ANY table in DSEDAC with these keywords in name or description
    const keywords = ['COBRO', 'PAGO', 'LIQUID', 'COMIS', 'SALDO', 'BALANCE', 'DELIV', 'FIRMA', 'REP'];

    console.log('=== Searching DSEDAC for potential equivalents ===\n');

    for (const kw of keywords) {
      const rows = await conn.query(`
        SELECT T.TABLE_NAME, T.LONG_COMMENT
        FROM QSYS2.SYSTABLES T
        WHERE T.TABLE_SCHEMA = 'DSEDAC'
          AND (T.TABLE_NAME LIKE '%${kw}%' OR T.LONG_COMMENT LIKE '%${kw}%')
        ORDER BY T.TABLE_NAME
      `);
      if (rows.length > 0) {
        console.log(`Keyword "${kw}" (${rows.length} matches):`);
        console.log(rows.map(r => `  ${r.TABLE_NAME}: ${r.LONG_COMMENT || '(no comment)'}`).join('\n'));
        console.log('');
      }
    }

    // Also check specific tables that might be relevant
    const specificTables = [
      'CVC',    // vencimientos/cobros
      'ENTD',   // entregas
      'ENTP',   // entregas
      'VDD',    // vendedores
      'VDC',    // usuarios vendedores
      'VEH',    // vehiculos
      'COMM_CONFIG', // commission config
      'LQD',    // liquidaciones
      'LQDL1',  // liquidaciones logical
      'CLP',    // parametros cliente
      'CLX',    // extensiones cliente
      'CAC',    // cabecera facturas
      'LAC',    // lineas albaran
      'CPC',    // cabecera pedidos
      'OPP',    // ordenes preparacion
    ];

    console.log('\n=== Checking specific DSEDAC tables ===\n');
    for (const tbl of specificTables) {
      const rows = await conn.query(`
        SELECT TABLE_NAME, TABLE_TYPE, LONG_COMMENT, ROW_LENGTH
        FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${tbl}'
      `);
      if (rows.length > 0) {
        const t = rows[0];
        console.log(`${t.TABLE_NAME} (${t.TABLE_TYPE}, row len=${t.ROW_LENGTH}): ${t.LONG_COMMENT || '(no comment)'}`);

        // Get column count
        const cols = await conn.query(`
          SELECT COUNT(*) as CNT FROM QSYS2.SYSCOLUMNS
          WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${tbl}'
        `);
        console.log(`  Columns: ${cols[0].CNT}`);
      }
    }

  } catch (e) {
    console.log('Error:', e.message);
    console.log('odbcErrors:', JSON.stringify(e.odbcErrors, null, 2));
  } finally {
    await conn.close();
    await pool.close();
  }
})();
