'use strict';

/**
 * Inserta SOLO las 3 filas CONDOR sept-2026 en JAVIER.VENTAS_B.
 * No borra ni actualiza filas existentes. Si ya hay clave vendedor/año/mes, no inserta.
 *
 *   node backend/scripts/tools/insert-ventas-b-2026-09.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { initDb, queryWithParams, closePool } = require('../../config/db');

const EJERCICIO = 2026;
const MES = 9;
const ROWS = [
  { vendor: '1', importe: -2993.93 },
  { vendor: '13', importe: 17785.15 },
  { vendor: '97', importe: 5823.78 },
];
const EXPECTED_TOTAL = 20615.0;

function n(v) {
  return Number(v) || 0;
}
function r2(v) {
  return Math.round(n(v) * 100) / 100;
}
function vendorKey(code) {
  return String(code || '').trim().replace(/^0+/, '') || '0';
}

async function main() {
  await initDb();

  const tables = await queryWithParams(
    `SELECT TABLE_SCHEMA, TABLE_NAME
     FROM QSYS2.SYSTABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    ['JAVIER', 'VENTAS_B'],
    false
  );
  if (!tables.length) {
    throw new Error('No existe JAVIER.VENTAS_B');
  }

  const cols = await queryWithParams(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
     FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    ['JAVIER', 'VENTAS_B'],
    false
  );
  console.log('COLUMNAS', JSON.stringify(cols, null, 2));

  const countBeforeRows = await queryWithParams(
    `SELECT COUNT(*) AS N FROM JAVIER.VENTAS_B`,
    [],
    false
  );
  const countBefore = n(countBeforeRows[0] && countBeforeRows[0].N);
  console.log('COUNT_BEFORE', countBefore);

  const yearMonth = await queryWithParams(
    `SELECT CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE
     FROM JAVIER.VENTAS_B
     WHERE EJERCICIO = ? AND MES = ?
     ORDER BY CODIGOVENDEDOR`,
    [EJERCICIO, MES],
    false
  );
  console.log('EXISTENTES_2026_M9', JSON.stringify(yearMonth, null, 2));

  const existingByVendor = new Map();
  for (const row of yearMonth) {
    existingByVendor.set(vendorKey(row.CODIGOVENDEDOR), r2(row.IMPORTE));
  }

  const toInsert = [];
  const skipped = [];
  const conflicts = [];
  for (const row of ROWS) {
    const key = vendorKey(row.vendor);
    if (!existingByVendor.has(key)) {
      toInsert.push(row);
      continue;
    }
    const current = existingByVendor.get(key);
    if (current === r2(row.importe)) {
      skipped.push({ ...row, current });
    } else {
      conflicts.push({ ...row, current });
    }
  }

  if (conflicts.length) {
    console.error('CONFLICTOS', JSON.stringify(conflicts, null, 2));
    throw new Error('Hay filas con misma clave y importe distinto. No se inserta ni se actualiza.');
  }

  for (const row of toInsert) {
    await queryWithParams(
      `INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
       VALUES (?, ?, ?, ?)`,
      [row.vendor, EJERCICIO, MES, row.importe],
      false
    );
    console.log('INSERTED', row.vendor, EJERCICIO, MES, row.importe);
  }

  const after = await queryWithParams(
    `SELECT CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE
     FROM JAVIER.VENTAS_B
     WHERE EJERCICIO = ? AND MES = ?
       AND TRIM(CODIGOVENDEDOR) IN ('1', '01', '13', '97')
     ORDER BY CODIGOVENDEDOR`,
    [EJERCICIO, MES],
    false
  );
  console.log('DESPUES_3_FILAS', JSON.stringify(after, null, 2));

  const countAfterRows = await queryWithParams(
    `SELECT COUNT(*) AS N FROM JAVIER.VENTAS_B`,
    [],
    false
  );
  const countAfter = n(countAfterRows[0] && countAfterRows[0].N);
  console.log('COUNT_AFTER', countAfter);
  console.log('SKIPPED', JSON.stringify(skipped));
  console.log('INSERTED_N', toInsert.length);

  if (countAfter !== countBefore + toInsert.length) {
    throw new Error(
      `Count mismatch: before=${countBefore} inserted=${toInsert.length} after=${countAfter}`
    );
  }

  const byVendor = new Map();
  for (const row of after) {
    const key = vendorKey(row.CODIGOVENDEDOR);
    byVendor.set(key, (byVendor.get(key) || 0) + r2(row.IMPORTE));
  }
  let sum = 0;
  for (const expected of ROWS) {
    const got = r2(byVendor.get(vendorKey(expected.vendor)));
    sum = r2(sum + got);
    if (got !== r2(expected.importe)) {
      throw new Error(
        `Importe incorrecto vendedor ${expected.vendor}: esperado ${expected.importe} obtenido ${got}`
      );
    }
  }
  if (sum !== r2(EXPECTED_TOTAL)) {
    throw new Error(`Total incorrecto: esperado ${EXPECTED_TOTAL} obtenido ${sum}`);
  }
  console.log('OK_TOTAL', sum);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch (_) {
      /* ignore */
    }
  });
