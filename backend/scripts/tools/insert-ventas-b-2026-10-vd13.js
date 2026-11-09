'use strict';

/**
 * Inserta UNA fila en JAVIER.VENTAS_B:
 *   vendedor 13, ejercicio 2026, mes 10, importe 18713.14
 * No borra ni actualiza. Si la clave ya existe, no inserta.
 *
 *   node backend/scripts/tools/insert-ventas-b-2026-10-vd13.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { initDb, queryWithParams, closePool } = require('../../config/db');

const EJERCICIO = 2026;
const MES = 10;
const VENDOR = '13';
const IMPORTE = 18713.14;

function n(v) {
  return Number(v) || 0;
}
function r2(v) {
  return Math.round(n(v) * 100) / 100;
}
function vendorKey(code) {
  return String(code || '').trim().replace(/^0+/, '') || '0';
}
function rowKey(row) {
  return [
    vendorKey(row.CODIGOVENDEDOR || row.codigovendedor),
    n(row.EJERCICIO || row.ejercicio),
    n(row.MES || row.mes),
    r2(row.IMPORTE || row.importe),
  ].join('|');
}

async function loadAll() {
  return queryWithParams(
    `SELECT TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE
     FROM JAVIER.VENTAS_B
     ORDER BY EJERCICIO, MES, CODIGOVENDEDOR`,
    [],
    false
  );
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
  if (!tables.length) throw new Error('No existe JAVIER.VENTAS_B');

  const before = await loadAll();
  const beforeKeys = new Set(before.map(rowKey));
  console.log('COUNT_BEFORE', before.length);

  const sameKey = before.filter((row) => {
    return vendorKey(row.CODIGOVENDEDOR) === VENDOR
      && n(row.EJERCICIO) === EJERCICIO
      && n(row.MES) === MES;
  });
  if (sameKey.length > 1) {
    console.error('DUPLICADOS', JSON.stringify(sameKey));
    throw new Error('Ya hay más de una fila para vendedor 13 / 2026 / octubre. No se toca nada.');
  }
  if (sameKey.length === 1) {
    const current = r2(sameKey[0].IMPORTE);
    if (current === r2(IMPORTE)) {
      console.log('YA_EXISTE', current);
      return;
    }
    console.error('CONFLICTO', JSON.stringify(sameKey[0]));
    throw new Error(`Ya existe octubre 2026 del vendedor 13 con importe ${current}. No se actualiza ni se inserta.`);
  }

  await queryWithParams(
    `INSERT INTO JAVIER.VENTAS_B (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
     VALUES (?, ?, ?, ?)`,
    [VENDOR, EJERCICIO, MES, IMPORTE],
    false
  );
  console.log('INSERTED', VENDOR, EJERCICIO, MES, IMPORTE);

  const after = await loadAll();
  console.log('COUNT_AFTER', after.length);
  if (after.length !== before.length + 1) {
    throw new Error(`Count mismatch: before=${before.length} after=${after.length}`);
  }

  const afterKeys = new Set(after.map(rowKey));
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key));
  const added = [...afterKeys].filter((key) => !beforeKeys.has(key));
  console.log('REMOVED', JSON.stringify(removed));
  console.log('ADDED', JSON.stringify(added));
  if (removed.length !== 0 || added.length !== 1 || added[0] !== `${VENDOR}|${EJERCICIO}|${MES}|${r2(IMPORTE)}`) {
    throw new Error('La diferencia no es exactamente la fila nueva. Revisar antes de cualquier corrección.');
  }
  console.log('OK');
}

main()
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch (_) {
      /* ignore */
    }
  });
