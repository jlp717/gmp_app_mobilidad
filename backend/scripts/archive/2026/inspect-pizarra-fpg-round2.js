// ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;inspect-pizarra | inspeccion puntual pizarra FPG ronda2 | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Round 2: FPG.PRIMERPAGO / ENTREPAGOS + PAG cobrado + vto vs dias.
 * Bound SQL. Read-only.
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
function trim(v) { return String(v == null ? '' : v).trim(); }
function ymd(y, m, d) {
  const year = Number(y); const month = Number(m); const day = Number(d);
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
  try { return { ok: true, rows: await queryWithParams(sql, params) }; }
  catch (error) { return { ok: false, error: String(error.message || error).slice(0, 240), rows: [] }; }
}

function parseDiasDesc(desc) {
  const text = String(desc || '');
  const dff = /(\d+)\s*DFF/i.exec(text);
  if (dff) return Number(dff[1]);
  const first = /(\d+)/.exec(text);
  return first ? Number(first[1]) : null;
}

async function main() {
  await initDb();
  try {
    const fpg = await safe(
      `SELECT TRIM(CODIGOFORMAPAGO) AS CODIGO,
              TRIM(DESCRIPCIONFORMAPAGO) AS DESC,
              TRIM(PAGARESN) AS PAGARESN,
              NUMEROPAGOS AS NP,
              PRIMERPAGO AS PP,
              ENTREPAGOS AS EP,
              VENCIMIENTOFIJO1 AS VF1,
              VENCIMIENTOFIJO2 AS VF2,
              VENCIMIENTOFIJO3 AS VF3
         FROM DSEDAC.FPG
        WHERE PAGARESN = CAST(? AS CHAR(1))
        ORDER BY CODIGOFORMAPAGO`,
      ['S'],
    );
    const fpgRows = (fpg.rows || []).map((row) => ({
      codigo: trim(n(row, 'CODIGO')),
      desc: trim(n(row, 'DESC')),
      np: n(row, 'NP'),
      primerPago: n(row, 'PP'),
      entrePagos: n(row, 'EP'),
      vf1: n(row, 'VF1'),
      vf2: n(row, 'VF2'),
      vf3: n(row, 'VF3'),
      diasDesc: parseDiasDesc(n(row, 'DESC')),
    }));
    console.log('FPG_PAGARES', JSON.stringify(fpgRows, null, 2));

    const cpcCols = await safe(
      `SELECT TRIM(COLUMN_NAME) AS C FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND UPPER(COLUMN_NAME) LIKE CAST(? AS VARCHAR(40))
        ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'CPC', '%ALBARAN%'],
    );
    console.log('CPC_ALBARAN_COLS', (cpcCols.rows || []).map((r) => trim(n(r, 'C'))));

    const sampleSql = `
      SELECT TRIM(COALESCE(NULLIF(TRIM(CAC.CODIGOCLIENTEFACTURA), ''), CAC.CODIGOCLIENTEALBARAN)) AS CLIENTE,
             TRIM(CVC.TIPODOCUMENTO) AS TIPO,
             TRIM(CVC.SERIEDOCUMENTO) AS SERIE,
             CVC.TERMINALDOCUMENTO AS TERM,
             CVC.NUMERODOCUMENTO AS NUMERO,
             CVC.IMPORTEVENCIMIENTO AS IMPORTE,
             TRIM(CVC.CODIGOFORMAPAGO) AS FP,
             TRIM(FPG.DESCRIPCIONFORMAPAGO) AS FP_DESC,
             FPG.PRIMERPAGO AS PP,
             FPG.ENTREPAGOS AS EP,
             CVC.ANOEMISION AS ANOE, CVC.MESEMISION AS MESE, CVC.DIAEMISION AS DIAE,
             CVC.ANOVENCIMIENTO AS ANOV, CVC.MESVENCIMIENTO AS MESV, CVC.DIAVENCIMIENTO AS DIAV,
             TRIM(CAC.SERIEALBARAN) AS SERIE_ALB,
             CAC.TERMINALALBARAN AS TERM_ALB,
             CAC.NUMEROALBARAN AS NUM_ALB,
             TRIM(CAC.SERIEFACTURA) AS SERIE_FAC,
             CAC.TERMINALFACTURA AS TERM_FAC,
             CAC.NUMEROFACTURA AS NUM_FAC,
             TRIM(CAC.CODIGOVENDEDOR) AS VD,
             TRIM(CPC.SERIEALBARAN) AS CPC_SERIE,
             CPC.TERMINALALBARAN AS CPC_TERM,
             CPC.NUMEROALBARAN AS CPC_NUM
        FROM DSEDAC.CVC CVC
        JOIN DSEDAC.FPG FPG ON FPG.CODIGOFORMAPAGO = CVC.CODIGOFORMAPAGO
        JOIN DSEDAC.CAC CAC
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
         AND TRIM(CVC.CODIGOFORMAPAGO) = CAST(? AS CHAR(2))
       ORDER BY CVC.ANOVENCIMIENTO DESC
       FETCH FIRST 3 ROWS ONLY
    `;

    function mapRow(row) {
      const fecha = ymd(n(row, 'ANOE'), n(row, 'MESE'), n(row, 'DIAE'));
      const vto = ymd(n(row, 'ANOV'), n(row, 'MESV'), n(row, 'DIAV'));
      const pp = Number(n(row, 'PP'));
      const diasDesc = parseDiasDesc(n(row, 'FP_DESC'));
      const dias = Number.isFinite(pp) && pp > 0 ? pp : diasDesc;
      return {
        cliente: trim(n(row, 'CLIENTE')),
        tipo: trim(n(row, 'TIPO')),
        doc: `${trim(n(row, 'SERIE'))}-${n(row, 'TERM')}-${n(row, 'NUMERO')}`,
        importe: Number(n(row, 'IMPORTE') || 0),
        fp: trim(n(row, 'FP')),
        fpDesc: trim(n(row, 'FP_DESC')),
        primerPago: n(row, 'PP'),
        entrePagos: n(row, 'EP'),
        diasUsado: dias,
        fechaEmision: fecha,
        vtoCvc: vto,
        vtoCalcPrimerPago: addDays(fecha, Number.isFinite(pp) ? pp : null),
        vtoCalcDesc: addDays(fecha, diasDesc),
        matchPp: vto === addDays(fecha, Number.isFinite(pp) ? pp : null),
        matchDesc: vto === addDays(fecha, diasDesc),
        factura: `${trim(n(row, 'SERIE_FAC'))}-${n(row, 'TERM_FAC')}-${n(row, 'NUM_FAC')}`,
        albaran: `${trim(n(row, 'SERIE_ALB'))}-${n(row, 'TERM_ALB')}-${n(row, 'NUM_ALB')}`,
        albaranCpc: trim(n(row, 'CPC_SERIE'))
          ? `${trim(n(row, 'CPC_SERIE'))}-${n(row, 'CPC_TERM')}-${n(row, 'CPC_NUM')}`
          : null,
        vd: trim(n(row, 'VD')),
      };
    }

    for (const fp of ['P1', 'P2', 'P6', 'P7', 'P0']) {
      const res = await safe(sampleSql, ['PAG', 'S', fp]);
      console.log(`SAMPLE_${fp}`, JSON.stringify(res.ok ? (res.rows || []).map(mapRow) : { error: res.error }, null, 2));
    }

    const clxVd = await safe(
      `SELECT TRIM(CLX.CODIGOCLIENTE) AS CLIENTE,
              CLX.PORCENTAJECOBRORIGUROSO AS PCT,
              TRIM(CLX.COBRORIGUROSOSN) AS SN,
              TRIM(VDDX.CODIGOVENDEDOR) AS VD,
              VDDX.PORCENTAJEMINIMOCOBRO AS VD_PCT
         FROM DSEDAC.CLX CLX
         JOIN DSEDAC.CLC CLC ON CLC.CODIGOCLIENTE = CLX.CODIGOCLIENTE
         JOIN DSEDAC.VDDX VDDX ON VDDX.CODIGOVENDEDOR = CLC.CODIGOVENDEDOR
        WHERE CLX.COBRORIGUROSOSN = CAST(? AS CHAR(1))
          AND CLX.PORCENTAJECOBRORIGUROSO > 0
          AND VDDX.PORCENTAJEMINIMOCOBRO > 0
        FETCH FIRST 5 ROWS ONLY`,
      ['S'],
    );
    console.log('CLX_VDDX', JSON.stringify(clxVd.ok
      ? (clxVd.rows || []).map((row) => ({
        cliente: trim(n(row, 'CLIENTE')),
        clxPct: Number(n(row, 'PCT') || 0),
        sn: trim(n(row, 'SN')),
        vd: trim(n(row, 'VD')),
        vddxPct: Number(n(row, 'VD_PCT') || 0),
      }))
      : { error: clxVd.error }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
