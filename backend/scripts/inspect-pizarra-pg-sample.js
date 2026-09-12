'use strict';

/**
 * Read-only pizarra samples: P1 30 DFF, PG ya cobrado, DEV/LAC, LQD.
 * Never prints PIN/secrets. SQL always bound.
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

function money(value) {
  return Number(value || 0);
}

function mapDoc(row) {
  return {
    cliente: String(n(row, 'CLIENTE') || '').trim(),
    tipo: String(n(row, 'TIPO') || '').trim(),
    doc: `${String(n(row, 'SERIE') || '').trim()}-${n(row, 'NUMERO')}`,
    importe: money(n(row, 'IMPORTE')),
    pendiente: money(n(row, 'PENDIENTE')),
    fp: String(n(row, 'FP') || '').trim(),
    fpDesc: String(n(row, 'FP_DESC') || '').trim(),
    pagaresn: String(n(row, 'PAGARESN') || '').trim(),
    fecha: `${n(row, 'ANO')}-${n(row, 'MES')}-${n(row, 'DIA')}`,
    vto: `${n(row, 'ANOV')}-${n(row, 'MESV')}-${n(row, 'DIAV')}`,
    albaran: String(n(row, 'SERIE_ALB') || '').trim()
      ? `${String(n(row, 'SERIE_ALB') || '').trim()}-${n(row, 'NUM_ALB')}`
      : null,
    vendedor: String(n(row, 'VENDEDOR') || '').trim(),
  };
}

const DOC_SELECT = `
  SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
         TRIM(CVC.TIPODOCUMENTO) AS TIPO,
         TRIM(CVC.SERIEDOCUMENTO) AS SERIE,
         CVC.NUMERODOCUMENTO AS NUMERO,
         CVC.IMPORTEVENCIMIENTO AS IMPORTE,
         CVC.IMPORTEPENDIENTE AS PENDIENTE,
         TRIM(CVC.CODIGOFORMAPAGO) AS FP,
         TRIM(FPG.DESCRIPCIONFORMAPAGO) AS FP_DESC,
         TRIM(FPG.PAGARESN) AS PAGARESN,
         CVC.ANOEMISION AS ANO,
         CVC.MESEMISION AS MES,
         CVC.DIAEMISION AS DIA,
         CVC.ANOVENCIMIENTO AS ANOV,
         CVC.MESVENCIMIENTO AS MESV,
         CVC.DIAVENCIMIENTO AS DIAV,
         TRIM(COALESCE(CAC.SERIEALBARAN, '')) AS SERIE_ALB,
         CAC.NUMEROALBARAN AS NUM_ALB,
         TRIM(CVC.CODIGOVENDEDOR) AS VENDEDOR
    FROM DSEDAC.CVC CVC
    LEFT JOIN DSEDAC.FPG FPG
      ON TRIM(FPG.CODIGOFORMAPAGO) = TRIM(CVC.CODIGOFORMAPAGO)
    LEFT JOIN DSEDAC.CAC CAC
      ON CAC.EJERCICIOALBARAN = CVC.EJERCICIODOCUMENTO
     AND TRIM(CAC.SERIEALBARAN) = TRIM(CVC.SERIEDOCUMENTO)
     AND CAC.TERMINALALBARAN = CVC.TERMINALDOCUMENTO
     AND CAC.NUMEROALBARAN = CVC.NUMERODOCUMENTO
`;

async function count(sql, params) {
  try {
    const rows = await queryWithParams(sql, params);
    return Number(n(rows?.[0] || {}, 'N') || 0);
  } catch (error) {
    return `ERR:${String(error.message || error).slice(0, 80)}`;
  }
}

async function main() {
  await initDb();
  try {
    const p1 = await queryWithParams(
      `${DOC_SELECT}
        WHERE UPPER(TRIM(CVC.CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2))
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND CVC.IMPORTEVENCIMIENTO > 0
        ORDER BY CVC.ANOEMISION DESC, CVC.MESEMISION DESC, CVC.DIAEMISION DESC
        FETCH FIRST 4 ROWS ONLY`,
      ['P1'],
    );
    const pgSettled = await queryWithParams(
      `${DOC_SELECT}
        WHERE (UPPER(TRIM(COALESCE(FPG.PAGARESN, ''))) = CAST(? AS VARCHAR(1))
            OR UPPER(TRIM(CVC.CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2)))
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
          AND CVC.IMPORTEPENDIENTE = 0
          AND CVC.IMPORTEVENCIMIENTO > 0
          AND TRIM(CVC.TIPODOCUMENTO) <> CAST(? AS VARCHAR(3))
        ORDER BY CVC.ANOEMISION DESC, CVC.MESEMISION DESC, CVC.DIAEMISION DESC
        FETCH FIRST 4 ROWS ONLY`,
      ['S', 'PG', 'DEV'],
    );
    const dev = await queryWithParams(
      `${DOC_SELECT}
        WHERE TRIM(CVC.TIPODOCUMENTO) = CAST(? AS VARCHAR(3))
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
        ORDER BY CVC.ANOEMISION DESC, CVC.MESEMISION DESC, CVC.DIAEMISION DESC
        FETCH FIRST 3 ROWS ONLY`,
      ['DEV'],
    );
    const lqdCols = await queryWithParams(
      `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND (UPPER(COLUMN_NAME) LIKE CAST(? AS VARCHAR(40))
            OR UPPER(COLUMN_NAME) LIKE CAST(? AS VARCHAR(40)))
        ORDER BY ORDINAL_POSITION`,
      ['DSEDAC', 'LQD', '%INGRESAR%', '%EFECTIVO%'],
    );
    const tipoCounts = await queryWithParams(
      `SELECT TRIM(TIPODOCUMENTO) AS TIPO, COUNT(*) AS N
         FROM DSEDAC.CVC
        WHERE (ANULADOSN IS NULL OR ANULADOSN <> 'S')
          AND TRIM(TIPODOCUMENTO) IN (?, ?, ?, ?, ?, ?, ?)
        GROUP BY TRIM(TIPODOCUMENTO)`,
      ['COB', 'CAC', 'PGC', 'PGP', 'PAG', 'CNP', 'DEV'],
    );

    console.log(JSON.stringify({
      counts: {
        p1: await count(
          `SELECT COUNT(*) AS N FROM DSEDAC.CVC
            WHERE UPPER(TRIM(CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2))
              AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')`,
          ['P1'],
        ),
        pagareSn: await count(
          `SELECT COUNT(*) AS N FROM DSEDAC.CVC CVC
             JOIN DSEDAC.FPG FPG ON TRIM(FPG.CODIGOFORMAPAGO) = TRIM(CVC.CODIGOFORMAPAGO)
            WHERE UPPER(TRIM(FPG.PAGARESN)) = CAST(? AS VARCHAR(1))
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')`,
          ['S'],
        ),
        pgPendiente0: await count(
          `SELECT COUNT(*) AS N FROM DSEDAC.CVC CVC
             JOIN DSEDAC.FPG FPG ON TRIM(FPG.CODIGOFORMAPAGO) = TRIM(CVC.CODIGOFORMAPAGO)
            WHERE (UPPER(TRIM(FPG.PAGARESN)) = CAST(? AS VARCHAR(1))
                OR UPPER(TRIM(CVC.CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2)))
              AND CVC.IMPORTEPENDIENTE = 0
              AND CVC.IMPORTEVENCIMIENTO > 0
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')`,
          ['S', 'PG'],
        ),
        cvcDev: await count(
          `SELECT COUNT(*) AS N FROM DSEDAC.CVC
            WHERE TRIM(TIPODOCUMENTO) = CAST(? AS VARCHAR(3))
              AND (ANULADOSN IS NULL OR ANULADOSN <> 'S')`,
          ['DEV'],
        ),
        laclaeD: await count(
          `SELECT COUNT(*) AS N FROM DSED.LACLAE
            WHERE TRIM(LCSRAB) = CAST(? AS VARCHAR(1))`,
          ['D'],
        ),
        laclaeDv: await count(
          `SELECT COUNT(*) AS N FROM DSED.LACLAE
            WHERE TRIM(LCTPVT) = CAST(? AS VARCHAR(2))`,
          ['DV'],
        ),
        testDevoluciones: await count(
          `SELECT COUNT(*) AS N FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL`,
          [],
        ),
        testPedidosCab: await count(
          `SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDOS_CAB`,
          [],
        ),
        testPedidosLinDto: await count(
          `SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDOS_LIN
            WHERE COALESCE(PORCENTAJEDESCUENTO, 0) > 0`,
          [],
        ),
        pmr: await count(
          `SELECT COUNT(*) AS N FROM DSEDAC.PMR WHERE ANOFIN = 0 OR ANOFIN >= ?`,
          [2026],
        ),
        cpes: await count(
          `SELECT COUNT(*) AS N FROM DSEDAC.CPES WHERE ANOFINAL = 0 OR ANOFINAL >= ?`,
          [2026],
        ),
      },
      cvcTipos: (tipoCounts || []).map((row) => ({
        tipo: String(n(row, 'TIPO') || '').trim(),
        n: Number(n(row, 'N') || 0),
      })),
      lqdCols: (lqdCols || []).map((row) => String(n(row, 'COLUMN_NAME') || '').trim()),
      p1_30dff: (p1 || []).map(mapDoc),
      pgYaCobradosPendiente0: (pgSettled || []).map(mapDoc),
      cvcDev: (dev || []).map(mapDoc),
    }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
