const odbc = require('odbc');
async function find() {
  const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

  const tables = ['ARA', 'TRF', 'TRR', 'VDS', 'EXF', 'ASM', 'PTI', 'NRDARO', 'ECO'];

  for (const name of tables) {
    console.log('='.repeat(60));
    console.log(`  DSEDAC.${name}`);
    console.log('='.repeat(60));

    try {
      const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${name}'
        ORDER BY ORDINAL_POSITION
      `);
      console.log(`Columns (${cols.length}):`);
      for (const c of cols) {
        console.log(`  ${(c.COLUMN_NAME||'').trim().padEnd(35)} ${(c.DATA_TYPE||'').trim()}(${c.LENGTH}${c.NUMERIC_SCALE ? ','+c.NUMERIC_SCALE : ''})`);
      }
    } catch (e) {
      console.log(`  Columns error: ${e.message}`);
    }

    try {
      const rows = await conn.query(`SELECT * FROM DSEDAC.${name} FETCH FIRST 2 ROWS ONLY`);
      if (rows.length > 0) {
        console.log(`\nSample (${rows.length} rows):`);
        for (const row of rows) {
          const cleaned = {};
          for (const [k, v] of Object.entries(row)) {
            if (v !== null && v !== undefined && v !== '' && v !== 0) {
              cleaned[k] = typeof v === 'string' ? v.trim() : v;
            }
          }
          console.log(`  ${JSON.stringify(cleaned)}`);
        }
      } else {
        console.log('  (empty)');
      }
    } catch (e) {
      console.log(`  Sample error: ${e.message}`);
    }
    console.log('');
  }

  // Also: check if there's a specific stock/existencias view or table
  console.log('=== Searching ALL tables with column CODIGOARTICULO + CODIGOALMACEN ===');
  const stockCandidates = await conn.query(`
    SELECT DISTINCT c1.TABLE_NAME, t.TABLE_TEXT
    FROM QSYS2.SYSCOLUMNS c1
    JOIN QSYS2.SYSCOLUMNS c2 ON c1.TABLE_SCHEMA = c2.TABLE_SCHEMA AND c1.TABLE_NAME = c2.TABLE_NAME
    JOIN QSYS2.SYSTABLES t ON t.TABLE_SCHEMA = c1.TABLE_SCHEMA AND t.TABLE_NAME = c1.TABLE_NAME
    WHERE c1.TABLE_SCHEMA = 'DSEDAC'
      AND c1.COLUMN_NAME = 'CODIGOARTICULO'
      AND c2.COLUMN_NAME = 'CODIGOALMACEN'
      AND t.TABLE_TYPE = 'T'
    ORDER BY c1.TABLE_NAME
  `);
  for (const t of stockCandidates) {
    console.log(`  ${t.TABLE_NAME?.trim().padEnd(20)} - ${t.TABLE_TEXT?.trim()}`);
  }

  // Also check for any table with EXISTENCIAS or STOCK column
  console.log('\n=== Tables with EXISTENCIAS/STOCKACTUAL column ===');
  const existCols = await conn.query(`
    SELECT DISTINCT TABLE_NAME, COLUMN_NAME
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (UPPER(COLUMN_NAME) LIKE '%EXISTENCIA%' OR UPPER(COLUMN_NAME) LIKE '%STOCKACT%'
           OR UPPER(COLUMN_NAME) = 'STOCK' OR UPPER(COLUMN_NAME) LIKE '%DISPONIBL%')
    ORDER BY TABLE_NAME
  `);
  for (const c of existCols) {
    console.log(`  ${c.TABLE_NAME?.trim().padEnd(20)} - ${c.COLUMN_NAME?.trim()}`);
  }

  await conn.close();
}
find().catch(e => console.error(e.message));
