#!/usr/bin/env node
/**
 * discover-dsedac-columns.js
 * Queries QSYS2.SYSCOLUMNS for all DSEDAC source tables to get exact column definitions.
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });


function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " environment variable is required");
  }
  return value;
}

const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_UID = requireEnv('ODBC_UID');
const DB_PWD = requireEnv('ODBC_PWD');

const CONNECTION_STRING = [
  `DSN=${DB_DSN}`,
  `UID=${DB_UID}`,
  `PWD=${DB_PWD}`,
  'NAM=1',
  'CCSID=1208',
  'CMPTDM=1',
].join(';');

// DSEDAC source tables mapped to JAVIER target tables
const TABLE_MAP = [
  { dsedac: 'CVC', javier: 'REPARTIDOR_COBROS', desc: 'Cobros' },
  { dsedac: 'LQD', javier: 'REPARTIDOR_LIQUIDACION_OPS', desc: 'Liquidaciones' },
  { dsedac: 'OPP', javier: 'REPARTIDOR_ENTREGAS', desc: 'Entregas (cabecera)' },
  { dsedac: 'LAC', javier: 'REPARTIDOR_ENTREGA_LINEAS', desc: 'Entrega líneas' },
  { dsedac: 'CACFIRMAS', javier: 'REPARTIDOR_FIRMAS', desc: 'Firmas' },
  { dsedac: 'CMV', javier: 'REPARTIDOR_OBJETIVOS', desc: 'Objetivos' },
  { dsedac: 'CPC', javier: 'DELIVERY_STATUS', desc: 'Delivery status' },
  { dsedac: 'CLI', javier: 'CLIENT_SIGNERS', desc: 'Client signers' },
];

async function main() {
  let pool = null;
  let conn = null;

  try {
    pool = await odbc.pool(CONNECTION_STRING);
    conn = await pool.connect();

    const results = {};

    for (const tbl of TABLE_MAP) {
      console.log(`\n=== DSEDAC.${tbl.dsedac} → JAVIER.${tbl.javier} (${tbl.desc}) ===`);

      const query = `
        SELECT 
          COLUMN_NAME,
          SYSTEM_COLUMN_NAME,
          DATA_TYPE,
          LENGTH,
          NUMERIC_SCALE,
          IS_NULLABLE,
          HAS_DEFAULT,
          COLUMN_DEFAULT,
          COLUMN_TEXT,
          ORDINAL_POSITION
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC'
          AND TABLE_NAME = '${tbl.dsedac}'
        ORDER BY ORDINAL_POSITION
      `;

      try {
        const rows = await conn.query(query);
        results[tbl.dsedac] = rows;
        console.log(`  Found ${rows.length} columns:`);
        for (const row of rows) {
          const nullable = row.IS_NULLABLE === 'Y' ? 'NULL' : 'NOT NULL';
          const dtype = row.DATA_TYPE;
          const len = row.LENGTH || '';
          const scale = row.NUMERIC_SCALE !== null && row.NUMERIC_SCALE !== undefined ? `,${row.NUMERIC_SCALE}` : '';
          const def = row.HAS_DEFAULT === 'Y' ? ` DEFAULT ${row.COLUMN_DEFAULT || ''}` : '';
          const text = row.COLUMN_TEXT ? ` -- ${row.COLUMN_TEXT}` : '';
          console.log(`  ${row.ORDINAL_POSITION}. ${row.COLUMN_NAME || row.SYSTEM_COLUMN_NAME} ${dtype}${len}${scale} ${nullable}${def}${text}`);
        }
      } catch (err) {
        console.error(`  ERROR querying DSEDAC.${tbl.dsedac}: ${err.message}`);
        results[tbl.dsedac] = [];
      }
    }

    // Save results to JSON for reference
    const outputPath = path.resolve(__dirname, 'results', 'dsedac-column-discovery.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to ${outputPath}`);

  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (conn) { try { await conn.close(); } catch (_) {} }
    if (pool) { try { await pool.close(); } catch (_) {} }
  }
}

main();
