const odbc = require('odbc');
async function find() {
  const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

  const tables = ['ARO', 'ARL', 'ARTA', 'LPC', 'UBA'];

  for (const name of tables) {
    console.log('='.repeat(60));
    console.log(`  DSEDAC.${name}`);
    console.log('='.repeat(60));
    try {
      const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
        FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${name}'
        ORDER BY ORDINAL_POSITION
      `);
      console.log(`Columns (${cols.length}):`);
      for (const c of cols) {
        console.log(`  ${(c.COLUMN_NAME||'').trim().padEnd(35)} ${(c.DATA_TYPE||'').trim()}(${c.LENGTH}${c.NUMERIC_SCALE ? ','+c.NUMERIC_SCALE : ''})`);
      }
    } catch (e) { console.log(`  Error: ${e.message}`); }

    try {
      const rows = await conn.query(`SELECT * FROM DSEDAC.${name} FETCH FIRST 2 ROWS ONLY`);
      if (rows.length > 0) {
        console.log('Sample:');
        for (const row of rows) {
          const cleaned = {};
          for (const [k, v] of Object.entries(row)) {
            if (v !== null && v !== undefined && v !== '' && v !== 0) cleaned[k] = typeof v === 'string' ? v.trim() : v;
          }
          console.log(`  ${JSON.stringify(cleaned)}`);
        }
      } else console.log('  (empty)');
    } catch (e) { console.log(`  Sample error: ${e.message}`); }
    console.log('');
  }

  // Search for CPC (Cab.pedidos cliente) - order header
  console.log('=== Searching for order HEADER tables (CPC, CPE, CAP) ===');
  const orderHeaders = await conn.query(`
    SELECT TABLE_NAME, TABLE_TEXT FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (TABLE_NAME LIKE 'CPC%' OR TABLE_NAME LIKE 'CPE%' OR TABLE_NAME LIKE 'CAP%'
           OR TABLE_NAME LIKE 'PED%' OR TABLE_NAME LIKE 'CDP%')
    ORDER BY TABLE_NAME
  `);
  for (const t of orderHeaders) console.log(`  ${t.TABLE_NAME?.trim().padEnd(20)} - ${t.TABLE_TEXT?.trim()}`);

  // Get CPC columns (known order-related table)
  console.log('\n=== DSEDAC.CPC columns (Cab.Pagos Cliente) ===');
  try {
    const cols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
      FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
      ORDER BY ORDINAL_POSITION
    `);
    for (const c of cols) console.log(`  ${(c.COLUMN_NAME||'').trim().padEnd(35)} ${(c.DATA_TYPE||'').trim()}`);
  } catch(e) { console.log(`  Error: ${e.message}`); }

  // Get client tariff - how to determine which tariff applies to a client
  console.log('\n=== CLI columns related to tariff ===');
  const cliTariffCols = await conn.query(`
    SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
      AND (UPPER(COLUMN_NAME) LIKE '%TARIF%' OR UPPER(COLUMN_NAME) LIKE '%PRECI%'
           OR UPPER(COLUMN_NAME) LIKE '%DESCUENT%')
    ORDER BY COLUMN_NAME
  `);
  for (const c of cliTariffCols) console.log(`  ${c.COLUMN_NAME?.trim()}`);

  // Sample CLI row to see tariff code
  console.log('\n=== CLI sample (tariff-related cols) ===');
  try {
    const cliSample = await conn.query(`
      SELECT CODIGOCLIENTE, CODIGOTARIFA, CODIGOTARIFAVENTADIRECTA,
             PORCENTAJEDESCUENTO1, PORCENTAJEDESCUENTO2, PORCENTAJEDESCUENTO3
      FROM DSEDAC.CLI
      WHERE CODIGOCLIENTE = '4300028094'
      FETCH FIRST 1 ROW ONLY
    `);
    console.log(JSON.stringify(cliSample[0]));
  } catch(e) { console.log(`  Error: ${e.message}`); }

  // TRF full listing (all tariff definitions)
  console.log('\n=== ALL TARIFFS (TRF) ===');
  try {
    const trfs = await conn.query(`SELECT CODIGOTARIFA, TRIM(DESCRIPCIONTARIFA) as DESC FROM DSEDAC.TRF ORDER BY CODIGOTARIFA`);
    for (const t of trfs) console.log(`  ${t.CODIGOTARIFA}: ${t.DESC}`);
  } catch(e) { console.log(`  Error: ${e.message}`); }

  await conn.close();
}
find().catch(e => console.error(e.message));
