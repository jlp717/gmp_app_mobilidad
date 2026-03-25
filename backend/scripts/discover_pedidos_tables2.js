const odbc = require('odbc');
async function find() {
  const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

  console.log('=== STOCK TABLES (broader search) ===');
  const stockTables = await conn.query(`
    SELECT TABLE_NAME, TABLE_TEXT FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (TABLE_NAME LIKE 'STA%' OR TABLE_NAME LIKE 'SA%'
           OR TABLE_NAME LIKE 'AEX%' OR TABLE_NAME LIKE 'ARA%'
           OR TABLE_NAME LIKE 'STOCK%')
    ORDER BY TABLE_NAME
  `);
  for (const t of stockTables) console.log('  ', t.TABLE_NAME?.trim(), '-', t.TABLE_TEXT?.trim());

  console.log('\n=== TARIFF TABLES (broader search) ===');
  const tarTables = await conn.query(`
    SELECT TABLE_NAME, TABLE_TEXT FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (TABLE_NAME LIKE 'TAR%' OR TABLE_NAME LIKE 'TRF%'
           OR TABLE_NAME LIKE 'TFA%' OR TABLE_NAME LIKE 'DTA%')
    ORDER BY TABLE_NAME
  `);
  for (const t of tarTables) console.log('  ', t.TABLE_NAME?.trim(), '-', t.TABLE_TEXT?.trim());

  console.log('\n=== DISPONIBILIDAD / EXISTENCIAS TABLES ===');
  const dispTables = await conn.query(`
    SELECT TABLE_NAME, TABLE_TEXT FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (TABLE_NAME LIKE '%DISP%' OR TABLE_NAME LIKE '%EXIST%'
           OR TABLE_NAME LIKE 'DST%' OR TABLE_NAME LIKE 'DIS%')
    ORDER BY TABLE_NAME
  `);
  for (const t of dispTables) console.log('  ', t.TABLE_NAME?.trim(), '-', t.TABLE_TEXT?.trim());

  console.log('\n=== Tables with TARIF/PRECI/STOCK/EXIST in TEXT ===');
  const descTables = await conn.query(`
    SELECT TABLE_NAME, TABLE_TEXT FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = 'DSEDAC'
      AND (UPPER(TABLE_TEXT) LIKE '%TARIF%' OR UPPER(TABLE_TEXT) LIKE '%STOCK%'
           OR UPPER(TABLE_TEXT) LIKE '%EXIST%' OR UPPER(TABLE_TEXT) LIKE '%DISPON%')
    ORDER BY TABLE_NAME
  `);
  for (const t of descTables) console.log('  ', t.TABLE_NAME?.trim(), '-', t.TABLE_TEXT?.trim());

  // Try direct queries on likely table names
  console.log('\n=== DIRECT TABLE PROBES ===');
  const probes = ['STA', 'STAR', 'STAA', 'STAL1', 'SAA', 'TAR', 'TARL1', 'TART', 'DTA', 'DTAL1'];
  for (const name of probes) {
    try {
      const rows = await conn.query(`SELECT * FROM DSEDAC.${name} FETCH FIRST 1 ROW ONLY`);
      if (rows.length > 0) {
        console.log(`  DSEDAC.${name} EXISTS - columns:`, Object.keys(rows[0]).join(', '));
      } else {
        console.log(`  DSEDAC.${name} EXISTS (empty)`);
      }
    } catch (e) {
      // silent - table doesn't exist
    }
  }

  // Check ART table for stock-related columns
  console.log('\n=== ART columns with STOCK/EXIST/UNIDAD/PESO ===');
  const artCols = await conn.query(`
    SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ART'
      AND (UPPER(COLUMN_NAME) LIKE '%STOCK%' OR UPPER(COLUMN_NAME) LIKE '%EXIST%'
           OR UPPER(COLUMN_NAME) LIKE '%UNIDAD%' OR UPPER(COLUMN_NAME) LIKE '%PESO%'
           OR UPPER(COLUMN_NAME) LIKE '%PRECIO%' OR UPPER(COLUMN_NAME) LIKE '%TARIF%'
           OR UPPER(COLUMN_NAME) LIKE '%CAJA%' OR UPPER(COLUMN_NAME) LIKE '%PIEZA%'
           OR UPPER(COLUMN_NAME) LIKE '%KILO%' OR UPPER(COLUMN_NAME) LIKE '%BANDEJ%')
    ORDER BY COLUMN_NAME
  `);
  for (const c of artCols) console.log('  ', c.COLUMN_NAME?.trim());

  await conn.close();
}
find().catch(e => console.error(e.message));
