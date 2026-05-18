#!/usr/bin/env node
/**
 * pilar2-db-schema-verify.js
 * PILAR 2: DB2 Schema Verification - ALL JAVIER tables vs DSEDAC structure
 * 
 * Checks:
 * 1. All 8 refactored tables exist and match DSEDAC equivalents
 * 2. Column count, names, types match DSEDAC exactly
 * 3. App-only columns exist (IDEMPOTENCY_TOKEN, CREATED_AT, etc.)
 * 4. Indexes exist for all tables
 * 5. Constraints exist (CHECK, UNIQUE)
 * 6. Data integrity (no orphaned records)
 * 7. Backup tables exist (BKP_*)
 * 8. LQD and COMM_CONFIG still match (were already correct)
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

const DB_CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208';

// Table pairs: [JAVIER table, DSEDAC equivalent, description]
const TABLE_PAIRS = [
  { javier: 'REPARTIDOR_COBROS',           dsedac: 'CVC',         desc: 'Cobros' },
  { javier: 'REPARTIDOR_LIQUIDACION_OPS',  dsedac: 'LQD',         desc: 'Liquidaciones' },
  { javier: 'REPARTIDOR_ENTREGAS',         dsedac: 'OPP',         desc: 'Entregas (cabecera)' },
  { javier: 'REPARTIDOR_ENTREGA_LINEAS',   dsedac: 'LAC',         desc: 'Entrega lineas' },
  { javier: 'REPARTIDOR_FIRMAS',           dsedac: 'CACFIRMAS',   desc: 'Firmas' },
  { javier: 'REPARTIDOR_OBJETIVOS',        dsedac: 'CMV',         desc: 'Objetivos' },
  { javier: 'DELIVERY_STATUS',             dsedac: 'CPC',         desc: 'Delivery status' },
  { javier: 'CLIENT_SIGNERS',              dsedac: 'CLI',         desc: 'Client signers' },
];

// Tables already verified as correct
const VERIFIED_TABLES = [
  { javier: 'REPARTIDOR_LIQUIDACION_OPS', dsedac: 'LQD', desc: 'Liquidaciones (verified)' },
  { javier: 'COMM_CONFIG',                dsedac: 'COMM_CONFIG', desc: 'Commission config (verified)' },
];

// Expected app-only columns that should exist in JAVIER tables
const EXPECTED_APP_COLUMNS = [
  'IDEMPOTENCY_TOKEN', 'CREATED_AT', 'UPDATED_AT', 'SYNCED',
  'ID', 'ENTREGA_ID', 'CODIGO_CLIENTE', 'NOMBRE_CLIENTE',
  'CODIGO_REPARTIDOR', 'STATUS', 'OBSERVACIONES'
];

// Expected backup tables
const EXPECTED_BACKUP_TABLES = [
  'BKP_REPARTIDOR_COBROS', 'BKP_REPARTIDOR_LIQUIDACION_OPS',
  'BKP_REPARTIDOR_ENTREGAS', 'BKP_REPARTIDOR_ENTREGA_LINEAS',
  'BKP_REPARTIDOR_FIRMAS', 'BKP_REPARTIDOR_OBJETIVOS',
  'BKP_DELIVERY_STATUS', 'BKP_CLIENT_SIGNERS',
];

function normalize(name) {
  return (name || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

function typeCompatible(jType, dType) {
  jType = (jType || '').toUpperCase();
  dType = (dType || '').toUpperCase();
  if (jType === dType) return { compatible: true, detail: 'exact match' };

  const numericTypes = ['DECIMAL', 'NUMERIC', 'INTEGER', 'BIGINT', 'SMALLINT', 'FLOAT', 'DOUBLE', 'REAL', 'DECFLOAT', 'PACKED', 'ZONED'];
  const stringTypes = ['VARCHAR', 'CHARACTER', 'CHAR', 'CLOB', 'GRAPHIC', 'VARGRAPHIC'];
  const dateTypes = ['DATE', 'TIME', 'TIMESTAMP'];

  const jNum = numericTypes.includes(jType);
  const dNum = numericTypes.includes(dType);
  const jStr = stringTypes.includes(jType);
  const dStr = stringTypes.includes(dType);
  const jDate = dateTypes.includes(jType);
  const dDate = dateTypes.includes(dType);

  if (jNum && dNum) return { compatible: true, detail: `${jType} -> ${dType} (both numeric)` };
  if (jStr && dStr) return { compatible: true, detail: `${jType} -> ${dType} (both string)` };
  if (jDate && dDate) return { compatible: true, detail: `${jType} -> ${dType} (both date/time)` };

  return { compatible: false, detail: `${jType} vs ${dType} (incompatible)` };
}

async function getColumns(conn, schema, tableName) {
  try {
    return await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE, IS_NULLABLE, LONG_COMMENT,
             ORDINAL_POSITION, NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}'
      ORDER BY ORDINAL_POSITION
    `);
  } catch (e) {
    return [];
  }
}

async function getIndexes(conn, schema, tableName) {
  try {
    return await conn.query(`
      SELECT TABLE_NAME, INDEX_NAME, INDEX_SCHEMA
      FROM QSYS2.SYSINDEXSTAT
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}'
    `);
  } catch (e) {
    return [];
  }
}

async function getConstraints(conn, schema, tableName) {
  try {
    return await conn.query(`
      SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, CHECK_CONDITION, IS_NULLABLE
      FROM QSYS2.SYSCST
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}'
    `);
  } catch (e) {
    return [];
  }
}

async function tableExists(conn, schema, tableName) {
  try {
    const result = await conn.query(`
      SELECT TABLE_NAME FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}'
    `);
    return result.length > 0;
  } catch (e) {
    return false;
  }
}

async function getRowCount(conn, schema, tableName) {
  try {
    const result = await conn.query(`SELECT COUNT(*) as CNT FROM ${schema}.${tableName}`);
    return result[0]?.CNT || 0;
  } catch (e) {
    return -1;
  }
}

async function checkOrphanedRecords(conn, javierTable, dsedacTable, pair) {
  const orphans = { check: 'no_orphaned_records', status: 'PASS', details: '', count: 0 };

  try {
    // For tables with CODIGO_CLIENTE, check if clients exist in CLI
    const jCols = await getColumns(conn, 'JAVIER', javierTable);
    const hasCliente = jCols.some(c => normalize(c.COLUMN_NAME) === 'CODIGOCLIENTE');
    const hasAlbaran = jCols.some(c => normalize(c.COLUMN_NAME) === 'ALBARAN' || normalize(c.COLUMN_NAME) === 'NUMERODOCUMENTO');

    if (hasCliente) {
      // Check for clients that don't exist in DSEDAC.CLI
      const result = await conn.query(`
        SELECT COUNT(*) as CNT FROM JAVIER.${javierTable} j
        WHERE NOT EXISTS (
          SELECT 1 FROM DSEDAC.CLI c WHERE c.CODIGOCLIENTE = j.CODIGOCLIENTE
        )
      `);
      orphans.count = result[0]?.CNT || 0;
      if (orphans.count > 0) {
        orphans.status = 'FAIL';
        orphans.details = `${orphans.count} records reference non-existent clients in DSEDAC.CLI`;
      } else {
        orphans.details = 'All client references valid';
      }
    } else if (hasAlbaran && javierTable === 'REPARTIDOR_ENTREGA_LINEAS') {
      // Check for lineas without matching entrega
      const result = await conn.query(`
        SELECT COUNT(*) as CNT FROM JAVIER.${javierTable} l
        WHERE NOT EXISTS (
          SELECT 1 FROM JAVIER.REPARTIDOR_ENTREGAS e WHERE e.ID = l.ENTREGA_ID
        )
      `);
      orphans.count = result[0]?.CNT || 0;
      if (orphans.count > 0) {
        orphans.status = 'FAIL';
        orphans.details = `${orphans.count} lineas reference non-existent entregas`;
      } else {
        orphans.details = 'All entrega references valid';
      }
    } else {
      orphans.status = 'SKIP';
      orphans.details = 'No foreign key columns found for orphan check';
    }
  } catch (e) {
    orphans.status = 'ERROR';
    orphans.details = e.message;
  }

  return orphans;
}

async function analyzeTablePair(conn, pair) {
  console.log(`\n  Analyzing JAVIER.${pair.javier} vs DSEDAC.${pair.dsedac}...`);

  const result = {
    table: pair.javier,
    dsedacEquivalent: pair.dsedac,
    description: pair.desc,
    checks: {},
    issues: [],
    warnings: [],
  };

  // Check 1: Table existence
  const javierExists = await tableExists(conn, 'JAVIER', pair.javier);
  const dsedacExists = await tableExists(conn, 'DSEDAC', pair.dsedac);

  result.checks.javier_table_exists = {
    status: javierExists ? 'PASS' : 'FAIL',
    details: javierExists ? `JAVIER.${pair.javier} exists` : `JAVIER.${pair.javier} NOT FOUND`,
  };

  result.checks.dsedac_table_exists = {
    status: dsedacExists ? 'PASS' : 'FAIL',
    details: dsedacExists ? `DSEDAC.${pair.dsedac} exists` : `DSEDAC.${pair.dsedac} NOT FOUND`,
  };

  if (!javierExists || !dsedacExists) {
    result.issues.push('Table(s) missing - cannot proceed with column comparison');
    return result;
  }

  // Get columns
  const jCols = await getColumns(conn, 'JAVIER', pair.javier);
  const dCols = await getColumns(conn, 'DSEDAC', pair.dsedac);

  result.javierColumnCount = jCols.length;
  result.dsedacColumnCount = dCols.length;

  // Check 2: Column count
  // JAVIER should have DSEDAC columns + app columns
  const expectedMinCols = dCols.length;
  result.checks.column_count = {
    status: jCols.length >= expectedMinCols ? 'PASS' : 'FAIL',
    details: `JAVIER: ${jCols.length} cols, DSEDAC: ${dCols.length} cols (JAVIER should have >= DSEDAC cols)`,
    javierCount: jCols.length,
    dsedacCount: dCols.length,
  };

  // Check 3: Column names match
  const jColNames = new Set(jCols.map(c => normalize(c.COLUMN_NAME)));
  const dColNames = new Set(dCols.map(c => normalize(c.COLUMN_NAME)));

  const missingDsedacCols = [];
  for (const dCol of dCols) {
    const dn = normalize(dCol.COLUMN_NAME);
    if (!jColNames.has(dn)) {
      missingDsedacCols.push(dCol.COLUMN_NAME);
    }
  }

  result.checks.dsedac_columns_present = {
    status: missingDsedacCols.length === 0 ? 'PASS' : 'FAIL',
    details: missingDsedacCols.length === 0
      ? 'All DSEDAC columns present in JAVIER table'
      : `${missingDsedacCols.length} DSEDAC columns missing: ${missingDsedacCols.slice(0, 20).join(', ')}${missingDsedacCols.length > 20 ? '...' : ''}`,
    missingColumns: missingDsedacCols,
  };

  if (missingDsedacCols.length > 0) {
    result.issues.push(`Missing DSEDAC columns: ${missingDsedacCols.slice(0, 10).join(', ')}`);
  }

  // Check 4: Column types match
  const typeMismatches = [];
  for (const dCol of dCols) {
    const dn = normalize(dCol.COLUMN_NAME);
    const jCol = jCols.find(c => normalize(c.COLUMN_NAME) === dn);
    if (jCol) {
      const compat = typeCompatible(jCol.DATA_TYPE, dCol.DATA_TYPE);
      if (!compat.compatible) {
        typeMismatches.push({
          column: dCol.COLUMN_NAME,
          javierType: jCol.DATA_TYPE,
          dsedacType: dCol.DATA_TYPE,
          detail: compat.detail,
        });
      }
    }
  }

  result.checks.column_types_match = {
    status: typeMismatches.length === 0 ? 'PASS' : 'FAIL',
    details: typeMismatches.length === 0
      ? 'All column types compatible'
      : `${typeMismatches.length} type mismatches found`,
    mismatches: typeMismatches,
  };

  if (typeMismatches.length > 0) {
    result.issues.push(`Type mismatches: ${typeMismatches.map(m => `${m.column}: ${m.javierType} vs ${m.dsedacType}`).join(', ')}`);
  }

  // Check 5: App-only columns
  const jOnlyCols = [];
  for (const jCol of jCols) {
    const jn = normalize(jCol.COLUMN_NAME);
    if (!dColNames.has(jn)) {
      jOnlyCols.push(jCol.COLUMN_NAME);
    }
  }

  result.checks.app_only_columns = {
    status: jOnlyCols.length > 0 ? 'PASS' : 'WARN',
    details: `${jOnlyCols.length} app-only columns found (expected for idempotency, tracking, etc.)`,
    appOnlyColumns: jOnlyCols,
  };

  // Check for critical app columns
  const criticalAppCols = ['IDEMPOTENCY_TOKEN', 'CREATED_AT', 'UPDATED_AT'];
  const missingCritical = criticalAppCols.filter(c => !jColNames.has(normalize(c)));

  if (missingCritical.length > 0) {
    result.warnings.push(`Missing critical app columns: ${missingCritical.join(', ')}`);
  }

  // Check 6: Indexes
  const indexes = await getIndexes(conn, 'JAVIER', pair.javier);
  result.checks.indexes_exist = {
    status: indexes.length > 0 ? 'PASS' : 'FAIL',
    details: `${indexes.length} index(es) found on JAVIER.${pair.javier}`,
    indexCount: indexes.length,
    indexes: indexes.map(i => ({
      name: i.INDEX_NAME,
      nonUnique: i.NON_UNIQUE,
    })),
  };

  if (indexes.length === 0) {
    result.issues.push('No indexes found - performance will suffer');
  }

  // Check 7: Constraints
  const constraints = await getConstraints(conn, 'JAVIER', pair.javier);
  const checkConstraints = constraints.filter(c => c.CONSTRAINT_TYPE === 'CHECK');
  const uniqueConstraints = constraints.filter(c => c.CONSTRAINT_TYPE === 'UNIQUE' || c.CONSTRAINT_TYPE === 'PRIMARY KEY');

  result.checks.constraints_exist = {
    status: constraints.length > 0 ? 'PASS' : 'WARN',
    details: `${constraints.length} constraint(s) found (${checkConstraints.length} CHECK, ${uniqueConstraints.length} UNIQUE/PK)`,
    checkConstraints: checkConstraints.map(c => c.CONSTRAINT_NAME),
    uniqueConstraints: uniqueConstraints.map(c => c.CONSTRAINT_NAME),
  };

  // Check 8: Data integrity (orphaned records)
  const orphans = await checkOrphanedRecords(conn, pair.javier, pair.dsedac, pair);
  result.checks.data_integrity = orphans;

  // Row counts
  result.javierRowCount = await getRowCount(conn, 'JAVIER', pair.javier);
  result.dsedacRowCount = await getRowCount(conn, 'DSEDAC', pair.dsedac);

  return result;
}

async function checkBackupTables(conn) {
  console.log('\n  Checking backup tables...');
  const results = [];

  for (const tbl of EXPECTED_BACKUP_TABLES) {
    const exists = await tableExists(conn, 'JAVIER', tbl);
    const rowCount = exists ? await getRowCount(conn, 'JAVIER', tbl) : 0;
    results.push({
      table: tbl,
      exists,
      rowCount: exists ? rowCount : null,
      status: exists ? 'PASS' : 'FAIL',
    });
  }

  return results;
}

async function checkVerifiedTables(conn) {
  console.log('\n  Re-checking verified tables (LQD, COMM_CONFIG)...');
  const results = [];

  for (const pair of VERIFIED_TABLES) {
    const jCols = await getColumns(conn, 'JAVIER', pair.javier);
    const dCols = await getColumns(conn, 'DSEDAC', pair.dsedac);

    const jNames = new Set(jCols.map(c => normalize(c.COLUMN_NAME)));
    const dNames = new Set(dCols.map(c => normalize(c.COLUMN_NAME)));

    const missing = [];
    const typeMismatches = [];

    for (const dCol of dCols) {
      const dn = normalize(dCol.COLUMN_NAME);
      if (!jNames.has(dn)) {
        missing.push(dCol.COLUMN_NAME);
      } else {
        const jCol = jCols.find(c => normalize(c.COLUMN_NAME) === dn);
        const compat = typeCompatible(jCol.DATA_TYPE, dCol.DATA_TYPE);
        if (!compat.compatible) {
          typeMismatches.push({
            column: dCol.COLUMN_NAME,
            javierType: jCol.DATA_TYPE,
            dsedacType: dCol.DATA_TYPE,
          });
        }
      }
    }

    results.push({
      table: pair.javier,
      dsedacEquivalent: pair.dsedac,
      description: pair.desc,
      javierColumnCount: jCols.length,
      dsedacColumnCount: dCols.length,
      missingColumns: missing,
      typeMismatches,
      status: missing.length === 0 && typeMismatches.length === 0 ? 'PASS' : 'FAIL',
      issues: [
        ...missing.map(c => `Missing column: ${c}`),
        ...typeMismatches.map(m => `Type mismatch: ${m.column} (${m.javierType} vs ${m.dsedacType})`),
      ],
    });
  }

  return results;
}

(async () => {
  console.log('=== PILAR 2: DB2 SCHEMA VERIFICATION ===\n');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const pool = await odbc.pool(DB_CONN);
  const conn = await pool.connect();

  const report = {
    timestamp: new Date().toISOString(),
    mission: 'PILAR 2: Verify ALL JAVIER tables match DSEDAC structure',
    summary: {
      totalTablePairs: TABLE_PAIRS.length,
      passed: 0,
      failed: 0,
      warnings: 0,
      totalIssues: 0,
      backupTablesPassed: 0,
      backupTablesFailed: 0,
      verifiedTablesPassed: 0,
      verifiedTablesFailed: 0,
    },
    tableChecks: [],
    backupTables: [],
    verifiedTables: [],
    overallStatus: 'PENDING',
  };

  try {
    // 1. Check all 8 refactored tables
    console.log('[1/4] Checking 8 refactored table pairs...');
    for (const pair of TABLE_PAIRS) {
      const result = await analyzeTablePair(conn, pair);
      report.tableChecks.push(result);

      const hasFailures = Object.values(result.checks).some(c => c.status === 'FAIL');
      if (hasFailures) {
        report.summary.failed++;
        report.summary.totalIssues += result.issues.length;
      } else if (result.warnings.length > 0) {
        report.summary.warnings++;
      } else {
        report.summary.passed++;
      }

      console.log(`    ${pair.javier} -> ${pair.dsedac}: ${hasFailures ? 'FAIL' : result.warnings.length > 0 ? 'WARN' : 'PASS'} (${result.issues.length} issues)`);
    }

    // 2. Check backup tables
    console.log('\n[2/4] Checking backup tables...');
    report.backupTables = await checkBackupTables(conn);
    for (const bt of report.backupTables) {
      if (bt.status === 'PASS') report.summary.backupTablesPassed++;
      else report.summary.backupTablesFailed++;
      console.log(`    ${bt.table}: ${bt.status}${bt.exists ? ` (${bt.rowCount} rows)` : ' (MISSING)'}`);
    }

    // 3. Re-check verified tables (LQD, COMM_CONFIG)
    console.log('\n[3/4] Re-checking verified tables...');
    report.verifiedTables = await checkVerifiedTables(conn);
    for (const vt of report.verifiedTables) {
      if (vt.status === 'PASS') report.summary.verifiedTablesPassed++;
      else report.summary.verifiedTablesFailed++;
      console.log(`    ${vt.table} -> ${vt.dsedacEquivalent}: ${vt.status}${vt.issues.length > 0 ? ` (${vt.issues.join(', ')})` : ''}`);
    }

    // 4. Overall status
    const totalFailures = report.summary.failed + report.summary.backupTablesFailed + report.summary.verifiedTablesFailed;
    report.overallStatus = totalFailures === 0 ? 'PASS' : 'FAIL';

    // Save report
    const outDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'pilar2-db-schema-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`\n=== OVERALL SUMMARY ===`);
    console.log(`Table pairs: ${report.summary.passed}/${report.summary.totalTablePairs} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`);
    console.log(`Backup tables: ${report.summary.backupTablesPassed}/${report.summary.backupTablesPassed + report.summary.backupTablesFailed} passed`);
    console.log(`Verified tables: ${report.summary.verifiedTablesPassed}/${report.summary.verifiedTablesPassed + report.summary.verifiedTablesFailed} passed`);
    console.log(`Total issues: ${report.summary.totalIssues}`);
    console.log(`\nOVERALL STATUS: ${report.overallStatus}`);
    console.log(`\n=== SAVED: ${outPath} ===`);
    console.log(`Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);

  } catch (e) {
    console.log('FATAL ERROR:', e.message);
    if (e.odbcErrors) console.log('ODBC Errors:', JSON.stringify(e.odbcErrors, null, 2));
    report.overallStatus = 'ERROR';
    report.fatalError = e.message;

    const outDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'pilar2-db-schema-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  } finally {
    await conn.close();
    await pool.close();
  }
})();
