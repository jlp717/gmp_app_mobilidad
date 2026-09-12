'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, queryWithParams } = require('../config/db');

function col(row, name) {
  const wanted = String(name).toUpperCase();
  for (const [k, v] of Object.entries(row || {})) {
    if (String(k).toUpperCase() === wanted) return v;
  }
  return undefined;
}
function trim(v) { return String(v == null ? '' : v).trim(); }
async function safe(sql, params = []) {
  try { return { ok: true, rows: await queryWithParams(sql, params) }; }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 220), rows: [] }; }
}

async function main() {
  await initDb();
  const out = {};
  try {
    out.cliCols = (await safe(
      `SELECT TRIM(COLUMN_NAME) AS N FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
          AND (UPPER(COLUMN_NAME) LIKE '%VENDED%' OR UPPER(COLUMN_NAME) LIKE '%R1%' OR COLUMN_NAME='CODIGOCLIENTE')
        ORDER BY ORDINAL_POSITION`, ['DSEDAC', 'CLI'],
    )).rows.map((r) => trim(col(r, 'N')));

    out.clpCols = (await safe(
      `SELECT TRIM(COLUMN_NAME) AS N FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'CLP'],
    ));
    out.clpCols = out.clpCols.ok ? out.clpCols.rows.map((r) => trim(col(r, 'N'))).slice(0, 30) : out.clpCols.error;

    out.cvcLen = (await safe(
      `SELECT TRIM(COLUMN_NAME) AS N, LENGTH AS L, TRIM(DATA_TYPE) AS T
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
          AND COLUMN_NAME IN ('CODIGOCLIENTEALBARAN','CODIGOCLIENTEFACTURA','CODIGOVENDEDOR','CODIGOVENDEDORCOBRO')`,
      ['DSEDAC', 'CVC'],
    ));
    out.cvcLen = out.cvcLen.ok ? out.cvcLen.rows.map((r) => ({
      n: trim(col(r, 'N')), l: col(r, 'L'), t: trim(col(r, 'T')),
    })) : out.cvcLen.error;

    const clients = ['4300009324', '4300001582', '4300006612', '4300001034'];
    out.owners = [];
    for (const c of clients) {
      const clp = await safe(
        `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE, TRIM(VENDEDORCOMERCIAL) AS VD
           FROM DSEDAC.CLP WHERE TRIM(CODIGOCLIENTE)=CAST(? AS VARCHAR(12)) FETCH FIRST 1 ROW ONLY`,
        [c],
      );
      const cli = await safe(
        `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE, TRIM(R1_T8CDVD) AS R1, TRIM(LCCDVD) AS LC
           FROM DSEDAC.CLI WHERE TRIM(CODIGOCLIENTE)=CAST(? AS VARCHAR(12)) FETCH FIRST 1 ROW ONLY`,
        [c],
      );
      out.owners.push({
        cliente: c,
        clp: clp.ok ? { vd: trim(col(clp.rows?.[0], 'VD')) } : { error: clp.error },
        cli: cli.ok ? { r1: trim(col(cli.rows?.[0], 'R1')), lc: trim(col(cli.rows?.[0], 'LC')) } : { error: cli.error },
      });
    }

    out.clxRig = (await safe(
      `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE, COALESCE(PORCENTAJECOBRORIGUROSO,0) AS PCT
         FROM DSEDAC.CLX
        WHERE UPPER(TRIM(COBRORIGUROSOSN))=CAST(? AS VARCHAR(1))
          AND COALESCE(PORCENTAJECOBRORIGUROSO,0)>0
        FETCH FIRST 5 ROWS ONLY`,
      ['S'],
    ));
    out.clxRig = out.clxRig.ok ? out.clxRig.rows.map((r) => ({
      cliente: trim(col(r, 'CLIENTE')), pct: Number(col(r, 'PCT') || 0),
    })) : out.clxRig.error;

    out.crc = await safe(
      `SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?)`,
      ['DSEDAC', 'CRC', 'CRCA', 'LRC'],
    );
    out.crc = out.crc.ok ? out.crc.rows.map((r) => trim(col(r, 'TABLE_NAME'))) : out.crc.error;

    const crcCols = await safe(
      `SELECT TRIM(COLUMN_NAME) AS N FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
          AND (UPPER(COLUMN_NAME) LIKE '%CLIENTE%' OR UPPER(COLUMN_NAME) LIKE '%IMPORTE%'
            OR UPPER(COLUMN_NAME) LIKE '%FACT%' OR UPPER(COLUMN_NAME) LIKE '%RECIB%')
        ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'CRC'],
    );
    out.crcCols = crcCols.ok ? crcCols.rows.map((r) => trim(col(r, 'N'))).slice(0, 25) : crcCols.error;

    out.lacD = (await safe(
      `SELECT TRIM(L.LCCDCL) AS CLIENTE, TRIM(L.LCCDVD) AS VENDEDOR,
              TRIM(L.LCSRAB) AS SERIE, L.LCNRAB AS NUMERO, TRIM(L.LCTPVT) AS TIPO,
              L.LCAADC AS Y, L.LCMMDC AS M, L.LCDDDC AS D, SUM(L.LCIMVT) AS AMOUNT
         FROM DSED.LACLAE L
        WHERE TRIM(L.LCSRAB)=CAST(? AS VARCHAR(1)) AND L.LCAADC>=?
        GROUP BY TRIM(L.LCCDCL), TRIM(L.LCCDVD), TRIM(L.LCSRAB), L.LCNRAB, TRIM(L.LCTPVT),
                 L.LCAADC, L.LCMMDC, L.LCDDDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
        FETCH FIRST 3 ROWS ONLY`,
      ['D', 2026],
    ));
    out.lacD = out.lacD.ok ? out.lacD.rows.map((r) => ({
      cliente: trim(col(r, 'CLIENTE')), vd: trim(col(r, 'VENDEDOR')),
      doc: `${trim(col(r, 'SERIE'))}-${col(r, 'NUMERO')}`, tipo: trim(col(r, 'TIPO')),
      fecha: `${col(r, 'Y')}-${col(r, 'M')}-${col(r, 'D')}`, amount: Number(col(r, 'AMOUNT') || 0),
    })) : out.lacD.error;

    out.fpgP1 = (await safe(
      `SELECT TRIM(CODIGOFORMAPAGO) AS COD, TRIM(DESCRIPCIONFORMAPAGO) AS DES,
              TRIM(PAGARESN) AS PAG, NUMERODIASVENCIMIENTO AS NDV, DIASVENCIMIENTO AS DV
         FROM DSEDAC.FPG WHERE TRIM(CODIGOFORMAPAGO) IN (?,?,?)`,
      ['P1', 'PG', 'P0'],
    ));
    out.fpgP1 = out.fpgP1.ok ? out.fpgP1.rows : out.fpgP1.error;

    const team = await safe(
      `SELECT TRIM(P.CODIGOCLIENTE) AS CLIENTE, TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO,
              TRIM(CLP.VENDEDORCOMERCIAL) AS VD
         FROM DSEDAC.PMR P
         JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE)=TRIM(P.CODIGOCLIENTE)
        WHERE TRIM(COALESCE(P.CODIGOCLIENTE,''))<>''
          AND TRIM(CLP.VENDEDORCOMERCIAL) IN (?,?,?,?,?)
          AND (P.ANOFIN=0 OR P.ANOFIN>=?)
        FETCH FIRST 8 ROWS ONLY`,
      ['80', '72', '73', '81', '83', 2026],
    );
    out.team80Promos = team.ok ? team.rows.map((r) => ({
      cliente: trim(col(r, 'CLIENTE')), promo: trim(col(r, 'PROMO')), vd: trim(col(r, 'VD')),
    })) : { error: team.error };

    const pmrcTeam = await safe(
      `SELECT TRIM(C.CODIGOCLIENTE) AS CLIENTE, TRIM(C.CODIGOPROMOCIONREGALO) AS PROMO,
              TRIM(CLP.VENDEDORCOMERCIAL) AS VD
         FROM DSEDAC.PMRC C
         JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE)=TRIM(C.CODIGOCLIENTE)
        WHERE TRIM(CLP.VENDEDORCOMERCIAL) IN (?,?,?,?,?)
        FETCH FIRST 8 ROWS ONLY`,
      ['80', '72', '73', '81', '83'],
    );
    out.team80Pmrc = pmrcTeam.ok ? pmrcTeam.rows.map((r) => ({
      cliente: trim(col(r, 'CLIENTE')), promo: trim(col(r, 'PROMO')), vd: trim(col(r, 'VD')),
    })) : { error: pmrcTeam.error };

    console.log(JSON.stringify(out, null, 2));
  } finally { await closePool(); }
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
