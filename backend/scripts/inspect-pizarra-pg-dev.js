'use strict';

/**
 * Read-only inventory for the commercial pizarra flow (PG already-collected → Devuelve → LIQ.Vd).
 * Never writes. Never dumps PIN/secrets. SQL always bound.
 *
 *   node backend/scripts/inspect-pizarra-pg-dev.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, queryWithParams } = require('../config/db');

function col(row, name) {
  const wanted = String(name).toUpperCase();
  for (const [key, value] of Object.entries(row || {})) {
    if (String(key).toUpperCase() === wanted) return value;
  }
  return undefined;
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

async function tableExists(schema, table) {
  const rows = await queryWithParams(
    `SELECT TABLE_NAME, TABLE_TYPE
       FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schema, table],
  );
  return rows?.[0] ? { ok: true, type: trim(col(rows[0], 'TABLE_TYPE')) } : { ok: false, type: null };
}

async function columnsOf(schema, table) {
  const rows = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME, TRIM(DATA_TYPE) AS DATA_TYPE, LENGTH, NUMERIC_SCALE
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return (rows || []).map((row) => ({
    name: trim(col(row, 'COLUMN_NAME')),
    type: trim(col(row, 'DATA_TYPE')),
    length: Number(col(row, 'LENGTH') || 0),
    scale: col(row, 'NUMERIC_SCALE') == null ? null : Number(col(row, 'NUMERIC_SCALE')),
  }));
}

function names(cols) {
  return new Set(cols.map((item) => item.name.toUpperCase()));
}

function diffColumns(left, right) {
  const a = names(left);
  const b = names(right);
  return {
    onlyLeft: [...a].filter((item) => !b.has(item)).sort(),
    onlyRight: [...b].filter((item) => !a.has(item)).sort(),
    shared: [...a].filter((item) => b.has(item)).sort().length,
  };
}

async function countOf(sql, params = []) {
  try {
    const rows = await queryWithParams(sql, params);
    return Number(col(rows?.[0] || {}, 'N') || 0);
  } catch (error) {
    return `ERR:${String(error.message || error).slice(0, 120)}`;
  }
}

async function safeQuery(sql, params = []) {
  try {
    return { ok: true, rows: await queryWithParams(sql, params) };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 180), rows: [] };
  }
}

async function main() {
  await initDb();
  const report = {};
  try {
    const objects = [
      ['DSEDAC', 'CVC'], ['DSEDAC', 'CAC'], ['DSEDAC', 'CPC'], ['DSEDAC', 'LPC'],
      ['DSEDAC', 'FPG'], ['DSEDAC', 'FPA'], ['DSEDAC', 'LQD'],
      ['DSEDAC', 'CRC'], ['DSEDAC', 'CRCA'], ['DSEDAC', 'LRC'],
      ['DSEDAC', 'PMR'], ['DSEDAC', 'PMRL'], ['DSEDAC', 'PRD'],
      ['DSEDAC', 'PMRC'], ['DSEDAC', 'PMP'], ['DSEDAC', 'CPES'],
      ['DSED', 'LACLAE'], ['DSED', 'LAC'], ['DSEDAC', 'LAC'],
      ['JAVIER', 'PEDIDOS_CAB'], ['JAVIER', 'PEDIDOS_LIN'],
      ['JAVIER', 'TEST_PEDIDOS_CAB'], ['JAVIER', 'TEST_PEDIDOS_LIN'],
      ['JAVIER', 'TEST_DEVOLUCIONES_COMERCIAL'], ['JAVIER', 'TEST_LIQUIDACION_COMERCIAL'],
      ['JAVIER', 'TEST_COBROS'], ['JAVIER', 'COBROS'],
    ];
    report.objects = [];
    for (const [schema, table] of objects) {
      const exists = await tableExists(schema, table);
      const cols = exists.ok ? await columnsOf(schema, table) : [];
      report.objects.push({
        id: `${schema}.${table}`,
        present: exists.ok,
        type: exists.type,
        cols: cols.length,
      });
    }

    const cabProd = await columnsOf('JAVIER', 'PEDIDOS_CAB');
    const cabTest = await columnsOf('JAVIER', 'TEST_PEDIDOS_CAB');
    const linProd = await columnsOf('JAVIER', 'PEDIDOS_LIN');
    const linTest = await columnsOf('JAVIER', 'TEST_PEDIDOS_LIN');
    report.pedidosSchema = {
      cab: { prod: cabProd.length, test: cabTest.length, ...diffColumns(cabProd, cabTest) },
      lin: { prod: linProd.length, test: linTest.length, ...diffColumns(linProd, linTest) },
      cabDiscount: {
        DESCUENTO_GLOBAL: names(cabTest).has('DESCUENTO_GLOBAL'),
        PORCENTAJEDESCUENTO1: names(cabTest).has('PORCENTAJEDESCUENTO1'),
        PORCENTAJEDESCUENTO2: names(cabTest).has('PORCENTAJEDESCUENTO2'),
      },
      linDiscount: {
        DESCUENTO_LINEA: names(linTest).has('DESCUENTO_LINEA'),
        PORCENTAJEDESCUENTO: names(linTest).has('PORCENTAJEDESCUENTO'),
        PORCENTAJEDESCUENTO02: names(linTest).has('PORCENTAJEDESCUENTO02'),
      },
    };

    const fpgCols = await columnsOf('DSEDAC', 'FPG');
    report.fpgColumns = fpgCols.map((item) => item.name);
    const fpgNames = names(fpgCols);
    const fpgSelect = [
      'TRIM(CODIGOFORMAPAGO) AS CODIGO',
      fpgNames.has('DESCRIPCIONFORMAPAGO') ? 'TRIM(DESCRIPCIONFORMAPAGO) AS DESC' : "CAST('' AS VARCHAR(40)) AS DESC",
      fpgNames.has('PAGARESN') ? 'TRIM(PAGARESN) AS PAGARESN' : "CAST(NULL AS CHAR(1)) AS PAGARESN",
      fpgNames.has('DIAS') ? 'DIAS AS DIAS' : (fpgNames.has('NUMERODIAS') ? 'NUMERODIAS AS DIAS' : (fpgNames.has('PLAZODIAS') ? 'PLAZODIAS AS DIAS' : 'CAST(NULL AS INTEGER) AS DIAS')),
      fpgNames.has('DIASVENCIMIENTO') ? 'DIASVENCIMIENTO AS DIASVENCIMIENTO' : 'CAST(NULL AS INTEGER) AS DIASVENCIMIENTO',
      fpgNames.has('NUMERODIASVENCIMIENTO') ? 'NUMERODIASVENCIMIENTO AS NUMERODIASVENCIMIENTO' : 'CAST(NULL AS INTEGER) AS NUMERODIASVENCIMIENTO',
    ].join(', ');
    const fpgAll = await safeQuery(`SELECT ${fpgSelect} FROM DSEDAC.FPG FETCH FIRST 80 ROWS ONLY`);
    report.fpgSample = fpgAll.ok
      ? (fpgAll.rows || []).map((row) => ({
        codigo: trim(col(row, 'CODIGO')),
        desc: trim(col(row, 'DESC')),
        pagaresn: trim(col(row, 'PAGARESN')),
        dias: col(row, 'DIAS'),
        diasVencimiento: col(row, 'DIASVENCIMIENTO'),
        numeroDiasVencimiento: col(row, 'NUMERODIASVENCIMIENTO'),
      }))
      : { error: fpgAll.error };

    const cvcTypes = await safeQuery(
      `SELECT TRIM(TIPODOCUMENTO) AS TIPO, COUNT(*) AS N
         FROM DSEDAC.CVC
        WHERE (ANULADOSN IS NULL OR ANULADOSN <> 'S')
        GROUP BY TRIM(TIPODOCUMENTO)
        ORDER BY N DESC
        FETCH FIRST 40 ROWS ONLY`,
    );
    report.cvcTypes = cvcTypes.ok
      ? (cvcTypes.rows || []).map((row) => ({ tipo: trim(col(row, 'TIPO')), n: Number(col(row, 'N') || 0) }))
      : { error: cvcTypes.error };

    report.counts = {
      cvcPgCode: await countOf(
        `SELECT COUNT(*) AS N FROM DSEDAC.CVC
          WHERE UPPER(TRIM(CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2))
            AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')`,
        ['PG'],
      ),
      cvcPendiente0Pg: await countOf(
        `SELECT COUNT(*) AS N FROM DSEDAC.CVC
          WHERE UPPER(TRIM(CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2))
            AND IMPORTEPENDIENTE = 0
            AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')`,
        ['PG'],
      ),
      cvcDev: await countOf(
        `SELECT COUNT(*) AS N FROM DSEDAC.CVC
          WHERE TRIM(TIPODOCUMENTO) = CAST(? AS VARCHAR(3))
            AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')`,
        ['DEV'],
      ),
      laclaeD: await countOf(
        `SELECT COUNT(*) AS N FROM DSED.LACLAE WHERE TRIM(LCSRAB) = CAST(? AS VARCHAR(4))`,
        ['D'],
      ),
      laclaeDv: await countOf(
        `SELECT COUNT(*) AS N FROM DSED.LACLAE WHERE TRIM(LCTPVT) = CAST(? AS VARCHAR(2))`,
        ['DV'],
      ),
      testDev: await countOf(`SELECT COUNT(*) AS N FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL`),
      testPedCab: await countOf(`SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDOS_CAB`),
      testPedLin: await countOf(`SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDOS_LIN`),
      testPedCabDto: await countOf(
        `SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDOS_CAB WHERE DESCUENTO_GLOBAL > 0`,
      ),
      testPedLinDto: await countOf(
        `SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDOS_LIN WHERE PORCENTAJEDESCUENTO > 0 OR DESCUENTO_LINEA > 0`,
      ),
    };

    const pgJoin = await safeQuery(
      `SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
              TRIM(CVC.TIPODOCUMENTO) AS TIPO,
              TRIM(CVC.SERIEDOCUMENTO) AS SERIE,
              CVC.NUMERODOCUMENTO AS NUMERO,
              CVC.IMPORTEVENCIMIENTO AS IMPORTE,
              CVC.IMPORTEPENDIENTE AS PENDIENTE,
              TRIM(CVC.CODIGOFORMAPAGO) AS FP,
              CVC.ANODOCUMENTO AS ANO,
              CVC.MESDOCUMENTO AS MES,
              CVC.DIADOCUMENTO AS DIA,
              CVC.ANOVENCIMIENTO AS ANOV,
              CVC.MESVENCIMIENTO AS MESV,
              CVC.DIAVENCIMIENTO AS DIAV,
              TRIM(CVC.CODIGOVENDEDORCOBRO) AS VENDEDOR
         FROM DSEDAC.CVC CVC
        WHERE UPPER(TRIM(CVC.CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2))
          AND CVC.IMPORTEPENDIENTE = 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND CVC.IMPORTEVENCIMIENTO > 0
        ORDER BY CVC.ANODOCUMENTO DESC, CVC.MESDOCUMENTO DESC, CVC.DIADOCUMENTO DESC
        FETCH FIRST 8 ROWS ONLY`,
      ['PG'],
    );
    report.pgCollectedSample = pgJoin.ok
      ? (pgJoin.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        tipo: trim(col(row, 'TIPO')),
        doc: `${trim(col(row, 'SERIE'))}-${col(row, 'NUMERO')}`,
        importe: Number(col(row, 'IMPORTE') || 0),
        pendiente: Number(col(row, 'PENDIENTE') || 0),
        fp: trim(col(row, 'FP')),
        fecha: `${col(row, 'ANO')}-${col(row, 'MES')}-${col(row, 'DIA')}`,
        vto: `${col(row, 'ANOV')}-${col(row, 'MESV')}-${col(row, 'DIAV')}`,
        vendedor: trim(col(row, 'VENDEDOR')),
      }))
      : { error: pgJoin.error };

    const fp30 = (report.fpgSample || []).filter((row) => Number(row.dias) === 30
      || Number(row.diasVencimiento) === 30
      || Number(row.numeroDiasVencimiento) === 30
      || /30/.test(row.desc || '')).map((row) => row.codigo);
    report.fp30Codes = [...new Set(fp30)];

    const lacDevSample = await safeQuery(
      `SELECT TRIM(L.LCCDCL) AS CLIENTE,
              TRIM(L.LCCDVD) AS VENDEDOR,
              TRIM(L.LCSRAB) AS SERIE,
              L.LCNRAB AS NUMERO,
              TRIM(L.LCTPVT) AS TIPOVENTA,
              L.LCAADC AS YEAR,
              L.LCMMDC AS MONTH,
              L.LCDDDC AS DAY,
              SUM(L.LCIMVT) AS AMOUNT
         FROM DSED.LACLAE L
        WHERE (TRIM(L.LCSRAB) = CAST(? AS VARCHAR(4)) OR TRIM(L.LCTPVT) = CAST(? AS VARCHAR(2)))
          AND L.LCAADC >= ?
        GROUP BY TRIM(L.LCCDCL), TRIM(L.LCCDVD), TRIM(L.LCSRAB), L.LCNRAB, TRIM(L.LCTPVT),
                 L.LCAADC, L.LCMMDC, L.LCDDDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
        FETCH FIRST 8 ROWS ONLY`,
      ['D', 'DV', 2025],
    );
    report.lacDevSample = lacDevSample.ok
      ? (lacDevSample.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        vendedor: trim(col(row, 'VENDEDOR')),
        doc: `${trim(col(row, 'SERIE'))}-${col(row, 'NUMERO')}`,
        tipoVenta: trim(col(row, 'TIPOVENTA')),
        fecha: `${col(row, 'YEAR')}-${col(row, 'MONTH')}-${col(row, 'DAY')}`,
        amount: Number(col(row, 'AMOUNT') || 0),
      }))
      : { error: lacDevSample.error };

    const joined = await safeQuery(
      `SELECT TRIM(DEV.CODIGOCLIENTEALBARAN) AS CLIENTE,
              TRIM(DEV.SERIEDOCUMENTO) AS SERIE_DEV,
              DEV.NUMERODOCUMENTO AS NUM_DEV,
              DEV.IMPORTEVENCIMIENTO AS IMP_DEV,
              TRIM(FAC.TIPODOCUMENTO) AS TIPO_FAC,
              TRIM(FAC.SERIEDOCUMENTO) AS SERIE_FAC,
              FAC.NUMERODOCUMENTO AS NUM_FAC,
              TRIM(FAC.CODIGOFORMAPAGO) AS FP,
              FAC.IMPORTEPENDIENTE AS PENDIENTE,
              FAC.IMPORTEVENCIMIENTO AS IMP_FAC,
              FAC.ANODOCUMENTO AS ANO,
              FAC.MESDOCUMENTO AS MES,
              FAC.DIADOCUMENTO AS DIA,
              FAC.ANOVENCIMIENTO AS ANOV,
              FAC.MESVENCIMIENTO AS MESV,
              FAC.DIAVENCIMIENTO AS DIAV
         FROM DSEDAC.CVC DEV
         JOIN DSEDAC.CVC FAC
           ON TRIM(FAC.CODIGOCLIENTEALBARAN) = TRIM(DEV.CODIGOCLIENTEALBARAN)
          AND FAC.EJERCICIODOCUMENTO = DEV.EJERCICIODOCUMENTO
          AND (FAC.ANULADOSN IS NULL OR FAC.ANULADOSN <> 'S')
        WHERE TRIM(DEV.TIPODOCUMENTO) = CAST(? AS VARCHAR(3))
          AND (DEV.ANULADOSN IS NULL OR DEV.ANULADOSN <> 'S')
          AND UPPER(TRIM(FAC.CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2))
          AND FAC.IMPORTEPENDIENTE = 0
          AND TRIM(FAC.TIPODOCUMENTO) <> CAST(? AS VARCHAR(3))
        FETCH FIRST 6 ROWS ONLY`,
      ['DEV', 'PG', 'DEV'],
    );
    report.pgPlusDevJoin = joined.ok
      ? (joined.rows || []).map((row) => ({
        cliente: trim(col(row, 'CLIENTE')),
        fac: `${trim(col(row, 'TIPO_FAC'))} ${trim(col(row, 'SERIE_FAC'))}-${col(row, 'NUM_FAC')}`,
        dev: `DEV ${trim(col(row, 'SERIE_DEV'))}-${col(row, 'NUM_DEV')}`,
        fp: trim(col(row, 'FP')),
        pendiente: Number(col(row, 'PENDIENTE') || 0),
        impFac: Number(col(row, 'IMP_FAC') || 0),
        impDev: Number(col(row, 'IMP_DEV') || 0),
        fecha: `${col(row, 'ANO')}-${col(row, 'MES')}-${col(row, 'DIA')}`,
        vto: `${col(row, 'ANOV')}-${col(row, 'MESV')}-${col(row, 'DIAV')}`,
      }))
      : { error: joined.error };

    const lacCols = await columnsOf('DSED', 'LACLAE');
    report.laclaeHintCols = lacCols
      .map((item) => item.name)
      .filter((name) => /LCSRAB|LCTPVT|LCIMVT|LCCDCL|LCCDVD|LCAADC|SERIE|TIPO/.test(name));

    const lqdCols = names(await columnsOf('DSEDAC', 'LQD'));
    report.lqdHas = {
      IMPORTETOTALAINGRESAR: lqdCols.has('IMPORTETOTALAINGRESAR'),
      IMPORTEEFECTIVO: lqdCols.has('IMPORTEEFECTIVO'),
      IMPORTECHEQUES: lqdCols.has('IMPORTECHEQUES'),
      IMPORTEPOSTDATADOS: lqdCols.has('IMPORTEPOSTDATADOS'),
    };

    const cacExists = report.objects.find((item) => item.id === 'DSEDAC.CAC');
    if (cacExists?.present) {
      const cacJoin = await safeQuery(
        `SELECT COUNT(*) AS N
           FROM DSEDAC.CVC CVC
           JOIN DSEDAC.CAC CAC
             ON CAC.EJERCICIO = CVC.EJERCICIODOCUMENTO
            AND TRIM(CAC.SERIE) = TRIM(CVC.SERIEDOCUMENTO)
            AND CAC.TERMINAL = CVC.TERMINALDOCUMENTO
            AND CAC.NUMERO = CVC.NUMERODOCUMENTO
          WHERE TRIM(CVC.TIPODOCUMENTO) = CAST(? AS VARCHAR(3))
            AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')`,
        ['DEV'],
      );
      if (!cacJoin.ok) {
        const cacCols = await columnsOf('DSEDAC', 'CAC');
        report.cacColumns = cacCols.map((item) => item.name).slice(0, 40);
        report.cacJoin = { error: cacJoin.error };
      } else {
        report.cacJoinDev = Number(col(cacJoin.rows?.[0] || {}, 'N') || 0);
      }
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
