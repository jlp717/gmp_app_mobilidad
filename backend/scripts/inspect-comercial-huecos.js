'use strict';

/**
 * Readonly probe for comercial huecos (bolsa/alertas/asistente/cobros).
 * Never prints PIN. No DSEDAC writes. Run on 230:
 *   node backend/scripts/inspect-comercial-huecos.js
 */

const path = require('path');

const dbModule = (() => {
  const candidates = [
    '/opt/gmp-api/backend/config/db',
    path.resolve(__dirname, '../config/db'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* next */ }
  }
  throw new Error('db module not found');
})();

const { initDb, closePool, queryWithParams } = dbModule;

function n(v) { return Number(v || 0); }
function t(v) { return String(v == null ? '' : v).trim(); }

async function q(label, sql, params) {
  const started = Date.now();
  try {
    const rows = await queryWithParams(sql, params);
    return { label, ok: true, ms: Date.now() - started, rows: rows || [] };
  } catch (error) {
    return { label, ok: false, ms: Date.now() - started, error: String(error.message || error).slice(0, 240), rows: [] };
  }
}

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function main() {
  await initDb();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const vendor = String(process.env.HIT_COMERCIAL_VENDOR || '80').trim();

  const lacCols = await q('lacCols',
    `SELECT TRIM(COLUMN_NAME) AS N
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND (UPPER(COLUMN_NAME) LIKE '%VENDED%'
          OR UPPER(COLUMN_NAME) LIKE '%CLIENTE%'
          OR COLUMN_NAME IN ('ANODOCUMENTO','MESDOCUMENTO','DIADOCUMENTO','IMPORTEVENTA','SERIEALBARAN','NUMEROALBARAN','LCCDVD','CODIGOVENDEDOR'))
      ORDER BY ORDINAL_POSITION`,
    ['DSEDAC', 'LAC']);
  out({ lacCols: lacCols.ok ? lacCols.rows.map((r) => t(r.N)) : lacCols.error });

  const oppToday = await q('oppToday',
    `SELECT COUNT(*) AS N, COUNT(DISTINCT TRIM(CODIGOCLIENTE)) AS CLIENTES
       FROM DSEDAC.OPP
      WHERE ANOREPARTO = ? AND MESREPARTO = ? AND DIAREPARTO = ?
        AND TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))`,
    [year, month, day, vendor]);
  out({ oppToday: oppToday.ok ? oppToday.rows[0] : oppToday.error, ms: oppToday.ms });

  const lacToday = await q('lacToday',
    `SELECT COALESCE(SUM(IMPORTEVENTA),0) AS SALES,
            COUNT(DISTINCT TRIM(CODIGOCLIENTEALBARAN)) AS CLIENTES,
            COUNT(DISTINCT TRIM(SERIEALBARAN) CONCAT '-' CONCAT TRIM(CHAR(NUMEROALBARAN))) AS PEDIDOS,
            COUNT(*) AS LINEAS
       FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO = ?
        AND TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))`,
    [year, month, day, vendor]);
  out({ lacTodayVd: lacToday.ok ? lacToday.rows[0] : lacToday.error, ms: lacToday.ms });

  const lacTodayLcc = await q('lacTodayLcc',
    `SELECT COALESCE(SUM(IMPORTEVENTA),0) AS SALES,
            COUNT(DISTINCT TRIM(CODIGOCLIENTEALBARAN)) AS CLIENTES,
            COUNT(*) AS LINEAS
       FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO = ?
        AND TRIM(LCCDVD) = CAST(? AS VARCHAR(2))`,
    [year, month, day, vendor]);
  out({ lacTodayLcc: lacTodayLcc.ok ? lacTodayLcc.rows[0] : lacTodayLcc.error, ms: lacTodayLcc.ms });

  const bolsa = await q('bolsaMonth',
    `SELECT B.EJERCICIO, B.MES, B.ACUMULADO, B.CONSUMIDO, B.SALDO_DISPONIBLE,
            (SELECT COUNT(*) FROM JAVIER.MOVIMIENTOS_BOLSA M WHERE M.BOLSA_ID = B.ID) AS MOV
       FROM JAVIER.BOLSA_COMERCIAL B
      WHERE TRIM(B.CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
        AND B.EJERCICIO = ? AND B.MES = ?
      FETCH FIRST 1 ROW ONLY`,
    [vendor, year, month]);
  out({ bolsaMonth: bolsa.ok ? (bolsa.rows[0] || null) : bolsa.error });

  const movAny = await q('bolsaMovAny',
    `SELECT B.EJERCICIO, B.MES, COUNT(*) AS N
       FROM JAVIER.MOVIMIENTOS_BOLSA M
       JOIN JAVIER.BOLSA_COMERCIAL B ON B.ID = M.BOLSA_ID
      WHERE TRIM(B.CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
      GROUP BY B.EJERCICIO, B.MES
      ORDER BY B.EJERCICIO DESC, B.MES DESC
      FETCH FIRST 6 ROWS ONLY`,
    [vendor]);
  out({ bolsaMovByMonth: movAny.ok ? movAny.rows : movAny.error });

  const histRows = await q('bolsaHist',
    `SELECT COUNT(*) AS N FROM JAVIER.BOLSA_COMERCIAL
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))`,
    [vendor]);
  out({ bolsaHistRows: histRows.ok ? histRows.rows[0] : histRows.error });

  const alerts = await q('kpiAlerts',
    `SELECT COUNT(*) AS ALERTS, COUNT(DISTINCT TRIM(CLIENT_CODE)) AS CLIENTS
       FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1`,
    []);
  out({ kpiActive: alerts.ok ? alerts.rows[0] : alerts.error });

  const clpClients = await q('clpClients',
    `SELECT COUNT(DISTINCT TRIM(CODIGOCLIENTE)) AS N
       FROM DSEDAC.CLP
      WHERE TRIM(VENDEDORCOMERCIAL) = CAST(? AS VARCHAR(2))`,
    [vendor]);
  out({ clpClients: clpClients.ok ? clpClients.rows[0] : clpClients.error, ms: clpClients.ms });

  const laclaeNow = await q('laclaeNow',
    `SELECT COUNT(DISTINCT TRIM(LCCDCL)) AS N
       FROM DSED.LACLAE
      WHERE TRIM(LCCDVD) = CAST(? AS VARCHAR(2))
        AND LCAADC = YEAR(CURRENT_DATE)
        AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT')`,
    [vendor]);
  out({ laclaeCurrentYear: laclaeNow.ok ? laclaeNow.rows[0] : laclaeNow.error, ms: laclaeNow.ms });

  const sampleAlert = await q('sampleAlert',
    `SELECT TRIM(CLIENT_CODE) AS CODE
       FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1
      FETCH FIRST 5 ROWS ONLY`,
    []);
  out({ sampleAlertCodes: sampleAlert.ok ? sampleAlert.rows.map((r) => t(r.CODE)) : sampleAlert.error });

  const cvcClp = await q('cvcClp35',
    `SELECT COUNT(*) AS N, COALESCE(SUM(IMPORTEPENDIENTE),0) AS IMP
       FROM DSEDAC.CVC CVC
      WHERE CVC.IMPORTEPENDIENTE > 0
        AND TRIM(CVC.CODIGOCLIENTEALBARAN) IN (
          SELECT TRIM(CLP.CODIGOCLIENTE) FROM DSEDAC.CLP CLP
           WHERE TRIM(CLP.VENDEDORCOMERCIAL) IN ('35','35')
        )`,
    []);
  out({ cvcClp35: cvcClp.ok ? cvcClp.rows[0] : cvcClp.error, ms: cvcClp.ms });

  const cvcClp98 = await q('cvcClp98',
    `SELECT COUNT(*) AS N, COALESCE(SUM(IMPORTEPENDIENTE),0) AS IMP
       FROM DSEDAC.CVC CVC
      WHERE CVC.IMPORTEPENDIENTE > 0
        AND TRIM(CVC.CODIGOCLIENTEALBARAN) IN (
          SELECT TRIM(CLP.CODIGOCLIENTE) FROM DSEDAC.CLP CLP
           WHERE TRIM(CLP.VENDEDORCOMERCIAL) IN ('98','98')
        )`,
    []);
  out({ cvcClp98: cvcClp98.ok ? cvcClp98.rows[0] : cvcClp98.error, ms: cvcClp98.ms });

  out({
    meta: { year, month, day, vendor, note: 'readonly' },
    summary: {
      oppN: n(oppToday.rows[0] && oppToday.rows[0].N),
      lacSales: n(lacToday.rows[0] && lacToday.rows[0].SALES) || n(lacTodayLcc.rows[0] && lacTodayLcc.rows[0].SALES),
      bolsaMovThisMonth: n(bolsa.rows[0] && bolsa.rows[0].MOV),
      bolsaAcum: n(bolsa.rows[0] && bolsa.rows[0].ACUMULADO),
      kpiAlerts: n(alerts.rows[0] && alerts.rows[0].ALERTS),
      clpN: n(clpClients.rows[0] && clpClients.rows[0].N),
      laclaeYearN: n(laclaeNow.rows[0] && laclaeNow.rows[0].N),
    },
  });
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => undefined));
