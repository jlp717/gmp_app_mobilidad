const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const fs = require('fs');
const path = require('path');

const DB_CONN = db2ConnectionString();

// Table pairs: [JAVIER table, DSEDAC equivalent]
const TABLE_PAIRS = [
  { javier: 'REPARTIDOR_COBROS',           dsedac: 'CVC' },
  { javier: 'REPARTIDOR_LIQUIDACION_OPS',  dsedac: 'LQD' },
  { javier: 'REPARTIDOR_ENTREGAS',         dsedac: 'OPP' },
  { javier: 'REPARTIDOR_ENTREGA_LINEAS',   dsedac: 'LAC' },
  { javier: 'REPARTIDOR_FIRMAS',           dsedac: 'CACFIRMAS' },
  { javier: 'REPARTIDOR_OBJETIVOS',        dsedac: 'CMV' },
  { javier: 'DELIVERY_STATUS',             dsedac: 'CPC' },
  { javier: 'CLIENT_SIGNERS',              dsedac: 'CLI' },
  { javier: 'COMM_CONFIG',                 dsedac: 'COMM_CONFIG' },
];

async function getColumns(conn, schema, tableName) {
  return await conn.query(`
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE, IS_NULLABLE, DEFAULT, LONG_COMMENT,
           ORDINAL_POSITION, NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}'
    ORDER BY ORDINAL_POSITION
  `);
}

function normalize(name) {
  return (name || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

function typeCompatible(jCol, dCol) {
  const jType = (jCol.DATA_TYPE || '').toUpperCase();
  const dType = (dCol.DATA_TYPE || '').toUpperCase();
  if (jType === dType) return { compatible: true, detail: 'exact type match' };

  const numericTypes = ['DECIMAL', 'NUMERIC', 'INTEGER', 'BIGINT', 'SMALLINT', 'FLOAT', 'DOUBLE', 'REAL', 'DECFLOAT', 'PACKED', 'ZONED'];
  const stringTypes = ['VARCHAR', 'CHARACTER', 'CHAR', 'CLOB', 'GRAPHIC', 'VARGRAPHIC'];
  const dateTypes = ['DATE', 'TIME', 'TIMESTAMP'];

  const jIsNumeric = numericTypes.includes(jType);
  const dIsNumeric = numericTypes.includes(dType);
  const jIsString = stringTypes.includes(jType);
  const dIsString = stringTypes.includes(dType);
  const jIsDate = dateTypes.includes(jType);
  const dIsDate = dateTypes.includes(dType);

  if (jIsNumeric && dIsNumeric) return { compatible: true, detail: `${jType} -> ${dType} (both numeric)` };
  if (jIsString && dIsString) return { compatible: true, detail: `${jType} -> ${dType} (both string)` };
  if (jIsDate && dIsDate) return { compatible: true, detail: `${jType} -> ${dType} (both date/time)` };

  return { compatible: false, detail: `${jType} vs ${dType} (incompatible)` };
}

function lengthCompatible(jCol, dCol) {
  const jLen = jCol.LENGTH || jCol.CHARACTER_MAXIMUM_LENGTH || 0;
  const dLen = dCol.LENGTH || dCol.CHARACTER_MAXIMUM_LENGTH || 0;
  if (jLen === 0 || dLen === 0) return { compatible: true, detail: 'length unknown' };
  if (jLen <= dLen) return { compatible: true, detail: `${jLen} <= ${dLen} (fits)` };
  return { compatible: false, detail: `${jLen} > ${dLen} (truncation risk)` };
}

function findBestMatch(jColName, dCols) {
  const jn = normalize(jColName);
  let bestScore = 0;
  let bestMatch = null;

  for (const dCol of dCols) {
    const dn = normalize(dCol.COLUMN_NAME);
    let score = 0;

    // Exact normalized match
    if (jn === dn) { score = 100; }
    // One contains the other
    else if (dn.includes(jn) || jn.includes(dn)) { score = 70; }
    // Levenshteish: count common chars
    else {
      let common = 0;
      for (const ch of jn) { if (dn.includes(ch)) common++; }
      score = Math.round(common / Math.max(jn.length, dn.length) * 50);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = dCol;
    }
  }

  return { match: bestMatch, score: bestScore };
}

async function analyzePair(conn, pair) {
  console.log(`\n  Analyzing JAVIER.${pair.javier} vs DSEDAC.${pair.dsedac}...`);

  const jCols = await getColumns(conn, 'JAVIER', pair.javier);
  const dCols = await getColumns(conn, 'DSEDAC', pair.dsedac);

  const result = {
    javierTable: `JAVIER.${pair.javier}`,
    dsedacTable: `DSEDAC.${pair.dsedac}`,
    javierColumnCount: jCols.length,
    dsedacColumnCount: dCols.length,
    javierColumns: [],
    dsedacColumns: [],
    columnMappings: [],
    summary: {
      exactNameMatches: 0,
      partialNameMatches: 0,
      noMatchJavier: 0,
      noMatchDsedac: 0,
      typeCompatible: 0,
      typeIncompatible: 0,
      lengthCompatible: 0,
      lengthIncompatible: 0,
      javierOnlyColumns: [],
      dsedacOnlyColumns: [],
    },
  };

  // Store raw columns
  result.javierColumns = jCols.map(c => ({
    name: c.COLUMN_NAME,
    type: c.DATA_TYPE,
    length: c.LENGTH,
    scale: c.SCALE,
    nullable: c.IS_NULLABLE,
    comment: c.LONG_COMMENT || '',
  }));

  result.dsedacColumns = dCols.map(c => ({
    name: c.COLUMN_NAME,
    type: c.DATA_TYPE,
    length: c.LENGTH,
    scale: c.SCALE,
    nullable: c.IS_NULLABLE,
    comment: c.LONG_COMMENT || '',
  }));

  const matchedDsedac = new Set();

  // Map each JAVIER column to best DSEDAC match
  for (const jCol of jCols) {
    const jn = normalize(jCol.COLUMN_NAME);
    const { match: dCol, score } = findBestMatch(jCol.COLUMN_NAME, dCols);

    if (!dCol || score < 40) {
      result.summary.noMatchJavier++;
      result.summary.javierOnlyColumns.push(jCol.COLUMN_NAME);
      result.columnMappings.push({
        javierColumn: jCol.COLUMN_NAME,
        javierType: jCol.DATA_TYPE,
        javierLength: jCol.LENGTH,
        dsedacColumn: null,
        dsedacType: null,
        dsedacLength: null,
        matchScore: 0,
        matchType: 'NO_MATCH',
        typeCompatible: null,
        lengthCompatible: null,
        recommendation: 'Column has no DSEDAC equivalent - app-only field',
      });
      continue;
    }

    const dn = normalize(dCol.COLUMN_NAME);
    matchedDsedac.add(dCol.COLUMN_NAME);

    let matchType;
    if (jn === dn) {
      matchType = 'EXACT_NAME';
      result.summary.exactNameMatches++;
    } else if (dn.includes(jn) || jn.includes(dn)) {
      matchType = 'PARTIAL_NAME';
      result.summary.partialNameMatches++;
    } else {
      matchType = 'FUZZY';
      result.summary.partialNameMatches++;
    }

    const typeCompat = typeCompatible(jCol, dCol);
    const lenCompat = lengthCompatible(jCol, dCol);

    if (typeCompat.compatible) result.summary.typeCompatible++;
    else result.summary.typeIncompatible++;

    if (lenCompat.compatible) result.summary.lengthCompatible++;
    else result.summary.lengthIncompatible++;

    result.columnMappings.push({
      javierColumn: jCol.COLUMN_NAME,
      javierType: jCol.DATA_TYPE,
      javierLength: jCol.LENGTH,
      javierScale: jCol.SCALE,
      dsedacColumn: dCol.COLUMN_NAME,
      dsedacType: dCol.DATA_TYPE,
      dsedacLength: dCol.LENGTH,
      dsedacScale: dCol.SCALE,
      matchScore: score,
      matchType,
      typeCompatible: typeCompat.compatible,
      typeDetail: typeCompat.detail,
      lengthCompatible: lenCompat.compatible,
      lengthDetail: lenCompat.detail,
      recommendation: matchType === 'EXACT_NAME' && typeCompat.compatible
        ? 'Direct mapping - safe for cutover'
        : matchType === 'EXACT_NAME'
          ? 'Name matches but type differs - verify data integrity'
          : matchType === 'PARTIAL_NAME'
            ? 'Partial name match - manual review required'
            : 'Fuzzy match - requires business validation',
    });
  }

  // Find DSEDAC columns with no JAVIER match
  for (const dCol of dCols) {
    if (!matchedDsedac.has(dCol.COLUMN_NAME)) {
      result.summary.noMatchDsedac++;
      result.summary.dsedacOnlyColumns.push(dCol.COLUMN_NAME);
    }
  }

  return result;
}

(async () => {
  console.log('=== AGENT 3: COLUMN-BY-COLUMN MAPPING ANALYSIS ===\n');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const pool = await odbc.pool(DB_CONN);
  const conn = await pool.connect();

  const report = {
    timestamp: new Date().toISOString(),
    mission: 'Column-by-column comparison for production cutover',
    tablePairs: [],
    globalSummary: {
      totalPairs: TABLE_PAIRS.length,
      successfulPairs: 0,
      failedPairs: 0,
      totalJavierColumns: 0,
      totalDsedacColumns: 0,
      totalExactMatches: 0,
      totalPartialMatches: 0,
      totalNoMatchJavier: 0,
      totalNoMatchDsedac: 0,
      warnings: [],
    },
  };

  try {
    for (const pair of TABLE_PAIRS) {
      try {
        const result = await analyzePair(conn, pair);
        report.tablePairs.push(result);
        report.globalSummary.successfulPairs++;
        report.globalSummary.totalJavierColumns += result.javierColumnCount;
        report.globalSummary.totalDsedacColumns += result.dsedacColumnCount;
        report.globalSummary.totalExactMatches += result.summary.exactNameMatches;
        report.globalSummary.totalPartialMatches += result.summary.partialNameMatches;
        report.globalSummary.totalNoMatchJavier += result.summary.noMatchJavier;
        report.globalSummary.totalNoMatchDsedac += result.summary.noMatchDsedac;

        // Warnings
        if (result.summary.typeIncompatible > 0) {
          report.globalSummary.warnings.push({
            pair: `${pair.javier} vs ${pair.dsedac}`,
            issue: `${result.summary.typeIncompatible} column(s) with incompatible types`,
          });
        }
        if (result.summary.lengthIncompatible > 0) {
          report.globalSummary.warnings.push({
            pair: `${pair.javier} vs ${pair.dsedac}`,
            issue: `${result.summary.lengthIncompatible} column(s) with length truncation risk`,
          });
        }
        if (result.summary.noMatchJavier > 0) {
          report.globalSummary.warnings.push({
            pair: `${pair.javier} vs ${pair.dsedac}`,
            issue: `${result.summary.noMatchJavier} JAVIER column(s) with no DSEDAC equivalent`,
          });
        }

        console.log(`    JAVIER: ${result.javierColumnCount} cols | DSEDAC: ${result.dsedacColumnCount} cols`);
        console.log(`    Exact: ${result.summary.exactNameMatches} | Partial: ${result.summary.partialNameMatches} | No match: ${result.summary.noMatchJavier}`);
        console.log(`    JAVIER-only: [${result.summary.javierOnlyColumns.join(', ')}]`);
        console.log(`    DSEDAC-only: [${result.summary.dsedacOnlyColumns.slice(0, 15).join(', ')}${result.summary.dsedacOnlyColumns.length > 15 ? ` ... +${result.summary.dsedacOnlyColumns.length - 15} more` : ''}]`);
      } catch (e) {
        console.log(`    ERROR: ${e.message}`);
        report.globalSummary.failedPairs++;
        report.tablePairs.push({
          javierTable: `JAVIER.${pair.javier}`,
          dsedacTable: `DSEDAC.${pair.dsedac}`,
          error: e.message,
        });
      }
    }

    // Save report
    const outDir = path.join(__dirname, 'results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'agent3-column-mapping.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`\n=== GLOBAL SUMMARY ===`);
    console.log(`Pairs analyzed: ${report.globalSummary.successfulPairs}/${report.globalSummary.totalPairs}`);
    console.log(`Total JAVIER columns: ${report.globalSummary.totalJavierColumns}`);
    console.log(`Total DSEDAC columns: ${report.globalSummary.totalDsedacColumns}`);
    console.log(`Exact name matches: ${report.globalSummary.totalExactMatches}`);
    console.log(`Partial name matches: ${report.globalSummary.totalPartialMatches}`);
    console.log(`JAVIER-only columns: ${report.globalSummary.totalNoMatchJavier}`);
    console.log(`DSEDAC-only columns: ${report.globalSummary.totalNoMatchDsedac}`);
    console.log(`Warnings: ${report.globalSummary.warnings.length}`);
    for (const w of report.globalSummary.warnings) {
      console.log(`  âš  ${w.pair}: ${w.issue}`);
    }
    console.log(`\n=== SAVED: ${outPath} ===`);
    console.log(`Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);

  } catch (e) {
    console.log('FATAL ERROR:', e.message);
    if (e.odbcErrors) console.log('ODBC Errors:', JSON.stringify(e.odbcErrors, null, 2));
  } finally {
    await conn.close();
    await pool.close();
  }
})();
