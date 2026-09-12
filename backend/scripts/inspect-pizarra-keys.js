'use strict';

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
function trim(value) { return String(value == null ? '' : value).trim(); }
async function safe(sql, params = []) {
  try { return { ok: true, rows: await queryWithParams(sql, params) }; }
  catch (error) { return { ok: false, error: String(error.message || error).slice(0, 240), rows: [] }; }
}

async function main() {
  await initDb();
  const out = {};
  try {
    const cvcCols = await safe(
      `SELECT TRIM(COLUMN_NAME) AS N FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND (UPPER(COLUMN_NAME) LIKE '%CLIENTE%'
            OR UPPER(COLUMN_NAME) LIKE '%VENDED%'
            OR UPPER(COLUMN_NAME) LIKE '%FACT%'
            OR UPPER(COLUMN_NAME) LIKE '%ALBAR%'
            OR UPPER(COLUMN_NAME) LIKE '%RECIB%'
            OR UPPER(COLUMN_NAME) LIKE '%PAGARE%')
        ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'CVC'],
    );
    out.cvcClientish = cvcCols.ok ? (cvcCols.rows || []).map((r) => trim(col(r, 'N'))) : cvcCols.error;

    const pag = await safe(
      `SELECT TRIM(TIPODOCUMENTO) AS TIPO,
              TRIM(SERIEDOCUMENTO) AS SERIE,
              NUMERODOCUMENTO AS NUMERO,
              TRIM(CODIGOCLIENTEALBARAN) AS CL_ALB,
              TRIM(CODIGOCLIENTEFACTURA) AS CL_FAC,
              TRIM(CODIGOVENDEDOR) AS VD,
              TRIM(CODIGOVENDEDORCOBRO) AS VD_COB,
              IMPORTEVENCIMIENTO AS IMP,
              IMPORTEPENDIENTE AS PEND,
              TRIM(CODIGOFORMAPAGO) AS FP,
              ANOEMISION AS AE, MESEMISION AS ME, DIAEMISION AS DE,
              ANOVENCIMIENTO AS AV, MESVENCIMIENTO AS MV, DIAVENCIMIENTO AS DV
         FROM DSEDAC.CVC
        WHERE TRIM(TIPODOCUMENTO) = CAST(? AS VARCHAR(3))
          AND IMPORTEPENDIENTE = 0
          AND IMPORTEVENCIMIENTO > 0
          AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')
        ORDER BY ANOEMISION DESC, MESEMISION DESC, DIAEMISION DESC
        FETCH FIRST 3 ROWS ONLY`,
      ['PAG'],
    );
    out.pagSettled = pag.ok ? (pag.rows || []).map((r) => ({
      tipo: trim(col(r, 'TIPO')),
      doc: `${trim(col(r, 'SERIE'))}-${col(r, 'NUMERO')}`,
      clAlb: trim(col(r, 'CL_ALB')),
      clFac: trim(col(r, 'CL_FAC')),
      vd: trim(col(r, 'VD')),
      vdCob: trim(col(r, 'VD_COB')),
      imp: Number(col(r, 'IMP') || 0),
      pend: Number(col(r, 'PEND') || 0),
      fp: trim(col(r, 'FP')),
      fecha: `${col(r, 'AE')}-${col(r, 'ME')}-${col(r, 'DE')}`,
      vto: `${col(r, 'AV')}-${col(r, 'MV')}-${col(r, 'DV')}`,
    })) : { error: pag.error };

    const cacCols = await safe(
      `SELECT TRIM(COLUMN_NAME) AS N FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND (UPPER(COLUMN_NAME) LIKE '%FACT%' OR UPPER(COLUMN_NAME) LIKE '%ALBAR%'
            OR UPPER(COLUMN_NAME) LIKE '%CLIENTE%' OR UPPER(COLUMN_NAME) LIKE '%VENDED%')
        ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'CAC'],
    );
    out.cacKeyish = cacCols.ok ? (cacCols.rows || []).map((r) => trim(col(r, 'N'))) : cacCols.error;

    const lac = await safe(
      `SELECT TRIM(L.LCCDCL) AS CLIENTE, TRIM(L.LCCDVD) AS VENDEDOR,
              TRIM(L.LCSRAB) AS SERIE, L.LCNRAB AS NUMERO, TRIM(L.LCTPVT) AS TIPO,
              L.LCAADC AS Y, L.LCMMDC AS M, L.LCDDDC AS D,
              SUM(L.LCIMVT) AS AMOUNT, COUNT(*) AS LINES
         FROM DSED.LACLAE L
        WHERE TRIM(L.LCSRAB) = CAST(? AS VARCHAR(1))
          AND L.LCAADC >= ?
        GROUP BY TRIM(L.LCCDCL), TRIM(L.LCCDVD), TRIM(L.LCSRAB), L.LCNRAB, TRIM(L.LCTPVT),
                 L.LCAADC, L.LCMMDC, L.LCDDDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
        FETCH FIRST 5 ROWS ONLY`,
      ['D', 2025],
    );
    out.lacD = lac.ok ? (lac.rows || []).map((r) => ({
      cliente: trim(col(r, 'CLIENTE')),
      vendedor: trim(col(r, 'VENDEDOR')),
      doc: `${trim(col(r, 'SERIE'))}-${col(r, 'NUMERO')}`,
      tipo: trim(col(r, 'TIPO')),
      fecha: `${col(r, 'Y')}-${col(r, 'M')}-${col(r, 'D')}`,
      amount: Number(col(r, 'AMOUNT') || 0),
      lines: Number(col(r, 'LINES') || 0),
    })) : { error: lac.error };

    for (const table of ['CRC', 'CRCA', 'LRC']) {
      const exists = await safe(
        `SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? FETCH FIRST 1 ROW ONLY`,
        ['DSEDAC', table],
      );
      out[`${table}_exists`] = exists.ok && (exists.rows || []).length > 0;
      if (out[`${table}_exists`]) {
        const sample = await safe(
          `SELECT * FROM DSEDAC.${table} FETCH FIRST 1 ROW ONLY`,
        );
        out[`${table}_cols`] = sample.ok && sample.rows?.[0]
          ? Object.keys(sample.rows[0]).slice(0, 25)
          : (sample.error || []);
      }
    }

    const lqd = await safe(
      `SELECT TRIM(COLUMN_NAME) AS N FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND (UPPER(COLUMN_NAME) LIKE '%IMPORTE%' OR UPPER(COLUMN_NAME) LIKE '%COBR%'
            OR UPPER(COLUMN_NAME) LIKE '%EFECT%' OR UPPER(COLUMN_NAME) LIKE '%CHEQU%'
            OR UPPER(COLUMN_NAME) LIKE '%POSTDAT%' OR UPPER(COLUMN_NAME) LIKE '%PAGAR%')
        ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'LQD'],
    );
    out.lqdAmountCols = lqd.ok ? (lqd.rows || []).map((r) => trim(col(r, 'N'))) : lqd.error;

    const fpg = await safe(
      `SELECT TRIM(COLUMN_NAME) AS N FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'FPG'],
    );
    out.fpgCols = fpg.ok ? (fpg.rows || []).map((r) => trim(col(r, 'N'))) : fpg.error;

    const fpgP1 = await safe(
      `SELECT * FROM DSEDAC.FPG WHERE TRIM(CODIGOFORMAPAGO) IN (?, ?, ?) FETCH FIRST 5 ROWS ONLY`,
      ['P1', 'PG', 'P0'],
    );
    out.fpgP1 = fpgP1.ok
      ? (fpgP1.rows || []).map((r) => {
        const o = {};
        for (const [k, v] of Object.entries(r)) {
          const key = String(k).toUpperCase();
          if (/CODIGO|DESC|PAGARE|DIA|PLAZO|VENC|FECHA|NUMERO/.test(key)) o[key] = v;
        }
        return o;
      })
      : { error: fpgP1.error };

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
