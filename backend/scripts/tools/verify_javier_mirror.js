// tools/verify_javier_mirror.js - moved from scripts/verify_javier_mirror.js (WS2 tools consolidation, rama test).
// verifica espejo JAVIER lectura
// Uso: node backend/scripts/tools/verify_javier_mirror.js Env: env ODBC_* DB2: R (detalle: backend/scripts/tools/README.md).
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

async function connect() {
  return odbc.connect(db2ConnectionString());
}

async function getTableColumns(connection, schema, table) {
  const query = `
    SELECT 
      COLUMN_NAME, 
      DATA_TYPE, 
      LENGTH, 
      SCALE, 
      NULLS,
      ORDINAL_POSITION
    FROM QSYS2.SYSCOLUMNS 
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `;
  return connection.query(query, [schema, table]);
}

async function getTableList(connection, schema) {
  const query = `
    SELECT TABLE_NAME, TABLE_TYPE 
    FROM QSYS2.SYSTABLES 
    WHERE TABLE_SCHEMA = ?
    ORDER BY TABLE_NAME
  `;
  return connection.query(query, [schema]);
}

function normalizeType(dataType, length, scale) {
  const type = dataType.trim().toUpperCase();
  const len = parseInt(length) || 0;
  const sc = parseInt(scale) || 0;
  return `${type}(${len},${sc})`;
}

async function compareTablePair(connection, javierTable, dsedacTable, label) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`COMPARING: ${label}`);
  console.log(`  JAVIER.${javierTable}  vs  DSEDAC.${dsedacTable}`);
  console.log(`${'='.repeat(80)}`);

  const javierCols = await getTableColumns(connection, 'JAVIER', javierTable);
  const dsedacCols = await getTableColumns(connection, 'DSEDAC', dsedacTable);

  if (javierCols.length === 0) {
    console.log(`  âš ï¸  JAVIER.${javierTable} NOT FOUND`);
    return { match: false, javierCount: 0, dsedacCount: dsedacCols.length, extraCols: [], missingCols: [], typeMismatches: [] };
  }
  if (dsedacCols.length === 0) {
    console.log(`  âš ï¸  DSEDAC.${dsedacTable} NOT FOUND`);
    return { match: false, javierCount: javierCols.length, dsedacCount: 0, extraCols: [], missingCols: [], typeMismatches: [] };
  }

  const dsedacMap = new Map();
  for (const col of dsedacCols) {
    const name = col.COLUMN_NAME.trim().toUpperCase();
    dsedacMap.set(name, {
      type: col.DATA_TYPE.trim().toUpperCase(),
      length: parseInt(col.LENGTH) || 0,
      scale: parseInt(col.SCALE) || 0,
      normalized: normalizeType(col.DATA_TYPE, col.LENGTH, col.SCALE)
    });
  }

  const javierNames = new Set();
  const missingCols = [];
  const typeMismatches = [];

  for (const col of javierCols) {
    const name = col.COLUMN_NAME.trim().toUpperCase();
    javierNames.add(name);
  }

  // Check which DSEDAC columns are missing in JAVIER
  for (const [dsedacName, dsedacInfo] of dsedacMap) {
    if (!javierNames.has(dsedacName)) {
      missingCols.push(dsedacName);
    }
  }

  // Check JAVIER columns that are extra (app-only) and verify types for shared columns
  const extraCols = [];
  for (const col of javierCols) {
    const name = col.COLUMN_NAME.trim().toUpperCase();
    const javierNormalized = normalizeType(col.DATA_TYPE, col.LENGTH, col.SCALE);
    
    if (!dsedacMap.has(name)) {
      extraCols.push({ name, type: javierNormalized });
    } else {
      const dsedacInfo = dsedacMap.get(name);
      if (dsedacInfo.normalized !== javierNormalized) {
        typeMismatches.push({
          column: name,
          javier: javierNormalized,
          dsedac: dsedacInfo.normalized
        });
      }
    }
  }

  const isMatch = missingCols.length === 0 && typeMismatches.length === 0;

  console.log(`  DSEDAC columns: ${dsedacCols.length}`);
  console.log(`  JAVIER columns: ${javierCols.length}`);
  console.log(`  App-only columns in JAVIER: ${extraCols.length}`);
  
  if (extraCols.length > 0) {
    console.log(`  App-only columns:`);
    for (const c of extraCols) {
      console.log(`    + ${c.name} (${c.type})`);
    }
  }

  if (missingCols.length > 0) {
    console.log(`  âŒ MISSING from JAVIER (${missingCols.length}):`);
    for (const c of missingCols) {
      console.log(`    - ${c}`);
    }
  }

  if (typeMismatches.length > 0) {
    console.log(`  âŒ TYPE MISMATCHES (${typeMismatches.length}):`);
    for (const m of typeMismatches) {
      console.log(`    ${m.column}: JAVIER=${m.javier} | DSEDAC=${m.dsedac}`);
    }
  }

  if (isMatch && missingCols.length === 0) {
    console.log(`  âœ… ALL DSEDAC columns present in JAVIER with matching types`);
  }

  return {
    match: isMatch,
    javierCount: javierCols.length,
    dsedacCount: dsedacCols.length,
    extraCols,
    missingCols,
    typeMismatches
  };
}

async function checkTableExists(connection, schema, table) {
  const query = `
    SELECT TABLE_NAME 
    FROM QSYS2.SYSTABLES 
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
  `;
  const result = await connection.query(query, [schema, table]);
  return result.length > 0;
}

async function main() {
  console.log('DB2 TABLE MIRROR VERIFICATION');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Connection: DSN=GMP, UID=JAVIER, NAM=1, CCSID=1208`);

  let connection;
  try {
    connection = await connect();
    console.log('âœ… Connected to DB2\n');
  } catch (err) {
    console.error(`âŒ Connection failed: ${err.message}`);
    process.exit(1);
  }

  const tablePairs = [
    { javier: 'REPARTIDOR_COBROS', dsedac: 'CVC', label: '1. REPARTIDOR_COBROS vs DSEDAC.CVC' },
    { javier: 'REPARTIDOR_LIQUIDACION_OPS', dsedac: 'LQD', label: '2. REPARTIDOR_LIQUIDACION_OPS vs DSEDAC.LQD' },
    { javier: 'REPARTIDOR_ENTREGAS', dsedac: 'OPP', label: '3. REPARTIDOR_ENTREGAS vs DSEDAC.OPP' },
    { javier: 'REPARTIDOR_ENTREGA_LINEAS', dsedac: 'LAC', label: '4. REPARTIDOR_ENTREGA_LINEAS vs DSEDAC.LAC' },
    { javier: 'REPARTIDOR_FIRMAS', dsedac: 'CACFIRMAS', label: '5. REPARTIDOR_FIRMAS vs DSEDAC.CACFIRMAS' },
    { javier: 'REPARTIDOR_OBJETIVOS', dsedac: 'CMV', label: '6. REPARTIDOR_OBJETIVOS vs DSEDAC.CMV' },
    { javier: 'DELIVERY_STATUS', dsedac: 'CPC', label: '7. DELIVERY_STATUS vs DSEDAC.CPC' },
    { javier: 'CLIENT_SIGNERS', dsedac: 'CLI', label: '8. CLIENT_SIGNERS vs DSEDAC.CLI' },
  ];

  const results = [];
  for (const pair of tablePairs) {
    const result = await compareTablePair(connection, pair.javier, pair.dsedac, pair.label);
    results.push({ ...pair, ...result });
  }

  // Verify existing correct tables
  console.log(`\n${'='.repeat(80)}`);
  console.log('VERIFYING EXISTING TABLES');
  console.log(`${'='.repeat(80)}`);

  const existingTables = [
    { schema: 'JAVIER', table: 'LQD', label: 'JAVIER.LQD' },
    { schema: 'JAVIER', table: 'COMM_CONFIG', label: 'JAVIER.COMM_CONFIG' },
    { schema: 'JAVIER', table: 'VENDOR_PIN_HASHES', label: 'JAVIER.VENDOR_PIN_HASHES' },
    { schema: 'JAVIER', table: 'REPARTIDOR_FINANCIAL_BALANCES', label: 'JAVIER.REPARTIDOR_FINANCIAL_BALANCES' },
    { schema: 'JAVIER', table: 'REPARTIDOR_COMMISSION_TIERS', label: 'JAVIER.REPARTIDOR_COMMISSION_TIERS' },
    { schema: 'JAVIER', table: 'REPARTIDOR_LIQUIDACION_EMAILS', label: 'JAVIER.REPARTIDOR_LIQUIDACION_EMAILS' },
  ];

  for (const t of existingTables) {
    const exists = await checkTableExists(connection, t.schema, t.table);
    console.log(`  ${exists ? 'âœ…' : 'âŒ'} ${t.label} ${exists ? 'EXISTS' : 'NOT FOUND'}`);
  }

  // Compare LQD and COMM_CONFIG if they exist in both schemas
  console.log(`\n${'='.repeat(80)}`);
  console.log('LQD CROSS-SCHEMA COMPARISON');
  console.log(`${'='.repeat(80)}`);
  await compareTablePair(connection, 'LQD', 'LQD', 'JAVIER.LQD vs DSEDAC.LQD');

  // Check if COMM_CONFIG exists in DSEDAC
  const commConfigDsedac = await checkTableExists(connection, 'DSEDAC', 'COMM_CONFIG');
  if (commConfigDsedac) {
    await compareTablePair(connection, 'COMM_CONFIG', 'COMM_CONFIG', 'JAVIER.COMM_CONFIG vs DSEDAC.COMM_CONFIG');
  } else {
    console.log(`\n  â„¹ï¸  DSEDAC.COMM_CONFIG does not exist (JAVIER-only table)`);
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('FINAL SUMMARY');
  console.log(`${'='.repeat(80)}`);

  let allMatch = true;
  for (const r of results) {
    const status = r.match && r.missingCols.length === 0 ? 'âœ…' : 'âŒ';
    console.log(`  ${status} ${r.label}`);
    if (!r.match || r.missingCols.length > 0) allMatch = false;
  }

  console.log(`\n  Total pairs compared: ${results.length}`);
  console.log(`  All matched: ${allMatch ? 'âœ… YES' : 'âŒ NO'}`);

  const totalMissing = results.reduce((sum, r) => sum + r.missingCols.length, 0);
  const totalMismatches = results.reduce((sum, r) => sum + r.typeMismatches.length, 0);
  const totalExtra = results.reduce((sum, r) => sum + r.extraCols.length, 0);

  console.log(`  Total missing columns: ${totalMissing}`);
  console.log(`  Total type mismatches: ${totalMismatches}`);
  console.log(`  Total app-only columns: ${totalExtra}`);

  await connection.close();
  console.log(`\nâœ… Verification complete.`);
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
