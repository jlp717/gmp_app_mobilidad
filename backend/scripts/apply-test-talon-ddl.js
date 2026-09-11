'use strict';

/**
 * Apply 044/045 additive DDL on JAVIER.TEST_* only.
 * Never touches DSEDAC or JAVIER.REPARTIDOR_COBROS (prod peer).
 *
 *   node backend/scripts/apply-test-talon-ddl.js
 *   node backend/scripts/apply-test-talon-ddl.js --apply
 */

const path = require('path');
const { loadEnv } = require('../config/load-env');
loadEnv(path.join(__dirname, '..'));

const { initDb, closePool, query, queryWithParams } = require('../config/db');

const APPLY = process.argv.includes('--apply');
const COBROS = 'JAVIER.TEST_REPARTIDOR_COBROS';
const LINEAS = 'JAVIER.TEST_REPARTO_LINEAS';

const TALON_COLUMNS = Object.freeze([
  { name: 'NUMEROTALON', ddl: 'CHAR(10)' },
  { name: 'CODIGOENTIDADBANCARIA', ddl: 'CHAR(4)' },
  { name: 'NOMBREENTIDADBANCARIA', ddl: 'VARCHAR(40)' },
  { name: 'DIAVENCIMIENTO', ddl: 'NUMERIC(2, 0)' },
  { name: 'MESVENCIMIENTO', ddl: 'NUMERIC(2, 0)' },
  { name: 'ANOVENCIMIENTO', ddl: 'NUMERIC(4, 0)' },
  { name: 'EFECTIVOTALON', ddl: 'CHAR(1)' },
]);

function cell(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}

function text(value) {
  return String(value ?? '').trim();
}

async function tableExists(schema, table) {
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND TABLE_TYPE IN ('T', 'P')`,
    [schema, table],
  );
  return rows.length > 0;
}

async function columnNames(schema, table) {
  const rows = await queryWithParams(
    `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, table],
  );
  return new Set((rows || []).map((row) => text(cell(row, 'COLUMN_NAME')).toUpperCase()));
}

async function constraintNames(schema, table) {
  const rows = await queryWithParams(
    `SELECT CONSTRAINT_NAME FROM QSYS2.SYSCST
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, table],
  );
  return (rows || []).map((row) => text(cell(row, 'CONSTRAINT_NAME')).toUpperCase());
}

async function main() {
  await initDb();
  const evidence = {
    apply: APPLY,
    cobros: COBROS,
    lineas: LINEAS,
    added: [],
    alreadyPresent: [],
    lineasConstraint: null,
  };

  if (!(await tableExists('JAVIER', 'TEST_REPARTIDOR_COBROS'))) {
    throw new Error('missing JAVIER.TEST_REPARTIDOR_COBROS');
  }
  if (!(await tableExists('JAVIER', 'TEST_REPARTO_LINEAS'))) {
    throw new Error('missing JAVIER.TEST_REPARTO_LINEAS');
  }

  const existing = await columnNames('JAVIER', 'TEST_REPARTIDOR_COBROS');
  for (const column of TALON_COLUMNS) {
    if (existing.has(column.name)) {
      evidence.alreadyPresent.push(column.name);
      continue;
    }
    const sql = `ALTER TABLE ${COBROS} ADD COLUMN ${column.name} ${column.ddl}`;
    if (APPLY) {
      await query(sql);
      evidence.added.push(column.name);
    } else {
      evidence.added.push(`[DRY] ${column.name}`);
    }
  }

  const constraints = await constraintNames('JAVIER', 'TEST_REPARTO_LINEAS');
  const totalName = constraints.find((name) => name === 'CK_TEST_REP_LINEAS_TOTAL')
    || constraints.find((name) => name.includes('LINEAS_TOTAL'))
    || 'CK_TEST_REP_LINEAS_TOTAL';
  let checkClause = '';
  try {
    const checkRows = await queryWithParams(
      `SELECT CHECK_CLAUSE FROM QSYS2.SYSCHKCST
        WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = ?`,
      ['JAVIER', totalName],
    );
    checkClause = text(cell((checkRows || [])[0], 'CHECK_CLAUSE'));
  } catch (_error) {
    checkClause = '';
  }
  const alreadyOverDelivery = /CANTIDAD_ENTREGADA\s*>\s*CANTIDAD_PEDIDA/i.test(checkClause);
  evidence.checkClauseHasOverDelivery = alreadyOverDelivery;
  if (!APPLY) {
    evidence.lineasConstraint = `dry:${totalName}`;
  } else if (alreadyOverDelivery) {
    evidence.lineasConstraint = 'already-045';
  } else {
    const stillThere = constraints.includes(totalName) || constraints.includes('CK_TEST_REP_LINEAS_TOTAL');
    if (stillThere) {
      try {
        await query(`ALTER TABLE ${LINEAS} DROP CONSTRAINT JAVIER.${totalName}`);
      } catch (error) {
        evidence.dropWarning = String(error.message || error).slice(0, 120);
      }
    }
    await query(
      `ALTER TABLE ${LINEAS} ADD CONSTRAINT JAVIER.CK_TEST_REP_LINEAS_TOTAL CHECK
  (
    (CANTIDAD_ENTREGADA <= CANTIDAD_PEDIDA
      AND CANTIDAD_PEDIDA = CANTIDAD_ENTREGADA + CANTIDAD_RECHAZADA + CANTIDAD_PENDIENTE)
    OR (CANTIDAD_ENTREGADA > CANTIDAD_PEDIDA
      AND CANTIDAD_RECHAZADA = 0
      AND CANTIDAD_PENDIENTE = 0)
  )`,
    );
    evidence.lineasConstraint = 'replaced';
  }

  const after = await columnNames('JAVIER', 'TEST_REPARTIDOR_COBROS');
  evidence.confirmed = TALON_COLUMNS
    .filter((column) => column.name.startsWith('NUMERO')
      || column.name === 'CODIGOENTIDADBANCARIA'
      || column.name === 'NOMBREENTIDADBANCARIA'
      || column.name.endsWith('VENCIMIENTO')
      || column.name === 'EFECTIVOTALON')
    .map((column) => ({
      name: column.name,
      present: after.has(column.name) || (!APPLY && evidence.added.some((item) => item.includes(column.name))),
    }));
  evidence.all044Present = evidence.confirmed.every((row) => row.present === true || !APPLY);

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (APPLY && evidence.confirmed.some((row) => row.present !== true)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}).finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }));
