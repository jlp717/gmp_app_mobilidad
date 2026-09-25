// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-bootstrap | _-scratch gitignored; bootstrap puntual objetos test faltantes | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/** Create missing isolated_test objects by LIKE from production JAVIER tables. */
const odbc = require('odbc');

const STATEMENTS = [
  `CREATE TABLE JAVIER.TEST_REPARTIDOR_COMMISSION_TIERS LIKE JAVIER.REPARTIDOR_COMMISSION_TIERS INCLUDING IDENTITY INCLUDING DEFAULTS INCLUDING COLUMN DEFAULTS`,
  `CREATE TABLE JAVIER.TEST_REPARTIDOR_LIQUIDACION_EMAILS LIKE JAVIER.REPARTIDOR_LIQUIDACION_EMAILS INCLUDING IDENTITY INCLUDING DEFAULTS INCLUDING COLUMN DEFAULTS`,
  `CREATE TABLE JAVIER.TEST_COBROS LIKE JAVIER.COBROS INCLUDING IDENTITY INCLUDING DEFAULTS INCLUDING COLUMN DEFAULTS`,
  `CREATE SEQUENCE JAVIER.TEST_REPARTIDOR_LIQUIDACION_SEQ AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE CACHE 20`,
];

async function exists(conn, schema, name, kind) {
  if (kind === 'table') {
    const rows = await conn.query(
      'SELECT 1 AS OK FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [schema, name],
    );
    return rows.length > 0;
  }
  const rows = await conn.query(
    'SELECT 1 AS OK FROM QSYS2.SYSSEQUENCES WHERE SEQUENCE_SCHEMA = ? AND SEQUENCE_NAME = ?',
    [schema, name],
  );
  return rows.length > 0;
}

async function main() {
  const cs = `DSN=${process.env.ODBC_DSN};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD}`;
  const conn = await odbc.connect({ connectionString: cs });
  const results = [];
  try {
    const checks = [
      ['table', 'TEST_REPARTIDOR_COMMISSION_TIERS', STATEMENTS[0]],
      ['table', 'TEST_REPARTIDOR_LIQUIDACION_EMAILS', STATEMENTS[1]],
      ['table', 'TEST_COBROS', STATEMENTS[2]],
      ['sequence', 'TEST_REPARTIDOR_LIQUIDACION_SEQ', STATEMENTS[3]],
    ];
    for (const [kind, name, sql] of checks) {
      const already = await exists(conn, 'JAVIER', name, kind);
      if (already) {
        results.push({ name, status: 'exists' });
        continue;
      }
      try {
        await conn.query(sql);
        results.push({ name, status: 'created' });
      } catch (err) {
        results.push({ name, status: 'error', error: String(err && err.message || err).slice(0, 300) });
      }
    }
  } finally {
    await conn.close();
  }
  console.log(JSON.stringify({ results }, null, 2));
  if (results.some((r) => r.status === 'error')) process.exit(2);
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(1);
});
