'use strict';

/**
 * SAFE seed: JAVIER prod + read-only ERP → JAVIER.TEST_* only.
 * NEVER writes to DSEDAC / DSED / production ERP.
 *
 * Usage:
 *   node backend/scripts/copy-javier-prod-to-test.js            # dry-run
 *   node backend/scripts/copy-javier-prod-to-test.js --apply     # execute
 *   node backend/scripts/copy-javier-prod-to-test.js --apply --days=30
 *   node backend/scripts/copy-javier-prod-to-test.js --apply --repartidor=08
 *   node backend/scripts/copy-javier-prod-to-test.js --apply --skip-cvc
 *
 * Sources of truth:
 * - Isomorphic: TABLE_MAPPINGS production → isolated_test (when both exist)
 * - ERP liquidacion: DSEDAC.LQD → TEST_REPARTIDOR_LIQUIDACION_OPS (intersection)
 * - ERP cobros: DSEDAC.LQD efectivo/cheques/tarjeta/postdatados → TEST_REPARTIDOR_COBROS
 *   (DSEDAC.CVC.DIACOBRO is always 0 — cannot seed cobros from CVC dates)
 * - ERP ingresos/saldos: LQD.IMPORTEINGRESOENBANCO / IMPORTESALDOACTUAL
 * - ERP firmas: DSEDAC.CACFIRMAS → JAVIER.TEST_REPARTIDOR_FIRMAS (nombre/DNI; skip CLOB)
 * - Overlay: BKP_DELIVERY_STATUS_20260427 → TEST_DELIVERY_STATUS
 * - Notifications: NOTIFICATION_ROLE_TARGETS → TEST_NOTIFICATION_ROLE_TARGETS
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');
const { TABLE_MAPPINGS } = require('../config/reparto-runtime');

const APPLY = process.argv.includes('--apply');
const SKIP_CVC = process.argv.includes('--skip-cvc');
const RESUME_FIRMAS = process.argv.includes('--resume-firmas');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? Math.max(1, Number(daysArg.split('=')[1]) || 30) : 30;
const repArg = process.argv.find((a) => a.startsWith('--repartidor='));
const REPARTIDOR = repArg ? String(repArg.split('=')[1] || '').trim() : '';

/** Keys filled from ERP read-only seeds instead of empty JAVIER isomorphic tables. */
const ERP_SEEDED_KEYS = new Set(['liquidationOps', 'cobros']);

const BKP_DELIVERY = 'JAVIER.BKP_DELIVERY_STATUS_20260427';
const TEST_DELIVERY = 'JAVIER.TEST_DELIVERY_STATUS';
const ERP_LQD = 'DSEDAC.LQD';
const ERP_CVC = 'DSEDAC.CVC';
const ERP_CACFIRMAS = 'DSEDAC.CACFIRMAS';
const TEST_FIRMAS = 'JAVIER.TEST_REPARTIDOR_FIRMAS';
const PROD_FIRMAS = 'JAVIER.REPARTIDOR_FIRMAS';

const summaryRows = [];

function assertJavierTest(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('JAVIER.TEST_')) {
    throw new Error(`Refusing non-TEST write target: ${table}`);
  }
  if (t.includes('DSEDAC') || t.includes('DSED.')) {
    throw new Error(`Refusing DSEDAC/DSED write target: ${table}`);
  }
}

function assertReadOnlyErp(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('DSEDAC.') && !t.startsWith('JAVIER.')) {
    throw new Error(`Refusing unexpected source: ${table}`);
  }
}

function assertJavierSource(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('JAVIER.') || t.includes('.TEST_') || t.includes('DSEDAC') || t.includes('DSED.')) {
    throw new Error(`Refusing non-JAVIER prod source: ${table}`);
  }
}

function refuseDsedacWriteSql(sql) {
  // Allow SELECT FROM DSEDAC.*; refuse only when DSEDAC/DSED is the write target.
  const s = String(sql || '').toUpperCase().replace(/\s+/g, ' ');
  const hits = [
    /\bINSERT\s+INTO\s+DSEDAC\./,
    /\bINSERT\s+INTO\s+DSED\./,
    /\bUPDATE\s+DSEDAC\./,
    /\bUPDATE\s+DSED\./,
    /\bDELETE\s+FROM\s+DSEDAC\./,
    /\bDELETE\s+FROM\s+DSED\./,
    /\bMERGE\s+INTO\s+DSEDAC\./,
    /\bMERGE\s+INTO\s+DSED\./,
    /\bCREATE\s+TABLE\s+DSEDAC\./,
    /\bCREATE\s+TABLE\s+DSED\./,
    /\bDROP\s+TABLE\s+DSEDAC\./,
    /\bDROP\s+TABLE\s+DSED\./,
    /\bALTER\s+TABLE\s+DSEDAC\./,
    /\bALTER\s+TABLE\s+DSED\./,
    /\bTRUNCATE\s+TABLE\s+DSEDAC\./,
    /\bTRUNCATE\s+TABLE\s+DSED\./,
  ];
  if (hits.some((re) => re.test(s))) {
    throw new Error(`Refusing SQL that writes DSEDAC/DSED: ${s.slice(0, 160)}`);
  }
}

async function columnsOf(schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const rows = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME,
            TRIM(DATA_TYPE) AS DATA_TYPE,
            IDENTITY
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return (rows || []).map((r) => ({
    name: String(r.COLUMN_NAME || r.column_name).trim().toUpperCase(),
    dataType: String(r.DATA_TYPE || r.data_type || '').toUpperCase(),
    identity: String(r.IDENTITY || r.identity || '').toUpperCase() === 'YES',
  }));
}

async function tableExists(schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const rows = await queryWithParams(
    `SELECT 1 AS OK FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND TABLE_TYPE IN ('T', 'P')`,
    [schema, table],
  );
  return rows.length > 0;
}

async function countOf(schemaTable, whereSql = '', params = []) {
  try {
    const rows = whereSql
      ? await queryWithParams(
        `SELECT COUNT(*) AS N FROM ${schemaTable} WHERE ${whereSql}`,
        params,
      )
      : await query(`SELECT COUNT(*) AS N FROM ${schemaTable}`);
    return Number(rows?.[0]?.N ?? rows?.[0]?.n ?? 0);
  } catch {
    return -1;
  }
}

async function run(sql, params = []) {
  refuseDsedacWriteSql(sql);
  if (!APPLY) {
    console.log('[DRY]', sql.replace(/\s+/g, ' ').slice(0, 200), params.length ? params : '');
    return { rowCount: 0 };
  }
  if (params.length) return queryWithParams(sql, params);
  return query(sql);
}

function intersectionColumns(srcCols, dstCols) {
  const dstNames = new Set(dstCols.map((c) => c.name));
  return srcCols.map((c) => c.name).filter((n) => dstNames.has(n));
}

function ymdNumericExpr(ano, mes, dia) {
  return `(${ano} * 10000 + ${mes} * 100 + ${dia})`;
}

function cutoffYmdSql(days) {
  const n = Number(days);
  return `(YEAR(CURRENT DATE - ${n} DAYS) * 10000`
    + ` + MONTH(CURRENT DATE - ${n} DAYS) * 100`
    + ` + DAY(CURRENT DATE - ${n} DAYS))`;
}

function collectMappingPairs() {
  const prod = TABLE_MAPPINGS.production;
  const test = TABLE_MAPPINGS.isolated_test;
  const pairs = [];
  for (const group of Object.keys(prod)) {
    for (const key of Object.keys(prod[group])) {
      pairs.push({
        group,
        key,
        src: prod[group][key],
        dst: test[group][key],
        erpSeeded: ERP_SEEDED_KEYS.has(key),
      });
    }
  }
  return pairs;
}

async function truncateTest(table) {
  assertJavierTest(table);
  console.log('TRUNCATE', table);
  await run(`DELETE FROM ${table}`);
}

async function copyIntersection(src, dst, {
  whereSql = '',
  params = [],
  label = 'COPY',
  allowErpSource = false,
} = {}) {
  if (allowErpSource) assertReadOnlyErp(src);
  else assertJavierSource(src);
  assertJavierTest(dst);

  if (!(await tableExists(src)) || !(await tableExists(dst))) {
    console.log('SKIP missing', src, '→', dst);
    summaryRows.push({ label, src, dst, srcCount: -1, destCount: -1, note: 'missing' });
    return;
  }

  const srcCols = await columnsOf(src);
  const dstCols = await columnsOf(dst);
  const common = intersectionColumns(srcCols, dstCols);
  if (common.length === 0) {
    console.log('SKIP no common columns', src, '→', dst);
    summaryRows.push({ label, src, dst, srcCount: 0, destCount: 0, note: 'no-common-cols' });
    return;
  }

  if (common.length !== srcCols.length || common.length !== dstCols.length) {
    console.log(
      `WARN subset ${src}→${dst}: common=${common.length} src=${srcCols.length} dst=${dstCols.length}`,
    );
  }

  const srcCount = await countOf(src, whereSql, params);
  const hasIdentity = dstCols.some((c) => c.identity && common.includes(c.name));
  const colList = common.join(', ');
  const sql = `
    INSERT INTO ${dst} (${colList})
    ${hasIdentity ? 'OVERRIDING SYSTEM VALUE' : ''}
    SELECT ${colList} FROM ${src}
    ${whereSql ? `WHERE ${whereSql}` : ''}
  `;
  console.log(
    `${label} ${src} → ${dst} (${common.length} cols, src≈${srcCount})`
    + `${APPLY ? '' : ' [dry-run]'}`,
  );
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : srcCount;
  summaryRows.push({
    label,
    src,
    dst,
    srcCount,
    destCount,
    note: hasIdentity ? 'OVERRIDING SYSTEM VALUE' : '',
  });
}

async function ensureTestDeliveryStatus() {
  assertJavierTest(TEST_DELIVERY);
  if (await tableExists(TEST_DELIVERY)) {
    console.log('OK exists', TEST_DELIVERY);
    return;
  }
  if (await tableExists(BKP_DELIVERY)) {
    console.log('CREATE', TEST_DELIVERY, 'LIKE', BKP_DELIVERY);
    await run(`CREATE TABLE ${TEST_DELIVERY} LIKE ${BKP_DELIVERY}`);
    return;
  }
  console.log('CREATE', TEST_DELIVERY, '(explicit 8 cols)');
  await run(`
    CREATE TABLE ${TEST_DELIVERY} (
      ID INTEGER NOT NULL,
      STATUS VARCHAR(40),
      OBSERVACIONES VARCHAR(512),
      FIRMA_PATH VARCHAR(512),
      LATITUD DECIMAL(12, 8),
      LONGITUD DECIMAL(12, 8),
      REPARTIDOR_ID VARCHAR(20),
      UPDATED_AT TIMESTAMP
    )
  `);
}

async function seedLqdToLiquidacionOps() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.liquidationOps;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);

  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP ERP LQD seed — missing table');
    return;
  }

  await truncateTest(dst);

  // TEST unique indexes:
  //  UX_T_RLO_TOKEN   → IDEMPOTENCY_TOKEN
  //  UX_T_RLO_MARKER  → IDMARCALIQUIDACION
  //  UX_T_RLO_REP_DAY → CODIGOVENDEDOR + DIA/MES/ANO
  // So: 1 row per repartidor/day, synthesize unique token/marker, omit ERP ID.
  const whereParts = [
    `${ymdNumericExpr('ANOLIQUIDACION', 'MESLIQUIDACION', 'DIALIQUIDACION')} >= ${cutoffYmdSql(DAYS)}`,
    'DIALIQUIDACION > 0',
    'MESLIQUIDACION > 0',
    'ANOLIQUIDACION > 0',
    "TRIM(COALESCE(CODIGOVENDEDOR, '')) <> ''",
  ];
  const params = [];
  if (REPARTIDOR) {
    whereParts.push('TRIM(CODIGOVENDEDOR) = ?');
    params.push(REPARTIDOR);
  }
  const whereSql = whereParts.join(' AND ');

  const srcCount = await countOf(ERP_LQD, whereSql, params);
  const sql = `
    INSERT INTO ${dst} (
      SUBEMPRESALIQUIDACION, EJERCICIOLIQUIDACION, SERIELIQUIDACION, TERMINALLIQUIDACION,
      NUMEROLIQUIDACION, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, HORALIQUIDACION,
      CODIGOVENDEDOR, CODIGOVENDEDORUSUARIO, CODIGOUSUARIO, MATRICULA,
      KILOMETROSSALIDA, KILOMETROSLLEGADA, KILOMETROSRECORRIDOS,
      IMPORTEEFECTIVO, IMPORTECHEQUES, IMPORTEPOSTDATADOS, IMPORTESALDOACTUAL,
      IMPORTETOTALAINGRESAR, IMPORTEINGRESOENBANCO, IMPORTEGASTOS, IMPRESOSN,
      CODIGOVEHICULO, REVISADOSN, IDMARCALIQUIDACION, IMPORTEEFECTIVO2,
      IMPORTEENTREGADO2, IMPORTETARJETA, MARCAACTUALIZACION,
      IDEMPOTENCY_TOKEN, STATUS, OPERADOR, PANTALLA_ORIGEN
    )
    SELECT
      SUBEMPRESALIQUIDACION, EJERCICIOLIQUIDACION, SERIELIQUIDACION, TERMINALLIQUIDACION,
      NUMEROLIQUIDACION, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, HORALIQUIDACION,
      CODIGOVENDEDOR, CODIGOVENDEDORUSUARIO, CODIGOUSUARIO, MATRICULA,
      KILOMETROSSALIDA, KILOMETROSLLEGADA, KILOMETROSRECORRIDOS,
      IMPORTEEFECTIVO, IMPORTECHEQUES, IMPORTEPOSTDATADOS, IMPORTESALDOACTUAL,
      IMPORTETOTALAINGRESAR, IMPORTEINGRESOENBANCO, IMPORTEGASTOS, IMPRESOSN,
      CODIGOVEHICULO, REVISADOSN,
      CAST(('ERP-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS CHAR(30)),
      IMPORTEEFECTIVO2, IMPORTEENTREGADO2, IMPORTETARJETA, MARCAACTUALIZACION,
      CAST(('ERP-LQD-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      'CLOSED', 'ERP-SEED', 'LIQUIDACIONDIARIA'
    FROM (
      SELECT L.*,
             ROW_NUMBER() OVER (
               PARTITION BY TRIM(CODIGOVENDEDOR), DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION
               ORDER BY HORALIQUIDACION DESC, NUMEROLIQUIDACION DESC
             ) AS RN
        FROM ${ERP_LQD} L
       WHERE ${whereSql}
    ) X
    WHERE RN = 1
  `;

  console.log(
    `ERP-SEED LQD→liquidacionOps ${ERP_LQD} → ${dst} (dedupe rep+day, src≈${srcCount})`
    + `${APPLY ? '' : ' [dry-run]'}`,
  );
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : srcCount;
  summaryRows.push({
    label: 'ERP-SEED LQD→liquidacionOps',
    src: ERP_LQD,
    dst,
    srcCount,
    destCount,
    note: 'dedupe CODIGOVENDEDOR+day; unique token/marker',
  });
}

function lqdWindowWhere(alias = '') {
  const p = alias ? `${alias}.` : '';
  const parts = [
    `${ymdNumericExpr(`${p}ANOLIQUIDACION`, `${p}MESLIQUIDACION`, `${p}DIALIQUIDACION`)} >= ${cutoffYmdSql(DAYS)}`,
    `${p}DIALIQUIDACION > 0`,
    `${p}MESLIQUIDACION > 0`,
    `${p}ANOLIQUIDACION > 0`,
    `TRIM(COALESCE(${p}CODIGOVENDEDOR, '')) <> ''`,
  ];
  const params = [];
  if (REPARTIDOR) {
    parts.push(`TRIM(${p}CODIGOVENDEDOR) = ?`);
    params.push(REPARTIDOR);
  }
  return { whereSql: parts.join(' AND '), params };
}

function lqdDedupeSubquery() {
  const { whereSql } = lqdWindowWhere();
  return `
    SELECT L.*,
           ROW_NUMBER() OVER (
             PARTITION BY TRIM(CODIGOVENDEDOR), DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION
             ORDER BY HORALIQUIDACION DESC, NUMEROLIQUIDACION DESC
           ) AS RN
      FROM ${ERP_LQD} L
     WHERE ${whereSql}
  `;
}

async function seedLqdDerivedCobros() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.cobros;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (SKIP_CVC) {
    console.log('SKIP LQD-derived cobros (--skip-cvc)');
    return;
  }
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD cobros seed — missing table');
    return;
  }

  await truncateTest(dst);
  const { whereSql, params } = lqdWindowWhere();
  const splits = [
    ['EF', 'IMPORTEEFECTIVO'],
    ['CH', 'IMPORTECHEQUES'],
    ['TJ', 'IMPORTETARJETA'],
    ['PD', 'IMPORTEPOSTDATADOS'],
  ];
  let inserted = 0;
  for (const [forma, column] of splits) {
    const sql = `
      INSERT INTO ${dst} (
        CODIGOVENDEDOR, DIACOBRO, MESCOBRO, ANOCOBRO, IMPORTEVENCIMIENTO,
        CODIGOFORMAPAGO, LIQUIDADO_SN, LIQUIDACION_TOKEN, NUMEROLIQUIDACION
      )
      SELECT
        CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION, ${column},
        '${forma}', 'S',
        CAST(('ERP-COB-${forma}-' || TRIM(CODIGOVENDEDOR) || '-'
          || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
          || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
        NUMEROLIQUIDACION
      FROM (${lqdDedupeSubquery()}) X
      WHERE RN = 1 AND ${column} > 0
    `;
    console.log(`ERP-SEED LQD→cobros ${forma}${APPLY ? '' : ' [dry-run]'}`);
    await run(sql, params);
  }
  const destCount = APPLY ? await countOf(dst) : await countOf(ERP_LQD, whereSql, params);
  inserted = destCount;
  summaryRows.push({
    label: 'ERP-SEED LQD→cobros',
    src: ERP_LQD,
    dst,
    srcCount: inserted,
    destCount,
    note: 'EF/CH/TJ/PD from LQD; CVC.DIACOBRO always 0',
  });
}

async function seedLqdDerivedIngresos() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.bankDeposits;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD ingresos seed — missing table');
    return;
  }
  await truncateTest(dst);
  const { whereSql, params } = lqdWindowWhere();
  const sql = `
    INSERT INTO ${dst} (
      IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE,
      REFERENCIA, OBSERVACION, STATUS, LIQUIDACION_MARKER, ACTOR_ID, ACTOR_ROLE,
      CREATED_AT
    )
    SELECT
      CAST(('ERP-ING-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
      IMPORTEINGRESOENBANCO,
      CAST(('LQD-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(80)),
      'ERP LQD IMPORTEINGRESOENBANCO',
      'LIQUIDATED',
      CAST(('ERP-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS CHAR(30)),
      'ERP-SEED', 'SYSTEM',
      CURRENT TIMESTAMP
    FROM (${lqdDedupeSubquery()}) X
    WHERE RN = 1 AND IMPORTEINGRESOENBANCO > 0
  `;
  console.log(`ERP-SEED LQD→ingresos ${dst}${APPLY ? '' : ' [dry-run]'}`);
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : await countOf(ERP_LQD, `${whereSql} AND IMPORTEINGRESOENBANCO > 0`, params);
  summaryRows.push({
    label: 'ERP-SEED LQD→ingresos',
    src: ERP_LQD,
    dst,
    srcCount: destCount,
    destCount,
    note: 'IMPORTEINGRESOENBANCO>0',
  });
}

async function seedLqdDerivedGastos() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.expenses;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD gastos seed — missing table');
    return;
  }
  await truncateTest(dst);
  const { whereSql, params } = lqdWindowWhere();
  const sql = `
    INSERT INTO ${dst} (
      IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE,
      CATEGORIA, OBSERVACION, STATUS, LIQUIDACION_MARKER, ACTOR_ID, ACTOR_ROLE,
      CREATED_AT
    )
    SELECT
      CAST(('ERP-GAS-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS VARCHAR(128)),
      CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,
      IMPORTEGASTOS,
      'ERP', 'ERP LQD IMPORTEGASTOS', 'LIQUIDATED',
      CAST(('ERP-' || TRIM(CODIGOVENDEDOR) || '-'
        || TRIM(VARCHAR(ANOLIQUIDACION * 10000 + MESLIQUIDACION * 100 + DIALIQUIDACION))
        || '-' || TRIM(VARCHAR(NUMEROLIQUIDACION))) AS CHAR(30)),
      'ERP-SEED', 'SYSTEM',
      CURRENT TIMESTAMP
    FROM (${lqdDedupeSubquery()}) X
    WHERE RN = 1 AND IMPORTEGASTOS > 0
  `;
  console.log(`ERP-SEED LQD→gastos ${dst}${APPLY ? '' : ' [dry-run]'}`);
  await run(sql, params);
  const destCount = APPLY ? await countOf(dst) : await countOf(ERP_LQD, `${whereSql} AND IMPORTEGASTOS > 0`, params);
  summaryRows.push({
    label: 'ERP-SEED LQD→gastos',
    src: ERP_LQD,
    dst,
    srcCount: destCount,
    destCount,
    note: 'IMPORTEGASTOS>0 (often 0 in ERP)',
  });
}

async function seedLqdDerivedBalances() {
  const dst = TABLE_MAPPINGS.isolated_test.finance.balances;
  assertJavierTest(dst);
  assertReadOnlyErp(ERP_LQD);
  if (!(await tableExists(ERP_LQD)) || !(await tableExists(dst))) {
    console.log('SKIP LQD balances seed — missing table');
    return;
  }
  await truncateTest(dst);
  const sql = `
    INSERT INTO ${dst} (CODIGO_REPARTIDOR, SALDO_PENDIENTE)
    SELECT TRIM(CODIGOVENDEDOR), IMPORTESALDOACTUAL
      FROM (
        SELECT L.*,
               ROW_NUMBER() OVER (
                 PARTITION BY TRIM(CODIGOVENDEDOR)
                 ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC,
                          HORALIQUIDACION DESC, NUMEROLIQUIDACION DESC
               ) AS RN_VENDOR
          FROM ${ERP_LQD} L
         WHERE ${lqdWindowWhere().whereSql}
      ) X
     WHERE RN_VENDOR = 1
  `;
  console.log(`ERP-SEED LQD→balances ${dst}${APPLY ? '' : ' [dry-run]'}`);
  await run(sql, lqdWindowWhere().params);
  const destCount = APPLY ? await countOf(dst) : -1;
  summaryRows.push({
    label: 'ERP-SEED LQD→balances',
    src: ERP_LQD,
    dst,
    srcCount: destCount,
    destCount,
    note: 'latest LQD IMPORTESALDOACTUAL per vendor',
  });
}

async function recreateTestFirmasWithIdentity() {
  assertJavierTest(TEST_FIRMAS);
  if (await tableExists(TEST_FIRMAS)) {
    const cols = await columnsOf(TEST_FIRMAS);
    const idCol = cols.find((c) => c.name === 'ID');
    if (idCol && idCol.identity) {
      console.log('OK identity', TEST_FIRMAS);
      return;
    }
    console.log(APPLY ? 'DROP' : '[DRY] DROP', TEST_FIRMAS, '(CREATE LIKE lost IDENTITY)');
    await run(`DROP TABLE ${TEST_FIRMAS}`);
  }
  console.log(APPLY ? 'CREATE' : '[DRY] CREATE', TEST_FIRMAS, '(explicit IDENTITY)');
  await run(`
    CREATE TABLE ${TEST_FIRMAS} (
      SUBEMPRESAALBARAN CHAR(3) NOT NULL DEFAULT ' ',
      EJERCICIOALBARAN NUMERIC(4, 0) NOT NULL DEFAULT 0,
      SERIEALBARAN CHAR(1) NOT NULL DEFAULT ' ',
      TERMINALALBARAN NUMERIC(3, 0) NOT NULL DEFAULT 0,
      NUMEROALBARAN NUMERIC(6, 0) NOT NULL DEFAULT 0,
      CODIGOVENDEDOR CHAR(2) NOT NULL DEFAULT ' ',
      CODIGOUSUARIO CHAR(2) NOT NULL DEFAULT ' ',
      DIA NUMERIC(2, 0) NOT NULL DEFAULT 0,
      MES NUMERIC(2, 0) NOT NULL DEFAULT 0,
      ANO NUMERIC(4, 0) NOT NULL DEFAULT 0,
      HORA NUMERIC(6, 0) NOT NULL DEFAULT 0,
      FIRMANOMBRE CHAR(100) NOT NULL DEFAULT ' ',
      FIRMADNI CHAR(20) NOT NULL DEFAULT ' ',
      FIRMABASE64 CLOB(1M) NOT NULL DEFAULT ' ',
      LATITUD NUMERIC(15, 6) NOT NULL DEFAULT 0,
      LONGITUD NUMERIC(15, 6) NOT NULL DEFAULT 0,
      TIPOREGISTRO CHAR(1) NOT NULL DEFAULT ' ',
      ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
      MARCAACTUALIZACION VARCHAR(50) NOT NULL DEFAULT ' ',
      IDEMPOTENCY_TOKEN VARCHAR(128),
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP,
      STATUS VARCHAR(20) DEFAULT 'CAPTURADA',
      OPERADOR VARCHAR(50) DEFAULT 'system',
      PANTALLA_ORIGEN VARCHAR(20) DEFAULT 'ENTREGA',
      PRIMARY KEY (ID)
    )
  `);
}

async function seedCacfirmasToTest() {
  assertJavierTest(TEST_FIRMAS);
  assertReadOnlyErp(ERP_CACFIRMAS);
  if (!(await tableExists(ERP_CACFIRMAS))) {
    console.log('SKIP CACFIRMAS — missing ERP table');
    return;
  }
  await recreateTestFirmasWithIdentity();
  if (APPLY && !(await tableExists(TEST_FIRMAS))) {
    console.log('SKIP firmas seed — TEST table still missing');
    return;
  }

  if (await tableExists(TEST_FIRMAS)) await truncateTest(TEST_FIRMAS);

  const whereParts = [
    'DIA > 0',
    'MES > 0',
    'ANO > 0',
    `${ymdNumericExpr('ANO', 'MES', 'DIA')} >= ${cutoffYmdSql(DAYS)}`,
  ];
  const params = [];
  if (REPARTIDOR) {
    whereParts.push('TRIM(CODIGOVENDEDOR) = ?');
    params.push(REPARTIDOR);
  }
  const whereSql = whereParts.join(' AND ');
  const srcCount = await countOf(ERP_CACFIRMAS, whereSql, params);

  // Copy identity columns except FIRMABASE64 CLOB (418k ERP rows; 45d still heavy).
  const sql = `
    INSERT INTO ${TEST_FIRMAS} (
      SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
      CODIGOVENDEDOR, CODIGOUSUARIO, DIA, MES, ANO, HORA,
      FIRMANOMBRE, FIRMADNI, LATITUD, LONGITUD, TIPOREGISTRO,
      IDEMPOTENCY_TOKEN, STATUS, OPERADOR, PANTALLA_ORIGEN
    )
    SELECT
      SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
      CODIGOVENDEDOR, CODIGOUSUARIO, DIA, MES, ANO, HORA,
      FIRMANOMBRE, FIRMADNI, LATITUD, LONGITUD, TIPOREGISTRO,
      CAST(('ERP-FIR-' || TRIM(VARCHAR(EJERCICIOALBARAN)) || '-' || TRIM(SERIEALBARAN)
        || '-' || TRIM(VARCHAR(TERMINALALBARAN)) || '-' || TRIM(VARCHAR(NUMEROALBARAN))
        || '-' || TRIM(TIPOREGISTRO) || '-' || TRIM(VARCHAR(ANO * 10000 + MES * 100 + DIA))) AS VARCHAR(128)),
      'CAPTURADA', 'ERP-SEED', 'ENTREGA'
    FROM (
      SELECT F.*,
             ROW_NUMBER() OVER (
               PARTITION BY SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN,
                            TERMINALALBARAN, NUMEROALBARAN, TIPOREGISTRO
               ORDER BY HORA DESC, ANO DESC, MES DESC, DIA DESC
             ) AS RN
        FROM ${ERP_CACFIRMAS} F
       WHERE ${whereSql}
    ) X
    WHERE RN = 1
  `;
  console.log(`ERP-SEED CACFIRMAS→firmas ${TEST_FIRMAS} src≈${srcCount} (no CLOB)${APPLY ? '' : ' [dry-run]'}`);
  await run(sql, params);
  const destCount = APPLY ? await countOf(TEST_FIRMAS) : srcCount;
  summaryRows.push({
    label: 'ERP-SEED CACFIRMAS→firmas',
    src: ERP_CACFIRMAS,
    dst: TEST_FIRMAS,
    srcCount,
    destCount,
    note: 'FIRMANOMBRE+FIRMADNI; skip FIRMABASE64',
  });
}

async function copyNotificationRoleTargets() {
  const src = TABLE_MAPPINGS.production.notifications.roleTargets;
  const dst = TABLE_MAPPINGS.isolated_test.notifications.roleTargets;
  assertJavierSource(src);
  assertJavierTest(dst);
  if (!(await tableExists(src)) || !(await tableExists(dst))) {
    console.log('SKIP notification role targets missing');
    return;
  }
  await truncateTest(dst);
  await copyIntersection(src, dst, { label: 'COPY notifications' });
}

async function printSummary() {
  console.log('\n=== COUNT SUMMARY ===');
  console.log(
    'label'.padEnd(36),
    'src'.padEnd(42),
    'srcN'.padStart(8),
    'dstN'.padStart(8),
    'note',
  );
  for (const row of summaryRows) {
    console.log(
      String(row.label).padEnd(36),
      String(row.src).padEnd(42),
      String(row.srcCount).padStart(8),
      String(row.destCount).padStart(8),
      row.note || '',
    );
  }
  if (!APPLY) {
    console.log('(dry-run: destN ≈ filtered source count; re-run --apply for real dest counts)');
  }
}

async function overlayDeliveryStatus() {
  await ensureTestDeliveryStatus();
  if (await tableExists(BKP_DELIVERY) && await tableExists(TEST_DELIVERY)) {
    await truncateTest(TEST_DELIVERY);
    await copyIntersection(BKP_DELIVERY, TEST_DELIVERY, {
      label: 'BKP delivery overlay',
    });
  } else {
    console.log('SKIP BKP→TEST_DELIVERY_STATUS (missing source or dest)');
  }
}

async function main() {
  console.log(`Mode=${APPLY ? 'APPLY' : 'DRY-RUN'} days=${DAYS} repartidor=${REPARTIDOR || 'ALL'} skipCvc=${SKIP_CVC} resumeFirmas=${RESUME_FIRMAS}`);
  console.log('RULE: never touch DSEDAC/DSED writes. Only JAVIER.TEST_* writes.');
  await initDb();
  try {
    if (RESUME_FIRMAS) {
      await seedCacfirmasToTest();
      await overlayDeliveryStatus();
      await printSummary();
      console.log(APPLY ? 'DONE resume-firmas.' : 'DRY-RUN resume-firmas.');
      return;
    }
    const pairs = collectMappingPairs();

    // Create TEST_DELIVERY_STATUS before wipe/copy so overlay seed can run.
    await ensureTestDeliveryStatus();

    // 1) Wipe TEST destinations (children-ish order by name length desc heuristic + known children first)
    const wipeFirst = [
      'JAVIER.TEST_REPARTO_CONFIRM_EVIDENCIAS',
      'JAVIER.TEST_REPARTO_LINEAS',
      'JAVIER.TEST_REPARTO_CONFIRMACIONES',
      'JAVIER.TEST_REPARTO_EVIDENCIAS',
      'JAVIER.TEST_REPARTO_VARIANCE_OUTBOX',
      'JAVIER.TEST_REPARTIDOR_LIQUIDACION_EMAILS',
      'JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS',
      'JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES',
      'JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS',
      'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OUTBOX',
      'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS',
      'JAVIER.TEST_REPARTIDOR_COBROS_AUDIT',
      'JAVIER.TEST_REPARTIDOR_COBROS',
      'JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES',
      'JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN',
      'JAVIER.TEST_NOTIFICATION_ROLE_TARGETS',
      'JAVIER.TEST_DELIVERY_STATUS',
      'JAVIER.TEST_REPARTIDOR_COMMISSION_TIERS',
      'JAVIER.TEST_COBROS',
      'JAVIER.TEST_REPARTIDOR_FIRMAS',
    ];
    const wipeSet = new Set(wipeFirst);
    for (const p of pairs) wipeSet.add(p.dst);
    for (const t of wipeSet) {
      if (await tableExists(t)) await truncateTest(t);
    }

    // 2) Isomorphic TABLE_MAPPINGS pairs (skip ERP-seeded keys)
    for (const p of pairs) {
      if (p.erpSeeded) {
        console.log(`DEFER isomorphic ${p.key} → ERP seed`);
        continue;
      }
      if (!(await tableExists(p.src)) || !(await tableExists(p.dst))) {
        console.log('SKIP missing pair', p.src, '→', p.dst);
        continue;
      }

      let whereSql = '';
      const params = [];
      if (p.key === 'order') {
        whereSql = `FECHA_RUTA >= CURRENT DATE - ${Number(DAYS)} DAYS`;
        if (REPARTIDOR) {
          whereSql += ' AND TRIM(REPARTIDOR_ID) = ?';
          params.push(REPARTIDOR);
        }
      }

      await copyIntersection(p.src, p.dst, {
        whereSql,
        params,
        label: `ISO ${p.group}.${p.key}`,
      });
    }

    // 3) ERP seeds (read-only DSEDAC → TEST)
    await seedLqdToLiquidacionOps();
    await seedLqdDerivedCobros();
    await seedLqdDerivedIngresos();
    await seedLqdDerivedGastos();
    await seedLqdDerivedBalances();
    await seedCacfirmasToTest();

    // 4) Delivery status overlay
    await ensureTestDeliveryStatus();
    if (await tableExists(BKP_DELIVERY) && await tableExists(TEST_DELIVERY)) {
      await truncateTest(TEST_DELIVERY);
      await copyIntersection(BKP_DELIVERY, TEST_DELIVERY, {
        label: 'BKP delivery overlay',
      });
    } else {
      console.log('SKIP BKP→TEST_DELIVERY_STATUS (missing source or dest)');
    }

    // 5) Notification role targets
    await copyNotificationRoleTargets();

    // 6) Summary
    await printSummary();

    console.log(APPLY
      ? 'DONE. ERP documents (albaranes/ruteros) still read live from DSEDAC (not copied).'
      : 'DRY-RUN complete. Re-run with --apply to execute.');
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
