'use strict';

/**
 * Read-only pizarra evidence: FPG catalog + PG cobrado + vto vs dias + albarán.
 * Bound SQL only. Never prints PIN/secrets. Never writes.
 *
 *   node backend/scripts/inspect-pizarra-fpg-real.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, queryWithParams } = require('../config/db');

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
    return { ok: false, error: String(error.message || error).slice(0, 220), rows: [] };
  }
}

async function cols(schema, table) {
  const result = await safe(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return result.ok ? (result.rows || []).map((row) => trim(n(row, 'COLUMN_NAME'))) : [];
}

function pick(names, candidates) {
  const set = new Set(names.map((item) => item.toUpperCase()));
  return candidates.find((item) => set.has(item.toUpperCase())) || null;
}

async function main() {
  await initDb();
  const report = {};
  try {
    const fpgCols = await cols('DSEDAC', 'FPG');
    const cacCols = await cols('DSEDAC', 'CAC');
    const cvcCols = await cols('DSEDAC', 'CVC');
    const cpcCols = await cols('DSEDAC', 'CPC');
    const clxCols = await cols('DSEDAC', 'CLX');
    const vddxCols = await cols('DSEDAC', 'VDDX');
    report.qsys2 = {
      fpg: fpgCols,
      fpaExists: (await safe(
        `SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? FETCH FIRST 1 ROW ONLY`,
        ['DSEDAC', 'FPA'],
      )).rows.length > 0,
      cacKeys: cacCols.filter((name) => /EJERCICIO|SERIE|TERMINAL|NUMERO|ALBARAN|FACTURA|VENDEDOR|CLIENTE/i.test(name)),
      cvcDate: cvcCols.filter((name) => /ANO|MES|DIA|VENC|EMIS|FORMAPAGO|TIPO|PENDIENTE/i.test(name)).slice(0, 40),
      cpcAlb: cpcCols.filter((name) => /ALBARAN|FACTURA|EJERCICIO|SERIE|TERMINAL|NUMERO/i.test(name)).slice(0, 40),
      clxMin: clxCols.filter((name) => /COBRO|RIGURO/i.test(name)),
      vddxMin: vddxCols.filter((name) => /COBRO|MINIMO/i.test(name)),
    };

    const diasCol = pick(fpgCols, ['NUMERODIASVENCIMIENTO', 'DIASVENCIMIENTO', 'NUMERODIAS', 'DIAS']);
    report.fpgDiasColumn = diasCol;
    const fpg = await safe(
      `SELECT TRIM(CODIGOFORMAPAGO) AS CODIGO,
              TRIM(DESCRIPCIONFORMAPAGO) AS DESC,
              TRIM(PAGARESN) AS PAGARESN,
              ${diasCol || 'CAST(NULL AS INTEGER)'} AS DIAS
         FROM DSEDAC.FPG
        ORDER BY CODIGO
        FETCH FIRST 80 ROWS ONLY`,
    );
    report.fpg = fpg.ok
      ? (fpg.rows || []).map((row) => ({
        codigo: trim(n(row, 'CODIGO')),
        desc: trim(n(row, 'DESC')),
        pagaresn: trim(n(row, 'PAGARESN')),
        dias: n(row, 'DIAS') == null ? null : Number(n(row, 'DIAS')),
      }))
      : { error: fpg.error };
    const pagareCodes = Array.isArray(report.fpg)
      ? report.fpg.filter((row) => row.pagaresn === 'S')
      : [];
    report.fpgPagares = pagareCodes;
    report.fpgDiasDistinct = [...new Set(pagareCodes.map((row) => row.dias))].sort((a, b) => a - b);

    const tipos = await safe(
      `SELECT TRIM(CVC.TIPODOCUMENTO) AS TIPO,
              TRIM(FPG.CODIGOFORMAPAGO) AS FP,
              FPG.${diasCol || 'CODIGOFORMAPAGO'} AS DIAS_RAW,
              COUNT(*) AS N
         FROM DSEDAC.CVC CVC
         JOIN DSEDAC.FPG FPG
           ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
        WHERE FPG.PAGARESN = CAST(? AS CHAR(1))
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND CVC.IMPORTEPENDIENTE = 0
          AND CVC.IMPORTEVENCIMIENTO > 0
        GROUP BY TRIM(CVC.TIPODOCUMENTO), TRIM(FPG.CODIGOFORMAPAGO), FPG.${diasCol || 'CODIGOFORMAPAGO'}
        ORDER BY N DESC
        FETCH FIRST 30 ROWS ONLY`,
      ['S'],
    );
    report.pgSettledByTipoFp = tipos.ok
      ? (tipos.rows || []).map((row) => ({
        tipo: trim(n(row, 'TIPO')),
        fp: trim(n(row, 'FP')),
        dias: Number(n(row, 'DIAS_RAW')),
        n: Number(n(row, 'N') || 0),
      }))
      : { error: tipos.error };

    const tipoCounts = await safe(
      `SELECT TRIM(TIPODOCUMENTO) AS TIPO, COUNT(*) AS N
         FROM DSEDAC.CVC
        WHERE (ANULADOSN IS NULL OR ANULADOSN <> 'S')
          AND TRIM(TIPODOCUMENTO) IN (?, ?, ?, ?, ?, ?, ?, ?)
        GROUP BY TRIM(TIPODOCUMENTO)`,
      ['COB', 'CAC', 'PGC', 'PGP', 'PAG', 'CNP', 'DEV', 'FRA'],
    );
    report.cvcTiposCanon = tipoCounts.ok
      ? (tipoCounts.rows || []).map((row) => ({ tipo: trim(n(row, 'TIPO')), n: Number(n(row, 'N') || 0) }))
      : { error: tipoCounts.error };

    const sampleSql = (diasOp, diasValue) => `
      SELECT TRIM(COALESCE(NULLIF(TRIM(CAC.CODIGOCLIENTEFACTURA), ''), CAC.CODIGOCLIENTEALBARAN, CVC.CODIGOCLIENTEALBARAN)) AS CLIENTE,
             TRIM(CVC.TIPODOCUMENTO) AS TIPO,
             TRIM(CVC.SERIEDOCUMENTO) AS SERIE,
             CVC.TERMINALDOCUMENTO AS TERM,
             CVC.NUMERODOCUMENTO AS NUMERO,
             CVC.IMPORTEVENCIMIENTO AS IMPORTE,
             CVC.IMPORTEPENDIENTE AS PENDIENTE,
             TRIM(CVC.CODIGOFORMAPAGO) AS FP,
             TRIM(FPG.DESCRIPCIONFORMAPAGO) AS FP_DESC,
             FPG.${diasCol || 'CODIGOFORMAPAGO'} AS DIAS,
             CVC.ANOEMISION AS ANOE, CVC.MESEMISION AS MESE, CVC.DIAEMISION AS DIAE,
             CVC.ANODOCUMENTO AS ANOD, CVC.MESDOCUMENTO AS MESD, CVC.DIADOCUMENTO AS DIAD,
             CVC.ANOVENCIMIENTO AS ANOV, CVC.MESVENCIMIENTO AS MESV, CVC.DIAVENCIMIENTO AS DIAV,
             TRIM(CAC.SERIEALBARAN) AS SERIE_ALB,
             CAC.TERMINALALBARAN AS TERM_ALB,
             CAC.NUMEROALBARAN AS NUM_ALB,
             TRIM(CAC.SERIEFACTURA) AS SERIE_FAC,
             CAC.TERMINALFACTURA AS TERM_FAC,
             CAC.NUMEROFACTURA AS NUM_FAC,
             TRIM(CAC.CODIGOVENDEDOR) AS VD_CAC,
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
       WHERE FPG.PAGARESN = CAST(? AS CHAR(1))
         AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
         AND CVC.IMPORTEPENDIENTE = 0
         AND CVC.IMPORTEVENCIMIENTO > 0
         AND FPG.${diasCol || 'CODIGOFORMAPAGO'} ${diasOp} ?
       ORDER BY CVC.ANOVENCIMIENTO DESC, CVC.MESVENCIMIENTO DESC, CVC.DIAVENCIMIENTO DESC
       FETCH FIRST 4 ROWS ONLY
    `;

    function mapSample(row) {
      const fechaE = ymd(n(row, 'ANOE'), n(row, 'MESE'), n(row, 'DIAE'));
      const fechaD = ymd(n(row, 'ANOD'), n(row, 'MESD'), n(row, 'DIAD'));
      const vto = ymd(n(row, 'ANOV'), n(row, 'MESV'), n(row, 'DIAV'));
      const dias = Number(n(row, 'DIAS'));
      const calcFromE = addDays(fechaE, dias);
      const calcFromD = addDays(fechaD, dias);
      return {
        cliente: trim(n(row, 'CLIENTE')),
        tipo: trim(n(row, 'TIPO')),
        doc: `${trim(n(row, 'SERIE'))}-${n(row, 'TERM')}-${n(row, 'NUMERO')}`,
        importe: Number(n(row, 'IMPORTE') || 0),
        fp: trim(n(row, 'FP')),
        fpDesc: trim(n(row, 'FP_DESC')),
        dias,
        fechaEmision: fechaE,
        fechaDocumento: fechaD,
        vtoCvc: vto,
        vtoCalcEmision: calcFromE,
        vtoCalcDocumento: calcFromD,
        matchEmision: vto && calcFromE ? vto === calcFromE : null,
        matchDocumento: vto && calcFromD ? vto === calcFromD : null,
        albaranCac: trim(n(row, 'SERIE_ALB'))
          ? `${trim(n(row, 'SERIE_ALB'))}-${n(row, 'TERM_ALB')}-${n(row, 'NUM_ALB')}`
          : null,
        facturaCac: trim(n(row, 'SERIE_FAC'))
          ? `${trim(n(row, 'SERIE_FAC'))}-${n(row, 'TERM_FAC')}-${n(row, 'NUM_FAC')}`
          : null,
        albaranCpc: trim(n(row, 'CPC_SERIE'))
          ? `${trim(n(row, 'CPC_SERIE'))}-${n(row, 'CPC_TERM')}-${n(row, 'CPC_NUM')}`
          : null,
        vendedorCac: trim(n(row, 'VD_CAC')),
      };
    }

    const fp30 = await safe(sampleSql('=', 30), ['S', 30]);
    const fpNe30 = await safe(sampleSql('<>', 30), ['S', 30]);
    if (!fp30.ok) {
      const noTerm = await safe(
        sampleSql('=', 30).replace('AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO\n         ', ''),
        ['S', 30],
      );
      report.pgFp30 = noTerm.ok ? (noTerm.rows || []).map(mapSample) : { error: fp30.error, fallback: noTerm.error };
    } else {
      report.pgFp30 = (fp30.rows || []).map(mapSample);
    }
    if (!fpNe30.ok) {
      report.pgFpNe30 = { error: fpNe30.error };
    } else {
      report.pgFpNe30 = (fpNe30.rows || []).map(mapSample);
    }

    const joinCounts = {};
    const joinA = await safe(
      `SELECT COUNT(*) AS N
         FROM DSEDAC.CVC CVC
         JOIN DSEDAC.FPG FPG ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
         JOIN DSEDAC.CAC CAC
           ON CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
          AND CAC.SERIEFACTURA = CVC.SERIEDOCUMENTO
          AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
          AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
        WHERE FPG.PAGARESN = CAST(? AS CHAR(1))
          AND CVC.IMPORTEPENDIENTE = 0
          AND CVC.IMPORTEVENCIMIENTO > 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')`,
      ['S'],
    );
    joinCounts.cacFacturaConTerminal = joinA.ok ? Number(n(joinA.rows[0], 'N') || 0) : joinA.error;
    const joinB = await safe(
      `SELECT COUNT(*) AS N
         FROM DSEDAC.CVC CVC
         JOIN DSEDAC.FPG FPG ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
         JOIN DSEDAC.CAC CAC
           ON CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
          AND CAC.SERIEFACTURA = CVC.SERIEDOCUMENTO
          AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
        WHERE FPG.PAGARESN = CAST(? AS CHAR(1))
          AND CVC.IMPORTEPENDIENTE = 0
          AND CVC.IMPORTEVENCIMIENTO > 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')`,
      ['S'],
    );
    joinCounts.cacFacturaSinTerminal = joinB.ok ? Number(n(joinB.rows[0], 'N') || 0) : joinB.error;
    const joinC = await safe(
      `SELECT COUNT(*) AS N
         FROM DSEDAC.CVC CVC
         JOIN DSEDAC.FPG FPG ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
         JOIN DSEDAC.CAC CAC
           ON CAC.EJERCICIOALBARAN = CVC.EJERCICIODOCUMENTO
          AND CAC.SERIEALBARAN = CVC.SERIEDOCUMENTO
          AND CAC.TERMINALALBARAN = CVC.TERMINALDOCUMENTO
          AND CAC.NUMEROALBARAN = CVC.NUMERODOCUMENTO
        WHERE FPG.PAGARESN = CAST(? AS CHAR(1))
          AND CVC.IMPORTEPENDIENTE = 0
          AND CVC.IMPORTEVENCIMIENTO > 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')`,
      ['S'],
    );
    joinCounts.cacAlbaranConTerminal = joinC.ok ? Number(n(joinC.rows[0], 'N') || 0) : joinC.error;
    report.joinCounts = joinCounts;

    const lac = await safe(
      `SELECT TRIM(LCCDCL) AS CLIENTE, TRIM(LCCDVD) AS VD, TRIM(LCSRAB) AS SERIE,
              LCNRAB AS NUMERO, TRIM(LCTPVT) AS TIPO, LCAADC AS Y, LCMMDC AS M, LCDDDC AS D,
              SUM(LCIMVT) AS IMP
         FROM DSED.LACLAE
        WHERE LCSRAB = CAST(? AS CHAR(1))
        GROUP BY TRIM(LCCDCL), TRIM(LCCDVD), TRIM(LCSRAB), LCNRAB, TRIM(LCTPVT), LCAADC, LCMMDC, LCDDDC
        ORDER BY Y DESC, M DESC, D DESC
        FETCH FIRST 3 ROWS ONLY`,
      ['D'],
    );
    report.laclaeD = lac.ok
      ? (lac.rows || []).map((row) => ({
        cliente: trim(n(row, 'CLIENTE')),
        vd: trim(n(row, 'VD')),
        doc: `${trim(n(row, 'SERIE'))}-${n(row, 'NUMERO')}`,
        tipo: trim(n(row, 'TIPO')),
        fecha: ymd(n(row, 'Y'), n(row, 'M'), n(row, 'D')),
        imp: Number(n(row, 'IMP') || 0),
      }))
      : { error: lac.error };

    const clx = await safe(
      `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE,
              TRIM(COBRORIGUROSOSN) AS SN,
              PORCENTAJECOBRORIGUROSO AS PCT
         FROM DSEDAC.CLX
        WHERE COBRORIGUROSOSN = CAST(? AS CHAR(1))
          AND PORCENTAJECOBRORIGUROSO > 0
        FETCH FIRST 5 ROWS ONLY`,
      ['S'],
    );
    report.clxMinimo = clx.ok
      ? (clx.rows || []).map((row) => ({
        cliente: trim(n(row, 'CLIENTE')),
        sn: trim(n(row, 'SN')),
        pct: Number(n(row, 'PCT') || 0),
      }))
      : { error: clx.error };

    const vddx = await safe(
      `SELECT TRIM(CODIGOVENDEDOR) AS VD, PORCENTAJEMINIMOCOBRO AS PCT
         FROM DSEDAC.VDDX
        WHERE PORCENTAJEMINIMOCOBRO > 0
        FETCH FIRST 8 ROWS ONLY`,
    );
    report.vddxMinimo = vddx.ok
      ? (vddx.rows || []).map((row) => ({
        vd: trim(n(row, 'VD')),
        pct: Number(n(row, 'PCT') || 0),
      }))
      : { error: vddx.error };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
