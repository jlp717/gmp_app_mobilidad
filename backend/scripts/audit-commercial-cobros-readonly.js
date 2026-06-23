'use strict';

/**
 * Read-only audit for commercial cobros.
 *
 * It reconciles ERP debt from DSEDAC.CVC with app-side commercial/repartidor
 * payments and provisional app orders still waiting for ERP document generation.
 * No DDL/DML is executed.
 *
 * Usage:
 *   node scripts/audit-commercial-cobros-readonly.js --vendors=93,98
 *   node scripts/audit-commercial-cobros-readonly.js --vendors=ALL --visible=01,02,93
 */

const fs = require('fs');
const path = require('path');
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');

const APP_SCHEMA = process.env.DB2_WRITE_SCHEMA || 'JAVIER';
const ERP_SCHEMA = process.env.DB2_READ_SCHEMA || 'DSEDAC';
const OUT_DIR = path.join(__dirname, '..', 'tmp', 'db-exploration');

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function normalizeVendorList(value) {
  return String(value || '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
    .filter((code) => /^[A-Za-z0-9]{1,10}$/.test(code));
}

function vendorVariants(codes) {
  const variants = new Set();
  for (const code of codes) {
    variants.add(code);
    const unpadded = code.replace(/^0+/, '');
    if (unpadded) variants.add(unpadded);
  }
  return [...variants];
}

function buildVendorScope(cvcAlias, codes) {
  const variants = vendorVariants(codes);
  if (variants.length === 0) {
    return {
      clause: `AND TRIM(${cvcAlias}.CODIGOCLIENTEALBARAN) <> ''`,
      params: [],
    };
  }
  return {
    clause: `
      AND EXISTS (
        SELECT 1
          FROM ${ERP_SCHEMA}.CLP CLP
         WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(${cvcAlias}.CODIGOCLIENTEALBARAN)
           AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${variants.map(() => '?').join(', ')})
      )`,
    params: variants,
  };
}

function cvcNetCte(scope) {
  return `
    WITH CVC_DOCS AS (
      SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
             COALESCE(NULLIF(TRIM(MIN(CLI.NOMBREALTERNATIVO)), ''), TRIM(MIN(CLI.NOMBRECLIENTE)), '') AS NOMBRE,
             TRIM(CVC.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
             TRIM(CAST(CVC.NUMERODOCUMENTO AS VARCHAR(20))) AS NUMERO_DOCUMENTO,
             SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
             SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                 <= (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                  THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO
        FROM ${ERP_SCHEMA}.CVC CVC
        LEFT JOIN ${ERP_SCHEMA}.CLI CLI
          ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
       WHERE CVC.IMPORTEPENDIENTE > 0.01
         AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
         ${scope.clause}
       GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN), TRIM(CVC.SERIEDOCUMENTO), TRIM(CAST(CVC.NUMERODOCUMENTO AS VARCHAR(20)))
    ), APP_COBROS AS (
      SELECT D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO,
             COALESCE(SUM(C.IMPORTE), 0) AS TOTAL_APP
        FROM CVC_DOCS D
        JOIN ${APP_SCHEMA}.COBROS C
          ON TRIM(C.CODIGO_CLIENTE) = D.CLIENTE
         AND (TRIM(C.REFERENCIA) = D.SERIE_DOCUMENTO || '-' || D.NUMERO_DOCUMENTO
              OR TRIM(C.REFERENCIA) LIKE '%:' || D.SERIE_DOCUMENTO || '-' || D.NUMERO_DOCUMENTO)
       GROUP BY D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO
    ), REP_COBROS AS (
      SELECT D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO,
             COALESCE(SUM(R.IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
        FROM CVC_DOCS D
        JOIN ${APP_SCHEMA}.REPARTIDOR_COBROS R
          ON TRIM(R.CODIGOCLIENTEALBARAN) = D.CLIENTE
         AND TRIM(R.SERIEDOCUMENTO) = D.SERIE_DOCUMENTO
         AND TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20))) = D.NUMERO_DOCUMENTO
       GROUP BY D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO
    ), DOC_NET AS (
      SELECT D.CLIENTE, D.NOMBRE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO,
             D.TOTAL_PENDIENTE, D.TOTAL_VENCIDO,
             COALESCE(A.TOTAL_APP, 0) + COALESCE(R.TOTAL_REP, 0) AS PAID,
             CASE
               WHEN D.TOTAL_PENDIENTE - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0) > 0
               THEN D.TOTAL_PENDIENTE - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0)
               ELSE 0
             END AS NET_TOTAL,
             CASE
               WHEN D.TOTAL_VENCIDO <= 0 THEN 0
               WHEN D.TOTAL_VENCIDO - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0) > 0
               THEN D.TOTAL_VENCIDO - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0)
               ELSE 0
             END AS NET_VENCIDO
        FROM CVC_DOCS D
        LEFT JOIN APP_COBROS A
          ON A.CLIENTE = D.CLIENTE
         AND A.SERIE_DOCUMENTO = D.SERIE_DOCUMENTO
         AND A.NUMERO_DOCUMENTO = D.NUMERO_DOCUMENTO
        LEFT JOIN REP_COBROS R
          ON R.CLIENTE = D.CLIENTE
         AND R.SERIE_DOCUMENTO = D.SERIE_DOCUMENTO
         AND R.NUMERO_DOCUMENTO = D.NUMERO_DOCUMENTO
    )`;
}

async function query(conn, sql, params = []) {
  return params.length ? conn.query(sql, params) : conn.query(sql);
}

async function auditVendor(conn, label, codes) {
  const scope = buildVendorScope('CVC', codes);
  const cte = cvcNetCte(scope);
  const totalsRows = await query(conn, `${cte}
    SELECT COUNT(*) AS DOCS_RAW,
           COUNT(CASE WHEN NET_TOTAL > 0 THEN 1 ELSE NULL END) AS DOCS_NET,
           COUNT(DISTINCT CASE WHEN NET_TOTAL > 0 THEN CLIENTE ELSE NULL END) AS CLIENTS_NET,
           COUNT(DISTINCT CASE WHEN NET_VENCIDO > 0 THEN CLIENTE ELSE NULL END) AS CLIENTS_VENCIDO,
           COALESCE(SUM(TOTAL_PENDIENTE), 0) AS ERP_RAW,
           COALESCE(SUM(TOTAL_VENCIDO), 0) AS ERP_RAW_VENCIDO,
           COALESCE(SUM(PAID), 0) AS APP_PAID_OFFSET,
           COALESCE(SUM(NET_TOTAL), 0) AS NET_PENDING,
           COALESCE(SUM(NET_VENCIDO), 0) AS NET_VENCIDO
      FROM DOC_NET`, scope.params);

  const topRows = await query(conn, `${cte}
    SELECT CLIENTE, COALESCE(NULLIF(TRIM(MIN(NOMBRE)), ''), CLIENTE) AS NOMBRE,
           COUNT(*) AS DOCS,
           COALESCE(SUM(NET_TOTAL), 0) AS NET_PENDING,
           COALESCE(SUM(NET_VENCIDO), 0) AS NET_VENCIDO
      FROM DOC_NET
     WHERE NET_TOTAL > 0
     GROUP BY CLIENTE
     ORDER BY NET_PENDING DESC
     FETCH FIRST 20 ROWS ONLY`, scope.params);

  return {
    label,
    vendorCodes: codes,
    totals: totalsRows[0] || {},
    topClients: topRows || [],
  };
}

async function auditAppProvisional(conn, codes) {
  const variants = vendorVariants(codes);
  const vendorFilter = variants.length
    ? `AND TRIM(PC.CODIGOVENDEDOR) IN (${variants.map(() => '?').join(', ')})`
    : '';
  const sql = `
    WITH APP_DOCS AS (
      SELECT TRIM(PC.CODIGOCLIENTE) AS CLIENTE,
             COALESCE(MAX(PC.IMPORTETOTAL), 0) AS IMPORTE_TOTAL
        FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
       WHERE PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
         AND PC.IMPORTETOTAL > 0
         AND TRIM(PC.CODIGOCLIENTE) <> ''
         AND COALESCE(PC.SYSTEM_NUMEROPEDIDO, 0) = 0
         ${vendorFilter}
       GROUP BY TRIM(PC.CODIGOCLIENTE), PC.ID
    )
    SELECT COUNT(*) AS PEDIDOS,
           COUNT(DISTINCT CLIENTE) AS CLIENTES,
           COALESCE(SUM(IMPORTE_TOTAL), 0) AS TOTAL
      FROM APP_DOCS`;
  const rows = await query(conn, sql, variants);
  return rows[0] || {};
}

async function main() {
  const vendorsArg = argValue('vendors', 'ALL');
  const visibleArg = argValue('visible', '');
  const vendors = normalizeVendorList(vendorsArg);
  const visible = normalizeVendorList(visibleArg);
  const isAll = String(vendorsArg).trim().toUpperCase() === 'ALL';
  const effectiveCodes = isAll ? visible : vendors;

  const report = {
    generatedAt: new Date().toISOString(),
    schemas: { app: APP_SCHEMA, erp: ERP_SCHEMA },
    requested: { vendors: vendorsArg, visible: visibleArg },
    notes: [
      'READ ONLY: no DDL/DML is executed.',
      'NET_PENDING = DSEDAC.CVC pending minus app-side COBROS/REPARTIDOR_COBROS offsets.',
      'APP provisional orders are JAVIER.PEDIDOS_CAB confirmed/enviado with no SYSTEM_NUMEROPEDIDO yet.',
    ],
    scopes: [],
  };

  const conn = await odbc.connect(db2ConnectionString({
    mode: process.env.DB2_CONNECTION_MODE || 'dsn',
    extras: 'NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180',
  }));
  try {
    report.scopes.push(await auditVendor(conn, isAll ? 'ALL_VISIBLE' : vendors.join(','), effectiveCodes));
    report.appProvisional = await auditAppProvisional(conn, effectiveCodes);
  } finally {
    await conn.close();
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUT_DIR, `commercial-cobros-audit-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    outPath,
    totals: report.scopes[0]?.totals || {},
    appProvisional: report.appProvisional,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
