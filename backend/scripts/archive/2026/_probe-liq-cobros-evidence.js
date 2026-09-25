// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual evidencia liq-cobros | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

function cs() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  return [`DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`, 'NAM=1', 'CCSID=1208'].join(';');
}

async function safe(conn, label, sql, params = []) {
  try {
    const rows = params.length ? await conn.query(sql, params) : await conn.query(sql);
    return { ok: true, label, count: rows.length, rows };
  } catch (err) {
    return { ok: false, label, error: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const conn = await odbc.connect(cs());
  const out = {};

  out.lqdRecent = await safe(conn, 'lqdRecent', `
    SELECT TRIM(CODIGOVENDEDOR) V,
           DIALIQUIDACION D, MESLIQUIDACION M, ANOLIQUIDACION A,
           IMPORTEEFECTIVO, IMPORTETARJETA, IMPORTETOTALAINGRESAR
      FROM JAVIER.TEST_LQD
     ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC
     FETCH FIRST 5 ROWS ONLY
  `);

  out.cobrosRecent = await safe(conn, 'cobrosRecent', `
    SELECT ID, TRIM(CODIGO_CLIENTE) CLIENTE, TRIM(CODIGO_USUARIO) V,
           IMPORTE, TRIM(FORMA_PAGO) FP, FECHA
      FROM JAVIER.TEST_COBROS
     ORDER BY ID DESC
     FETCH FIRST 8 ROWS ONLY
  `);

  out.cobrosNotInRepartidor = await safe(conn, 'cobrosNotInRepartidor', `
    SELECT COUNT(*) AS overlap
      FROM JAVIER.TEST_COBROS C
     WHERE EXISTS (
       SELECT 1 FROM JAVIER.TEST_REPARTIDOR_COBROS R
        WHERE TRIM(R.CODIGOCLIENTEFACTURA) = TRIM(C.CODIGO_CLIENTE)
          AND ABS(R.IMPORTEVENCIMIENTO - C.IMPORTE) < 0.01
          AND R.DIAEMISION = DAY(C.FECHA)
          AND R.MESEMISION = MONTH(C.FECHA)
          AND R.ANOEMISION = YEAR(C.FECHA)
     )
  `);

  // Simulate pedido 67 bolsa after fix (dto 10% on tariff lines)
  const { resolveEffectiveSalePrice, getLineQuantity } = require('../services/bolsa-comercial.service');
  const lines = [
    { precioVenta: 9.593, precioTarifaCliente: 9.593, cantidadEnvases: 3, unidadMedida: 'CAJAS' },
    { precioVenta: 5.85, precioTarifaCliente: 5.85, cantidadUnidades: 2.5, unidadMedida: 'KILOGRAMOS' },
  ];
  let consumo0 = 0;
  let consumo10 = 0;
  for (const line of lines) {
    const ref = line.precioTarifaCliente;
    const qty = getLineQuantity(line);
    const p0 = resolveEffectiveSalePrice(line, 0);
    const p10 = resolveEffectiveSalePrice(line, 10);
    if (p0 + 0.0001 < ref) consumo0 += (ref - p0) * qty;
    if (p10 + 0.0001 < ref) consumo10 += (ref - p10) * qty;
  }
  out.pedido67Sim = {
    consumoSinDto: Math.round(consumo0 * 100) / 100,
    consumoConDto10: Math.round(consumo10 * 100) / 100,
    note: 'Confirmados previos a fix no escribieron TEST_MOVIMIENTOS_BOLSA; post-fix+deploy deben escribir consumo.',
  };

  console.log(JSON.stringify(out, null, 2));
  await conn.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
