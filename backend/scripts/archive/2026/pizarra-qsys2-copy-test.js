// ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;pizarra-copy | copia puntual pizarra QSYS2 a test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Pizarra Devuelve: QSYS2 inventory + bound SELECTs + LIKE copy to JAVIER.TEST_*.
 * Never writes DSEDAC/DSED. Never prints PIN/.env. Sample copy only (not full CVC).
 *
 *   node backend/scripts/pizarra-qsys2-copy-test.js
 *   node backend/scripts/pizarra-qsys2-copy-test.js --apply
 */

const path = require('path');
const APPLY = process.argv.includes('--apply');

function loadDb() {
  const candidates = [
    path.resolve(__dirname, '../config/db'),
    '/opt/gmp-api/config/db',
    '/opt/gmp-api/backend/config/db',
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('config/db no encontrado');
}

const { initDb, closePool, query, queryWithParams } = loadDb();

function n(row, key) {
  const wanted = String(key).toUpperCase();
  for (const [k, v] of Object.entries(row || {})) {
    if (String(k).toUpperCase() === wanted) return v;
  }
  return undefined;
}
function trim(value) {
  return String(value == null ? '' : value).trim();
}
function ymd(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function addDays(iso, days) {
  if (!iso || !Number.isFinite(days)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function safe(sql, params = []) {
  try {
    return { ok: true, rows: await queryWithParams(sql, params) };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 280), rows: [] };
  }
}

function refuseErpWrite(sql) {
  const s = String(sql || '').toUpperCase().replace(/\s+/g, ' ');
  const hits = [
    /\bINSERT\s+INTO\s+DSEDAC\./,
    /\bINSERT\s+INTO\s+DSED\./,
    /\bUPDATE\s+DSEDAC\./,
    /\bUPDATE\s+DSED\./,
    /\bDELETE\s+FROM\s+DSEDAC\./,
    /\bDELETE\s+FROM\s+DSED\./,
    /\bMERGE\s+INTO\s+DSEDAC\./,
    /\bMERGE\s+INTO\s+DSED\./,
    /\bCREATE\s+TABLE\s+DSEDAC\./,
    /\bCREATE\s+TABLE\s+DSED\./,
    /\bDROP\s+TABLE\s+DSEDAC\./,
    /\bDROP\s+TABLE\s+DSED\./,
    /\bALTER\s+TABLE\s+DSEDAC\./,
    /\bALTER\s+TABLE\s+DSED\./,
    /\bTRUNCATE\s+TABLE\s+DSEDAC\./,
    /\bTRUNCATE\s+TABLE\s+DSED\./,
  ];
  if (hits.some((re) => re.test(s))) {
    throw new Error(`Refusing ERP write SQL: ${s.slice(0, 120)}`);
  }
}

function assertJavierTest(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('JAVIER.TEST_')) {
    throw new Error(`Refusing non-TEST write target: ${table}`);
  }
}

function odbcDetail(error) {
  const odbc = Array.isArray(error?.odbcErrors) ? error.odbcErrors : [];
  const first = odbc[0] || {};
  return {
    message: String(error?.message || error).slice(0, 180),
    state: first.state || error?.state || null,
    code: first.code || error?.code || null,
    native: String(first.message || '').slice(0, 220) || null,
  };
}

async function execWrite(sql) {
  refuseErpWrite(sql);
  if (!APPLY) return { ok: true, dry: true };
  try {
    await query(sql);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: odbcDetail(error) };
  }
}

async function tableInfo(schema, table) {
  const exists = await safe(
    `SELECT TABLE_TYPE, TABLE_TEXT
       FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schema, table],
  );
  if (!exists.ok) return { schema, table, error: exists.error };
  if (!(exists.rows || []).length) return { schema, table, exists: false };
  const cols = await safe(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  const count = await safe(`SELECT COUNT(*) AS N FROM ${schema}.${table}`);
  return {
    schema,
    table,
    exists: true,
    type: trim(n(exists.rows[0], 'TABLE_TYPE')),
    columns: cols.ok ? (cols.rows || []).map((row) => ({
      name: trim(n(row, 'COLUMN_NAME')),
      type: trim(n(row, 'DATA_TYPE')),
      length: n(row, 'LENGTH'),
      scale: n(row, 'NUMERIC_SCALE'),
    })) : { error: cols.error },
    count: count.ok ? Number(n(count.rows[0], 'N') || 0) : { error: count.error },
  };
}

async function findTable(name) {
  const result = await safe(
    `SELECT TRIM(TABLE_SCHEMA) AS SCHEMA, TRIM(TABLE_NAME) AS NAME, TABLE_TYPE
       FROM QSYS2.SYSTABLES
      WHERE TABLE_NAME = ?
        AND TABLE_SCHEMA IN ('DSEDAC','DSED','JAVIER','CLI')
      ORDER BY TABLE_SCHEMA
      FETCH FIRST 8 ROWS ONLY`,
    [name],
  );
  if (!result.ok) return { error: result.error };
  return (result.rows || []).map((row) => ({
    schema: trim(n(row, 'SCHEMA')),
    name: trim(n(row, 'NAME')),
    type: trim(n(row, 'TABLE_TYPE')),
  }));
}

function colNames(info) {
  return Array.isArray(info.columns) ? info.columns.map((c) => c.name) : [];
}

async function copyLikeSample({ source, dest, insertSql, note }) {
  assertJavierTest(dest);
  refuseErpWrite(insertSql);
  const destName = dest.split('.')[1];
  const existed = await tableInfo('JAVIER', destName);
  const action = { dest, source, note, existed: existed.exists === true, before: existed.count };
  if (!existed.exists) {
    const ddl = `CREATE TABLE ${dest} LIKE ${source}`;
    refuseErpWrite(ddl);
    action.create = APPLY ? 'CREATE' : 'DRY-CREATE';
    const created = await execWrite(ddl);
    action.createResult = created;
    if (!created.ok && !created.dry) return action;
  }
  const afterCreate = await tableInfo('JAVIER', destName);
  const current = typeof afterCreate.count === 'number' ? afterCreate.count : 0;
  if (current > 0) {
    action.skippedInsert = 'already has rows';
    action.after = current;
    return action;
  }
  action.insert = APPLY ? 'INSERT' : 'DRY-INSERT';
  const inserted = await execWrite(insertSql);
  action.insertResult = inserted;
  const afterInsert = await tableInfo('JAVIER', destName);
  action.after = afterInsert.count;
  return action;
}

async function seedOverlayIfEmpty({ table, countSql, insertSql }) {
  assertJavierTest(table);
  refuseErpWrite(insertSql);
  const counted = await safe(countSql);
  const count = counted.ok ? Number(n(counted.rows[0], 'N') || 0) : null;
  const action = { table, before: count };
  if (count == null) {
    action.error = counted.error;
    return action;
  }
  if (count > 0) {
    action.skipped = 'already has rows';
    action.after = count;
    return action;
  }
  action.insert = APPLY ? 'INSERT' : 'DRY-INSERT';
  action.insertResult = await execWrite(insertSql);
  const after = await safe(countSql);
  action.after = after.ok ? Number(n(after.rows[0], 'N') || 0) : after.error;
  return action;
}

async function main() {
  console.log(JSON.stringify({ mode: APPLY ? 'APPLY' : 'DRY-RUN', writes: 'JAVIER.TEST_* only' }));
  await initDb();
  const report = { mode: APPLY ? 'APPLY' : 'DRY-RUN', qsys2: {}, samples: {}, copies: [] };
  try {
    const inventoryNames = [
      'FPG', 'CVC', 'CAC', 'CPC', 'LQD', 'CLX', 'VDDX', 'LACLAE',
      'TEST_FPG', 'TEST_CVC', 'TEST_CAC', 'TEST_CPC', 'TEST_LQD', 'TEST_CLX', 'TEST_VDDX', 'TEST_LACLAE',
      'TEST_COBROS', 'TEST_PEDIDOS_CAB', 'TEST_PEDIDOS_LIN',
      'TEST_LIQUIDACION_COMERCIAL', 'TEST_DEVOLUCIONES_COMERCIAL',
      'COBROS', 'PEDIDOS_CAB',
    ];
    report.qsys2.find = {};
    for (const name of inventoryNames) {
      report.qsys2.find[name] = await findTable(name);
    }

    const fpg = await tableInfo('DSEDAC', 'FPG');
    const cvc = await tableInfo('DSEDAC', 'CVC');
    const cac = await tableInfo('DSEDAC', 'CAC');
    const cpc = await tableInfo('DSEDAC', 'CPC');
    const lqd = await tableInfo('DSEDAC', 'LQD');
    const clx = await tableInfo('DSEDAC', 'CLX');
    const vddx = await tableInfo('DSEDAC', 'VDDX');
    const laclaeHits = report.qsys2.find.LACLAE || [];
    const lacSchema = (laclaeHits.find((hit) => hit.schema === 'DSED') || laclaeHits[0] || {}).schema || 'DSED';
    const laclae = await tableInfo(lacSchema, 'LACLAE');
    report.qsys2.prod = {
      FPG: { exists: fpg.exists, count: fpg.count, cols: colNames(fpg) },
      CVC: { exists: cvc.exists, count: cvc.count, cols: colNames(cvc).filter((c) => /TIPO|SERIE|TERMINAL|NUMERO|IMPORTE|FORMA|ANO|MES|DIA|CLIENTE|VENDED|ANUL/i.test(c)) },
      CAC: { exists: cac.exists, count: cac.count, cols: colNames(cac).filter((c) => /FACTURA|ALBARAN|CLIENTE|VENDED|EJERCICIO|SERIE|TERMINAL|NUMERO/i.test(c)) },
      CPC: { exists: cpc.exists, count: cpc.count, cols: colNames(cpc).filter((c) => /ALBARAN|FACTURA|EJERCICIO|SERIE|TERMINAL|NUMERO/i.test(c)) },
      LQD: { exists: lqd.exists, count: lqd.count, cols: colNames(lqd).filter((c) => /IMPORTE|COBR|EFECT|CHEQU|POSTDAT|PAGAR|TARJ|SALDO|VENDED|ANO|MES|DIA/i.test(c)) },
      CLX: { exists: clx.exists, count: clx.count, cols: colNames(clx).filter((c) => /COBRO|RIGURO|CLIENTE/i.test(c)) },
      VDDX: { exists: vddx.exists, count: vddx.count, cols: colNames(vddx).filter((c) => /COBRO|MINIMO|VENDED/i.test(c)) },
      LACLAE: { schema: lacSchema, exists: laclae.exists, count: laclae.count, cols: colNames(laclae).filter((c) => /LCSR|LCNR|LCCD|LCTPVT|LCIM|LCAADC|LCMMDC|LCDDDC|LCCDVD/i.test(c)) },
    };

    const testNames = [
      'TEST_FPG', 'TEST_CVC', 'TEST_CAC', 'TEST_CPC', 'TEST_LQD', 'TEST_CLX', 'TEST_VDDX', 'TEST_LACLAE',
      'TEST_COBROS', 'TEST_PEDIDOS_CAB', 'TEST_PEDIDOS_LIN',
      'TEST_LIQUIDACION_COMERCIAL', 'TEST_DEVOLUCIONES_COMERCIAL',
    ];
    report.qsys2.test = {};
    for (const name of testNames) {
      const info = await tableInfo('JAVIER', name);
      report.qsys2.test[name] = {
        exists: info.exists === true,
        count: info.count,
        colCount: Array.isArray(info.columns) ? info.columns.length : 0,
        error: info.error,
      };
    }

    const fpgCatalog = await safe(
      `SELECT TRIM(CODIGOFORMAPAGO) AS CODIGO,
              TRIM(DESCRIPCIONFORMAPAGO) AS DESC,
              TRIM(PAGARESN) AS PAGARESN,
              PRIMERPAGO AS PRIMERPAGO,
              ENTREPAGOS AS ENTREPAGOS
         FROM DSEDAC.FPG
        WHERE PAGARESN = CAST(? AS CHAR(1))
           OR TRIM(CODIGOFORMAPAGO) IN (?, ?, ?, ?, ?, ?)
        ORDER BY CODIGO
        FETCH FIRST 20 ROWS ONLY`,
      ['S', 'P1', 'P2', 'P6', 'P7', 'PG', 'P0'],
    );
    report.samples.fpgPagares = fpgCatalog.ok
      ? (fpgCatalog.rows || []).map((row) => ({
        codigo: trim(n(row, 'CODIGO')),
        desc: trim(n(row, 'DESC')),
        pagaresn: trim(n(row, 'PAGARESN')),
        primerpago: n(row, 'PRIMERPAGO') == null ? null : Number(n(row, 'PRIMERPAGO')),
        entrepagos: n(row, 'ENTREPAGOS') == null ? null : Number(n(row, 'ENTREPAGOS')),
      }))
      : { error: fpgCatalog.error };

    const fpgNe30 = await safe(
      `SELECT TRIM(CODIGOFORMAPAGO) AS CODIGO,
              TRIM(DESCRIPCIONFORMAPAGO) AS DESC,
              PRIMERPAGO AS PRIMERPAGO
         FROM DSEDAC.FPG
        WHERE PAGARESN = CAST(? AS CHAR(1))
          AND PRIMERPAGO <> ?
        ORDER BY CODIGO
        FETCH FIRST 8 ROWS ONLY`,
      ['S', 30],
    );
    report.samples.fpgPrimerpagoNe30 = fpgNe30.ok
      ? (fpgNe30.rows || []).map((row) => ({
        codigo: trim(n(row, 'CODIGO')),
        desc: trim(n(row, 'DESC')),
        primerpago: Number(n(row, 'PRIMERPAGO')),
      }))
      : { error: fpgNe30.error };

    const samplePgSql = (diasOp) => `
      SELECT TRIM(COALESCE(NULLIF(TRIM(CAC.CODIGOCLIENTEFACTURA), ''), CAC.CODIGOCLIENTEALBARAN, CVC.CODIGOCLIENTEALBARAN)) AS CLIENTE,
             TRIM(CVC.TIPODOCUMENTO) AS TIPO,
             TRIM(CVC.SERIEDOCUMENTO) AS SERIE,
             CVC.TERMINALDOCUMENTO AS TERM,
             CVC.NUMERODOCUMENTO AS NUMERO,
             CVC.IMPORTEVENCIMIENTO AS IMPORTE,
             CVC.IMPORTEPENDIENTE AS PENDIENTE,
             TRIM(CVC.CODIGOFORMAPAGO) AS FP,
             TRIM(FPG.DESCRIPCIONFORMAPAGO) AS FP_DESC,
             FPG.PRIMERPAGO AS DIAS,
             TRIM(FPG.PAGARESN) AS PAGARESN,
             CVC.ANOEMISION AS ANOE, CVC.MESEMISION AS MESE, CVC.DIAEMISION AS DIAE,
             CVC.ANOVENCIMIENTO AS ANOV, CVC.MESVENCIMIENTO AS MESV, CVC.DIAVENCIMIENTO AS DIAV,
             TRIM(CAC.SERIEALBARAN) AS SERIE_ALB,
             CAC.TERMINALALBARAN AS TERM_ALB,
             CAC.NUMEROALBARAN AS NUM_ALB,
             TRIM(CPC.SERIEALBARAN) AS CPC_SERIE,
             CPC.TERMINALALBARAN AS CPC_TERM,
             CPC.NUMEROALBARAN AS CPC_NUM
        FROM DSEDAC.CVC CVC
        JOIN DSEDAC.FPG FPG
          ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
        LEFT JOIN DSEDAC.CAC CAC
          ON CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
         AND CAC.SERIEFACTURA = CVC.SERIEDOCUMENTO
         AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
         AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
        LEFT JOIN DSEDAC.CPC CPC
          ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
         AND CPC.SERIEALBARAN = CAC.SERIEALBARAN
         AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
         AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
       WHERE CVC.TIPODOCUMENTO = CAST(? AS CHAR(3))
         AND FPG.PAGARESN = CAST(? AS CHAR(1))
         AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
         AND CVC.IMPORTEPENDIENTE = 0
         AND CVC.IMPORTEVENCIMIENTO > 0
         AND FPG.PRIMERPAGO ${diasOp} ?
       ORDER BY CVC.ANOVENCIMIENTO DESC
       FETCH FIRST 2 ROWS ONLY`;

    function mapPg(row) {
      const fecha = ymd(n(row, 'ANOE'), n(row, 'MESE'), n(row, 'DIAE'));
      const vto = ymd(n(row, 'ANOV'), n(row, 'MESV'), n(row, 'DIAV'));
      const dias = Number(n(row, 'DIAS'));
      const albCac = trim(n(row, 'SERIE_ALB'))
        ? `${trim(n(row, 'SERIE_ALB'))}-${n(row, 'TERM_ALB')}-${n(row, 'NUM_ALB')}`
        : null;
      const albCpc = trim(n(row, 'CPC_SERIE'))
        ? `${trim(n(row, 'CPC_SERIE'))}-${n(row, 'CPC_TERM')}-${n(row, 'CPC_NUM')}`
        : null;
      return {
        cliente: trim(n(row, 'CLIENTE')),
        tipo: trim(n(row, 'TIPO')),
        factura: `${trim(n(row, 'SERIE'))}-${n(row, 'TERM')}-${n(row, 'NUMERO')}`,
        importe: Number(n(row, 'IMPORTE') || 0),
        pendiente: Number(n(row, 'PENDIENTE') || 0),
        fp: trim(n(row, 'FP')),
        fpDesc: trim(n(row, 'FP_DESC')),
        pagaresn: trim(n(row, 'PAGARESN')),
        primerpago: dias,
        label: `${dias} D F.Factura`,
        fecha,
        vtoCvc: vto,
        vtoCalc: addDays(fecha, dias),
        vtoMatch: vto && addDays(fecha, dias) ? vto === addDays(fecha, dias) : null,
        albaranCac: albCac,
        albaranCpc: albCpc,
      };
    }

    const pg30 = await safe(samplePgSql('='), ['PAG', 'S', 30]);
    const pgNe = await safe(samplePgSql('<>'), ['PAG', 'S', 30]);
    report.samples.pg30 = pg30.ok ? (pg30.rows || []).map(mapPg) : { error: pg30.error };
    report.samples.pgNe30 = pgNe.ok ? (pgNe.rows || []).map(mapPg) : { error: pgNe.error };

    const cvcTipos = await safe(
      `SELECT TRIM(TIPODOCUMENTO) AS TIPO, COUNT(*) AS N
         FROM DSEDAC.CVC
        WHERE TRIM(TIPODOCUMENTO) IN (?, ?, ?, ?, ?, ?, ?)
        GROUP BY TRIM(TIPODOCUMENTO)`,
      ['PAG', 'DEV', 'DV', 'FRA', 'COB', 'CAC', 'ABO'],
    );
    report.samples.cvcTipos = cvcTipos.ok
      ? (cvcTipos.rows || []).map((row) => ({ tipo: trim(n(row, 'TIPO')), n: Number(n(row, 'N') || 0) }))
      : { error: cvcTipos.error };

    const cvcDev = await safe(
      `SELECT TRIM(TIPODOCUMENTO) AS TIPO,
              TRIM(SERIEDOCUMENTO) AS SERIE,
              TERMINALDOCUMENTO AS TERM,
              NUMERODOCUMENTO AS NUMERO,
              IMPORTEVENCIMIENTO AS IMPORTE,
              IMPORTEPENDIENTE AS PENDIENTE,
              TRIM(CODIGOFORMAPAGO) AS FP,
              ANOEMISION AS Y, MESEMISION AS M, DIAEMISION AS D
         FROM DSEDAC.CVC
        WHERE TRIM(TIPODOCUMENTO) IN (?, ?)
          AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')
        ORDER BY ANOEMISION DESC, MESEMISION DESC, DIAEMISION DESC
        FETCH FIRST 2 ROWS ONLY`,
      ['DEV', 'DV'],
    );
    report.samples.cvcDev = cvcDev.ok
      ? (cvcDev.rows || []).map((row) => ({
        tipo: trim(n(row, 'TIPO')),
        doc: `${trim(n(row, 'SERIE'))}-${n(row, 'TERM')}-${n(row, 'NUMERO')}`,
        importe: Number(n(row, 'IMPORTE') || 0),
        pendiente: Number(n(row, 'PENDIENTE') || 0),
        fp: trim(n(row, 'FP')),
        fecha: ymd(n(row, 'Y'), n(row, 'M'), n(row, 'D')),
      }))
      : { error: cvcDev.error };

    const lacD = await safe(
      `SELECT TRIM(LCCDCL) AS CLIENTE, TRIM(LCCDVD) AS VD, TRIM(LCSRAB) AS SERIE,
              LCNRAB AS NUMERO, TRIM(LCTPVT) AS TIPO, LCAADC AS Y, LCMMDC AS M, LCDDDC AS D,
              SUM(LCIMVT) AS IMP, COUNT(*) AS LINES
         FROM ${lacSchema}.LACLAE
        WHERE LCSRAB = CAST(? AS CHAR(1))
        GROUP BY TRIM(LCCDCL), TRIM(LCCDVD), TRIM(LCSRAB), LCNRAB, TRIM(LCTPVT), LCAADC, LCMMDC, LCDDDC
        ORDER BY Y DESC, M DESC, D DESC
        FETCH FIRST 2 ROWS ONLY`,
      ['D'],
    );
    report.samples.laclaeD = lacD.ok
      ? (lacD.rows || []).map((row) => ({
        cliente: trim(n(row, 'CLIENTE')),
        vd: trim(n(row, 'VD')),
        doc: `${trim(n(row, 'SERIE'))}-${n(row, 'NUMERO')}`,
        tipo: trim(n(row, 'TIPO')),
        fecha: ymd(n(row, 'Y'), n(row, 'M'), n(row, 'D')),
        imp: Number(n(row, 'IMP') || 0),
        lines: Number(n(row, 'LINES') || 0),
      }))
      : { error: lacD.error };

    const lqdSample = await safe(
      `SELECT TRIM(CODIGOVENDEDOR) AS VD,
              ANOLIQUIDACION AS Y, MESLIQUIDACION AS M, DIALIQUIDACION AS D,
              IMPORTEEFECTIVO AS EFECTIVO,
              IMPORTECHEQUES AS CHEQUES,
              IMPORTEPOSTDATADOS AS POSTD,
              IMPORTESALDOACTUAL AS SALDO,
              IMPORTETOTALAINGRESAR AS A_INGRESAR,
              IMPORTEINGRESOENBANCO AS BANCO
         FROM DSEDAC.LQD
        WHERE IMPORTETOTALAINGRESAR <> 0
        ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC
        FETCH FIRST 2 ROWS ONLY`,
    );
    report.samples.lqd = lqdSample.ok
      ? (lqdSample.rows || []).map((row) => ({
        vd: trim(n(row, 'VD')),
        fecha: ymd(n(row, 'Y'), n(row, 'M'), n(row, 'D')),
        efectivo: Number(n(row, 'EFECTIVO') || 0),
        cheques: Number(n(row, 'CHEQUES') || 0),
        postdatados: Number(n(row, 'POSTD') || 0),
        saldo: Number(n(row, 'SALDO') || 0),
        aIngresar: Number(n(row, 'A_INGRESAR') || 0),
        banco: Number(n(row, 'BANCO') || 0),
      }))
      : { error: lqdSample.error };

    const clxMin = await safe(
      `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE,
              TRIM(COBRORIGUROSOSN) AS SN,
              PORCENTAJECOBRORIGUROSO AS PCT
         FROM DSEDAC.CLX
        WHERE COBRORIGUROSOSN = CAST(? AS CHAR(1))
        FETCH FIRST 2 ROWS ONLY`,
      ['S'],
    );
    report.samples.clx = clxMin.ok
      ? (clxMin.rows || []).map((row) => ({
        cliente: trim(n(row, 'CLIENTE')),
        sn: trim(n(row, 'SN')),
        pct: Number(n(row, 'PCT') || 0),
      }))
      : { error: clxMin.error };

    const vddxMin = await safe(
      `SELECT TRIM(CODIGOVENDEDOR) AS VD, PORCENTAJEMINIMOCOBRO AS PCT
         FROM DSEDAC.VDDX
        WHERE PORCENTAJEMINIMOCOBRO > 0
        FETCH FIRST 2 ROWS ONLY`,
    );
    report.samples.vddx = vddxMin.ok
      ? (vddxMin.rows || []).map((row) => ({
        vd: trim(n(row, 'VD')),
        pct: Number(n(row, 'PCT') || 0),
      }))
      : { error: vddxMin.error };

    const albP2 = await safe(
      `SELECT TRIM(SERIEALBARAN) AS SERIE, TERMINALALBARAN AS TERM, NUMEROALBARAN AS NUMERO
         FROM DSEDAC.CAC
        WHERE TRIM(SERIEALBARAN) = CAST(? AS CHAR(1))
          AND TERMINALALBARAN = ?
        FETCH FIRST 2 ROWS ONLY`,
      ['P', 2],
    );
    report.samples.albaranP2 = albP2.ok
      ? (albP2.rows || []).map((row) => ({
        albaran: `${trim(n(row, 'SERIE'))}-${n(row, 'TERM')}-${n(row, 'NUMERO')}`,
      }))
      : { error: albP2.error };

    const albP15 = await safe(
      `SELECT TRIM(SERIEALBARAN) AS SERIE, TERMINALALBARAN AS TERM, NUMEROALBARAN AS NUMERO
         FROM DSEDAC.CAC
        WHERE TRIM(SERIEALBARAN) = CAST(? AS CHAR(1))
          AND TERMINALALBARAN = ?
        FETCH FIRST 2 ROWS ONLY`,
      ['P', 15],
    );
    report.samples.albaranP15 = albP15.ok
      ? (albP15.rows || []).map((row) => ({
        albaran: `${trim(n(row, 'SERIE'))}-${n(row, 'TERM')}-${n(row, 'NUMERO')}`,
      }))
      : { error: albP15.error };

    report.copies.push(await copyLikeSample({
      source: 'DSEDAC.FPG',
      dest: 'JAVIER.TEST_FPG',
      note: 'catalogo formas de pago (entero, pequeño)',
      insertSql: `INSERT INTO JAVIER.TEST_FPG SELECT * FROM DSEDAC.FPG`,
    }));
    report.copies.push(await copyLikeSample({
      source: 'DSEDAC.VDDX',
      dest: 'JAVIER.TEST_VDDX',
      note: 'minimo cobro vendedor',
      insertSql: `INSERT INTO JAVIER.TEST_VDDX SELECT * FROM DSEDAC.VDDX`,
    }));
    report.copies.push(await copyLikeSample({
      source: 'DSEDAC.CLX',
      dest: 'JAVIER.TEST_CLX',
      note: 'muestra cobro riguroso',
      insertSql: `INSERT INTO JAVIER.TEST_CLX
        SELECT * FROM DSEDAC.CLX
         WHERE COBRORIGUROSOSN = 'S'
         FETCH FIRST 40 ROWS ONLY`,
    }));
    report.copies.push(await copyLikeSample({
      source: 'DSEDAC.CVC',
      dest: 'JAVIER.TEST_CVC',
      note: 'muestra PAG cobrado; no dump 70k',
      insertSql: `INSERT INTO JAVIER.TEST_CVC
        SELECT * FROM DSEDAC.CVC
         WHERE TIPODOCUMENTO = 'PAG'
           AND IMPORTEPENDIENTE = 0
           AND IMPORTEVENCIMIENTO > 0
           AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')
         FETCH FIRST 40 ROWS ONLY`,
    }));
    report.copies.push(await copyLikeSample({
      source: 'DSEDAC.CAC',
      dest: 'JAVIER.TEST_CAC',
      note: 'albaran-factura ligados a TEST_CVC si existe, si no muestra P',
      insertSql: `INSERT INTO JAVIER.TEST_CAC
        SELECT * FROM DSEDAC.CAC
         WHERE TRIM(SERIEALBARAN) = 'P'
         FETCH FIRST 40 ROWS ONLY`,
    }));
    report.copies.push(await copyLikeSample({
      source: 'DSEDAC.CPC',
      dest: 'JAVIER.TEST_CPC',
      note: 'muestra albaranes P',
      insertSql: `INSERT INTO JAVIER.TEST_CPC
        SELECT * FROM DSEDAC.CPC
         WHERE TRIM(SERIEALBARAN) = 'P'
         FETCH FIRST 40 ROWS ONLY`,
    }));
    report.copies.push(await copyLikeSample({
      source: 'DSEDAC.LQD',
      dest: 'JAVIER.TEST_LQD',
      note: 'muestra liquidacion vendedor',
      insertSql: `INSERT INTO JAVIER.TEST_LQD
        SELECT * FROM DSEDAC.LQD
         WHERE IMPORTETOTALAINGRESAR <> 0
         FETCH FIRST 30 ROWS ONLY`,
    }));
    report.copies.push(await copyLikeSample({
      source: `${lacSchema}.LACLAE`,
      dest: 'JAVIER.TEST_LACLAE',
      note: 'muestra serie D devolucion historica',
      insertSql: `INSERT INTO JAVIER.TEST_LACLAE
        SELECT * FROM ${lacSchema}.LACLAE
         WHERE LCSRAB = 'D'
         FETCH FIRST 40 ROWS ONLY`,
    }));

    const cobrosSrc = await tableInfo('JAVIER', 'COBROS');
    if (cobrosSrc.exists) {
      report.copies.push(await copyLikeSample({
        source: 'JAVIER.COBROS',
        dest: 'JAVIER.TEST_COBROS',
        note: 'isomorfa app writes',
        insertSql: `INSERT INTO JAVIER.TEST_COBROS
          SELECT * FROM JAVIER.COBROS
           FETCH FIRST 20 ROWS ONLY`,
      }));
    }
    const pedSrc = await tableInfo('JAVIER', 'PEDIDOS_CAB');
    if (pedSrc.exists) {
      report.copies.push(await copyLikeSample({
        source: 'JAVIER.PEDIDOS_CAB',
        dest: 'JAVIER.TEST_PEDIDOS_CAB',
        note: 'isomorfa app writes',
        insertSql: `INSERT INTO JAVIER.TEST_PEDIDOS_CAB
          SELECT * FROM JAVIER.PEDIDOS_CAB
           FETCH FIRST 20 ROWS ONLY`,
      }));
    }
    const linSrc = await tableInfo('JAVIER', 'PEDIDOS_LIN');
    if (linSrc.exists) {
      report.copies.push(await copyLikeSample({
        source: 'JAVIER.PEDIDOS_LIN',
        dest: 'JAVIER.TEST_PEDIDOS_LIN',
        note: 'isomorfa app writes',
        insertSql: `INSERT INTO JAVIER.TEST_PEDIDOS_LIN
          SELECT * FROM JAVIER.PEDIDOS_LIN
           FETCH FIRST 40 ROWS ONLY`,
      }));
    }

    report.copies.push(await seedOverlayIfEmpty({
      table: 'JAVIER.TEST_LIQUIDACION_COMERCIAL',
      countSql: 'SELECT COUNT(*) AS N FROM JAVIER.TEST_LIQUIDACION_COMERCIAL',
      insertSql: `INSERT INTO JAVIER.TEST_LIQUIDACION_COMERCIAL
        (CODIGO_VENDEDOR, FECHA, INGRESO_BANCO, ENTREGADO, TOTAL_ESPERADO,
         TOTAL_EFECTIVO, TOTAL_CHEQUES, TOTAL_POSTDATADOS, SALDO_ACTUAL,
         DEVOLUCIONES_YA_COBRADAS, TOTAL_A_INGRESAR, STATUS, IDEMPOTENCY_TOKEN, CREATED_BY)
        VALUES ('80', DATE('2026-05-31'), 0, 0, 1000, 0, 0, 1000, 0, 1000, 1000, 'SAVED',
                'pizarra-liq-20260531-80', 'HIT')`,
    }));
    report.copies.push(await seedOverlayIfEmpty({
      table: 'JAVIER.TEST_DEVOLUCIONES_COMERCIAL',
      countSql: 'SELECT COUNT(*) AS N FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL',
      insertSql: `INSERT INTO JAVIER.TEST_DEVOLUCIONES_COMERCIAL
        (SERIE, NUMERO, CLIENTE, VENDEDOR, FECHA, IMPORTE, UNIDADES, DOCUMENTO_ORIGEN,
         YA_COBRADA, FORMA_PAGO, ALBARAN_ORIGEN, VENCIMIENTO, IMPACTO_LQD, FORMA_PAGO_DIAS,
         IDEMPOTENCY_TOKEN, CREATED_BY)
        VALUES ('D', 1, '4300000001', '80', DATE('2026-05-31'), -1000, 0, 'F-1',
                1, 'PG', 'P-2-1', DATE('2026-08-31'), 'YA_COBRADOS', 30,
                'pizarra-dev-20260531-80', 'HIT')`,
    }));

    report.qsys2.testAfter = {};
    for (const name of testNames) {
      const info = await tableInfo('JAVIER', name);
      report.qsys2.testAfter[name] = {
        exists: info.exists === true,
        count: info.count,
        error: info.error,
      };
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
