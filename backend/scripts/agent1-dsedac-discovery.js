const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const fs = require('fs');
const path = require('path');

const DB_CONN = db2ConnectionString();

const JAVIER_TABLES = [
  'REPARTIDOR_COBROS', 'REPARTIDOR_LIQUIDACION_OPS', 'REPARTIDOR_FINANCIAL_BALANCES',
  'REPARTIDOR_COMMISSION_TIERS', 'REPARTIDOR_LIQUIDACION_EMAILS', 'DELIVERY_STATUS',
  'REPARTIDOR_ENTREGAS', 'REPARTIDOR_ENTREGA_LINEAS', 'REPARTIDOR_FIRMAS',
  'REPARTIDOR_OBJETIVOS', 'COMM_CONFIG', 'COMMISSION_EXCEPTIONS',
  'COMMISSION_PAYMENTS', 'CLIENT_SIGNERS', 'RUTERO_CONFIG'
];

// ALL DSEDAC tables that are potentially relevant (from code analysis + name patterns)
const RELEVANT_DSEDAC = [
  // Core transaction tables
  'CPC', 'CAC', 'LAC', 'OPP', 'CVC', 'CVCL1', 'CACFIRMAS',
  // Client tables
  'CLI', 'CLX', 'CLP', 'CLCL1', 'CLD', 'CLE', 'CLF', 'CLH', 'CLN',
  // Vendor tables
  'VDD', 'VDC', 'VDP', 'VDX', 'VDF', 'VDE', 'VDL',
  // Liquidacion
  'LQD',
  // Quotas/Objectives
  'COFC', 'CMV', 'CMC',
  // Products/Families
  'ART', 'ARTX', 'FAM', 'FI1', 'FI2', 'FI3', 'FI4', 'FI5',
  // Vehicles/Routes
  'VEH', 'RUT', 'RUTX',
  // Payments/Collections
  'PDC', 'CPL', 'CPD', 'CDC',
  // Documents
  'FAC', 'LAF', 'COC', 'DEV', 'ABF',
  // Config/Params
  'COMM_CONFIG', 'PDC', 'PAR', 'GEN',
  // Other potentially relevant
  'LQDL1', 'LQDL2', 'LQDL3', 'LQDL4', 'LQDL5', 'LQDL6', 'LQDL7',
  'VDCX', 'VDH', 'VDM', 'VDS',
  'CPCX', 'CPCF', 'CPCL',
  'CACX', 'CACL', 'CACE',
  'LACX', 'LACF',
  'OPPX', 'OPPL',
  'CVCX', 'CVCF',
];

function normalizeCol(name) {
  return (name || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

async function getColumns(conn, schema, tableName) {
  try {
    return await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE, IS_NULLABLE, LONG_COMMENT
      FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}'
      ORDER BY ORDINAL_POSITION
    `);
  } catch (e) {
    return [];
  }
}

function colMatchScore(jCols, dCols) {
  if (!jCols.length || !dCols.length) return { score: 0, pct: 0, exactMatches: 0, partialMatches: 0 };
  const jNames = new Set(jCols.map(c => normalizeCol(c.COLUMN_NAME)));
  const dNames = new Set(dCols.map(c => normalizeCol(c.COLUMN_NAME)));
  let exact = 0, partial = 0;
  for (const jn of jNames) {
    if (dNames.has(jn)) { exact++; }
    else {
      for (const dn of dNames) {
        if (dn.includes(jn) || jn.includes(dn)) { partial++; break; }
      }
    }
  }
  const score = exact * 3 + partial;
  const max = jNames.size * 3;
  return { score, max, pct: max > 0 ? Math.round(score / max * 10000) / 100 : 0, exactMatches: exact, partialMatches: partial };
}

function findBusinessCols(dCols, patterns) {
  const names = dCols.map(c => normalizeCol(c.COLUMN_NAME));
  return patterns.filter(p => {
    const pn = normalizeCol(p);
    return names.some(n => n.includes(pn) || pn.includes(n));
  });
}

(async () => {
  console.log('=== AGENT 1: DSEDAC TABLE DISCOVERY (Optimized) ===\n');

  const pool = await odbc.pool(DB_CONN);
  const conn = await pool.connect();
  const results = { timestamp: new Date().toISOString(), javierSchemas: {}, matches: {}, deepAnalysis: {}, knownMappings: {}, summary: {} };

  try {
    // 1. Get JAVIER schemas
    console.log('[1/4] Reading JAVIER schemas...');
    for (const tbl of JAVIER_TABLES) {
      const cols = await getColumns(conn, 'JAVIER', tbl);
      results.javierSchemas[tbl] = cols.map(c => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE, length: c.LENGTH, scale: c.SCALE }));
      console.log(`  JAVIER.${tbl}: ${cols.length} cols`);
    }

    // 2. Pre-load ALL relevant DSEDAC table columns
    console.log('\n[2/4] Loading DSEDAC table columns...');
    const dsedacCols = {};
    for (const tbl of RELEVANT_DSEDAC) {
      const cols = await getColumns(conn, 'DSEDAC', tbl);
      if (cols.length > 0) {
        dsedacCols[tbl] = cols;
        console.log(`  DSEDAC.${tbl}: ${cols.length} cols`);
      }
    }
    console.log(`  Loaded ${Object.keys(dsedacCols).length} DSEDAC tables`);

    // 3. Score each JAVIER table against ALL relevant DSEDAC tables
    console.log('\n[3/4] Scoring matches...');
    const businessPatterns = {
      cobros: ['CODIGOVENDEDOR', 'IMPORTE', 'FECHA', 'COBRO', 'EFECTIVO', 'CHEQUE', 'TARJETA', 'SALDO', 'PENDIENTE'],
      liquidacion: ['LIQUID', 'DIA', 'MES', 'ANO', 'TERMINAL', 'SERIE', 'NUMERO', 'VENDEDOR', 'IMPORTE', 'GASTO', 'INGRESO'],
      commission: ['COMISION', 'PORCENTAJE', 'OBJETIVO', 'VENTAS', 'TIER', 'THRESHOLD'],
      delivery: ['FIRMA', 'OBSERVACION', 'STATUS', 'SITUACION', 'CONFORMADO', 'ENTREGA', 'LATITUD', 'LONGITUD'],
      entregas: ['ALBARAN', 'REPARTIDOR', 'CLIENTE', 'EJERCICIO', 'SERIE', 'TERMINAL', 'NUMERO', 'ORDEN']
    };

    for (const [jTable, jCols] of Object.entries(results.javierSchemas)) {
      const jColObjs = jCols.map(c => ({ COLUMN_NAME: c.name, DATA_TYPE: c.type, LENGTH: c.length, SCALE: c.scale }));
      const candidates = [];
      for (const [dTable, dCols] of Object.entries(dsedacCols)) {
        const s = colMatchScore(jColObjs, dCols);
        if (s.exactMatches > 0 || s.partialMatches > 0) {
          const allPatterns = [...businessPatterns.cobros, ...businessPatterns.liquidacion, ...businessPatterns.delivery, ...businessPatterns.entregas, ...businessPatterns.commission];
          const bizCols = findBusinessCols(dCols, allPatterns);
          candidates.push({ table: `DSEDAC.${dTable}`, ...s, businessCols: bizCols, colCount: dCols.length });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      results.matches[jTable] = { javierColCount: jCols.length, top: candidates.slice(0, 8), total: candidates.length };
      console.log(`  JAVIER.${jTable} -> ${candidates[0] ? candidates[0].table + ` (${candidates[0].pct}%, ${candidates[0].exactMatches} exact)` : 'NO MATCH'}`);
    }

    // 4. Deep analysis of key DSEDAC tables
    console.log('\n[4/4] Deep analysis of key DSEDAC tables...');
    const keyTables = ['LQD', 'CVC', 'CVCL1', 'CPC', 'CAC', 'LAC', 'OPP', 'CACFIRMAS', 'COFC', 'CMV', 'CLI', 'CLX', 'CLP', 'CLCL1', 'VDD', 'VDC', 'VEH', 'RUT', 'VDP', 'PDC', 'CPL'];
    for (const tbl of keyTables) {
      if (!dsedacCols[tbl]) continue;
      const cols = dsedacCols[tbl];
      const analysis = { colCount: cols.length, columns: cols.map(c => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE, len: c.LENGTH, scale: c.SCALE })) };
      try {
        const sample = await conn.query(`SELECT * FROM DSEDAC.${tbl} FETCH FIRST 1 ROW ONLY`);
        if (sample.length > 0) {
          // Only include key columns in sample to keep JSON small
          const keys = Object.keys(sample[0]);
          const reduced = {};
          for (const k of keys.slice(0, 20)) reduced[k] = sample[0][k];
          analysis.sample = reduced;
        }
      } catch (e) { analysis.sampleError = e.message; }
      results.deepAnalysis[tbl] = analysis;
      console.log(`  DSEDAC.${tbl}: ${cols.length} cols, sample: ${analysis.sample ? 'OK' : 'N/A'}`);
    }

    // Known mappings from code analysis
    results.knownMappings = {
      'REPARTIDOR_COBROS': { dsedac: 'DSEDAC.CVC + DSEDAC.CPC', type: 'app-write-buffer', notes: 'App writes cobros here for idempotency. Real cobros data from CVC (vencimientos) + CPC (document headers).' },
      'REPARTIDOR_LIQUIDACION_OPS': { dsedac: 'DSEDAC.LQD', type: 'app-mirror', notes: 'Mirrors DSEDAC.LQD for app tracking. LQD has 32 columns including IMPORTEEFECTIVO, IMPORTECHEQUES, IMPORTEPOSTDATADOS, IMPORTESALDOACTUAL, IMPORTETOTALAINGRESAR, IMPORTEINGRESOENBANCO, IMPORTEGASTOS, IDMARCALIQUIDACION, IMPORTETARJETA.' },
      'REPARTIDOR_FINANCIAL_BALANCES': { dsedac: 'Derived from LQD+CVC', type: 'app-computed', notes: 'No direct DSEDAC table. Balance = LQD saldo resultante + CVC pending amounts.' },
      'REPARTIDOR_COMMISSION_TIERS': { dsedac: 'DSEDAC.CMV', type: 'app-config', notes: 'Tiers hardcoded in code. CMV has IMPORTEOBJETIVO, PORCENTAJEOBJETIVO per vendor.' },
      'REPARTIDOR_LIQUIDACION_EMAILS': { dsedac: 'NONE', type: 'app-only', notes: 'Purely app-level email tracking.' },
      'DELIVERY_STATUS': { dsedac: 'DSEDAC.CPC.CONFORMADOSN + CACFIRMAS', type: 'app-realtime', notes: 'CPC.CONFORMADOSN = legacy paper status. CACFIRMAS = legacy signatures. App tracks real-time status here.' },
      'REPARTIDOR_ENTREGAS': { dsedac: 'DSEDAC.OPP + DSEDAC.CPC', type: 'app-mirror', notes: 'OPP.CODIGOREPARTIDOR links repartidor to deliveries. CPC has albaran headers.' },
      'REPARTIDOR_ENTREGA_LINEAS': { dsedac: 'DSEDAC.LAC', type: 'app-mirror', notes: 'LAC has 126 columns: CODIGOARTICULO, DESCRIPCION, CANTIDADUNIDADES, CANTIDADENVASES, IMPORTEVENTA, SECUENCIA.' },
      'REPARTIDOR_FIRMAS': { dsedac: 'DSEDAC.CACFIRMAS', type: 'app-storage', notes: 'CACFIRMAS has FIRMABASE64, FIRMANOMBRE, DIA, MES, ANO, HORA. App stores base64 + file paths.' },
      'REPARTIDOR_OBJETIVOS': { dsedac: 'DSEDAC.COFC + DSEDAC.CMV', type: 'app-config', notes: 'COFC has CUOTAENERO..CUOTADICIEMBRE. CMV has IMPORTEOBJETIVO.' },
      'COMM_CONFIG': { dsedac: 'DSEDAC.COMM_CONFIG', type: 'exact-match', notes: 'DSEDAC.COMM_CONFIG exists with 100% column match!' },
      'COMMISSION_EXCEPTIONS': { dsedac: 'NONE', type: 'app-only', notes: 'App-only vendor exclusion list.' },
      'COMMISSION_PAYMENTS': { dsedac: 'NONE', type: 'app-only', notes: 'App-only payment tracking.' },
      'CLIENT_SIGNERS': { dsedac: 'DSEDAC.CLI + CACFIRMAS', type: 'app-registry', notes: 'CLI has client data. CACFIRMAS has signature names.' },
      'RUTERO_CONFIG': { dsedac: 'DSEDAC.VDP or DSEDAC.RUT', type: 'app-config', notes: 'VDP has vendor day planning. RUT has route definitions. ORDEN>=0 filter critical.' }
    };

    results.summary = {
      totalDsedacTables: 1464,
      relevantTablesAnalyzed: Object.keys(dsedacCols).length,
      javierTablesAnalyzed: JAVIER_TABLES.length,
      exactDsedacMatches: ['DSEDAC.COMM_CONFIG', 'DSEDAC.LQD', 'DSEDAC.CVC', 'DSEDAC.CPC', 'DSEDAC.CAC', 'DSEDAC.LAC', 'DSEDAC.OPP', 'DSEDAC.CACFIRMAS', 'DSEDAC.COFC', 'DSEDAC.CMV', 'DSEDAC.CLI', 'DSEDAC.VDD', 'DSEDAC.VDC'],
      appOnlyTables: ['REPARTIDOR_LIQUIDACION_EMAILS', 'COMMISSION_EXCEPTIONS', 'COMMISSION_PAYMENTS'],
      criticalInsight: 'JAVIER tables are app-level write buffers for idempotency. Real ERP data lives in DSEDAC. App writes to JAVIER first, then syncs to DSEDAC.LQD. DO NOT delete JAVIER tables.'
    };

    // Save
    const outPath = path.join(__dirname, 'results', 'agent1-dsedac-mapping.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n=== SAVED: ${outPath} ===`);
    console.log(`Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);

  } catch (e) {
    console.log('ERROR:', e.message);
    const outPath = path.join(__dirname, 'results', 'agent1-dsedac-mapping.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  } finally {
    await conn.close();
    await pool.close();
  }
})();
