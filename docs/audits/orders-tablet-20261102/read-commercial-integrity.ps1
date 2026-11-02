[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$job = @'
'use strict';
require('./config/load-env').loadEnv(process.cwd());
const odbc = require('odbc');
const crypto = require('crypto');
const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const fingerprint = rows => crypto.createHash('sha256').update(encode(rows.map(canonical).map(encode).sort())).digest('hex');
const trim = value => String(value ?? '').trim();
const cents = value => Math.round(Number(value) * 100);
const diagnostic = error => ({
  code: /^[A-Z][A-Z0-9_]{2,70}$/.test(error.code || '') ? error.code : 'READONLY_INTEGRITY_FAILED',
  odbc: (error.odbcErrors || []).map(item => ({
    state: /^[A-Z0-9]{5}$/.test(item.state || '') ? item.state : null,
    code: Number.isFinite(Number(item.code)) ? Number(item.code) : null,
  })),
});
const columns = {
  TEST_BOLSA_COMERCIAL: ['ID','CODIGOVENDEDOR','EJERCICIO','MES','LIMITE_PCT','LIMITE_IMPORTE','SALDO_DISPONIBLE','CONSUMIDO','ACUMULADO'],
  TEST_MOVIMIENTOS_BOLSA: ['ID','BOLSA_ID','PEDIDO_ID','LINEA_ID','TIPO','IMPORTE','SALDO_ANTERIOR','SALDO_POSTERIOR','IDEMPOTENCY_KEY'],
  TEST_PEDIDOS_CAB: ['ID','ESTADO'],
  TEST_PEDIDOS_STOCK_RESERVE: ['ID','PEDIDO_ID'],
};
const evidence = { readOnly: true, mutationAttempts: 0, phase: 'CONNECT', queries: 0, queryTimeMs: 0, closed: false };
let connection;
let failure;
async function query(sql, params = []) {
  if (!/^SELECT\s/i.test(sql.trim())) throw Object.assign(new Error('READ_ONLY_REQUIRED'), {code:'READ_ONLY_REQUIRED'});
  const started = process.hrtime.bigint();
  try { return await connection.query(sql, params); }
  finally { evidence.queries++; evidence.queryTimeMs += Number(process.hrtime.bigint() - started) / 1e6; }
}
(async () => {
  try {
    const cs = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;CCSID=1208;`;
    connection = await odbc.connect(cs);
    evidence.phase = 'METADATA';
    evidence.metadata = {};
    for (const [table, required] of Object.entries(columns)) {
      const rows = await query('SELECT COLUMN_NAME, DATA_TYPE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', ['JAVIER', table]);
      const names = new Set(rows.map(row => trim(row.COLUMN_NAME)));
      if (!required.every(name => names.has(name))) throw Object.assign(new Error('METADATA_MISMATCH'), {code:'METADATA_MISMATCH'});
      evidence.metadata[table] = required;
    }
    evidence.phase = 'READ';
    const data = {};
    for (const [table, required] of Object.entries(columns)) data[table] = await query(`SELECT ${required.join(', ')} FROM JAVIER.${table}`);
    evidence.snapshots = Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, {count:rows.length, sha256:fingerprint(rows)}]));
    evidence.hashScope = 'Only listed economic/reference columns; object keys and serialized row strings sorted. Not a full-table/all-column mutation fingerprint.';
    const bags = data.TEST_BOLSA_COMERCIAL;
    const movements = data.TEST_MOVIMIENTOS_BOLSA;
    const orders = new Map(data.TEST_PEDIDOS_CAB.map(row => [trim(row.ID), trim(row.ESTADO)]));
    const bagIds = new Set(bags.map(row => trim(row.ID)));
    const byId = new Map(movements.map(row => [trim(row.ID), row]));
    const keys = new Map();
    for (const row of movements) {
      const key = trim(row.IDEMPOTENCY_KEY);
      if (key) keys.set(key, [...(keys.get(key) || []), trim(row.ID)]);
    }
    evidence.duplicateKeys = [...keys].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({key, ids}));
    evidence.orphanMovements = movements.filter(row => !bagIds.has(trim(row.BOLSA_ID)) || (row.PEDIDO_ID != null && !orders.has(trim(row.PEDIDO_ID))));
    const allowed = new Set(['CONSUMO','ACUMULACION','REGISTRO','REVERSO_CONSUMO','REVERSO_ACUMULACION','REVERSO_REGISTRO']);
    evidence.unknownTypes = movements.filter(row => !allowed.has(trim(row.TIPO)));
    evidence.reversalErrors = [];
    for (const row of movements.filter(item => trim(item.TIPO).startsWith('REVERSO_'))) {
      const match = /^pedido-(\d+)-movement-(\d+)-reverse$/.exec(trim(row.IDEMPOTENCY_KEY));
      const original = match && byId.get(match[2]);
      if (!original || match[1] !== trim(row.PEDIDO_ID) || trim(original.PEDIDO_ID) !== trim(row.PEDIDO_ID)
          || trim(original.BOLSA_ID) !== trim(row.BOLSA_ID) || trim(row.TIPO) !== 'REVERSO_' + trim(original.TIPO)
          || cents(original.IMPORTE) !== cents(row.IMPORTE)) evidence.reversalErrors.push({id:trim(row.ID), code:'ORIGINAL_OR_FINGERPRINT_MISMATCH'});
    }
    evidence.bags = bags.map(bag => {
      const rows = movements.filter(row => trim(row.BOLSA_ID) === trim(bag.ID)).sort((a,b) => Number(a.ID) - Number(b.ID));
      let consumed = 0, accumulated = 0;
      const chainErrors = [];
      for (const [index, row] of rows.entries()) {
        const type = trim(row.TIPO), amount = cents(row.IMPORTE);
        if (type === 'CONSUMO') consumed += amount;
        if (type === 'REVERSO_CONSUMO') consumed -= amount;
        if (type === 'ACUMULACION') accumulated += amount;
        if (type === 'REVERSO_ACUMULACION') accumulated -= amount;
        const delta = ['ACUMULACION','REVERSO_CONSUMO'].includes(type) ? amount : ['CONSUMO','REVERSO_ACUMULACION'].includes(type) ? -amount : 0;
        if (cents(row.SALDO_ANTERIOR) + delta !== cents(row.SALDO_POSTERIOR)) chainErrors.push({id:trim(row.ID),code:'MOVEMENT_BALANCE_DELTA'});
        if (index > 0 && cents(rows[index - 1].SALDO_POSTERIOR) !== cents(row.SALDO_ANTERIOR)) chainErrors.push({id:trim(row.ID),code:'CHAIN_DISCONTINUITY'});
      }
      const last = rows.at(-1);
      if (last && cents(last.SALDO_POSTERIOR) !== cents(bag.SALDO_DISPONIBLE)) chainErrors.push({id:trim(last.ID),code:'CURRENT_BALANCE_DIFFERS_FROM_LAST_MOVEMENT'});
      return {
        id:trim(bag.ID), vendor:trim(bag.CODIGOVENDEDOR), year:Number(bag.EJERCICIO), month:Number(bag.MES),
        available:Number(bag.SALDO_DISPONIBLE), consumed:Number(bag.CONSUMIDO), accumulated:Number(bag.ACUMULADO),
        expectedConsumed:consumed/100, expectedAccumulated:accumulated/100,
        consumedDifference:(cents(bag.CONSUMIDO)-consumed)/100, accumulatedDifference:(cents(bag.ACUMULADO)-accumulated)/100,
        movementCount:rows.length, openingFromFirstMovement:rows.length ? Number(rows[0].SALDO_ANTERIOR) : null,
        balanceChainStatus:rows.length ? (chainErrors.length ? 'FAIL':'PASS_OBSERVED_CHAIN') : 'UNVERIFIABLE_NO_OPENING_SNAPSHOT', chainErrors,
      };
    });
    evidence.cancelledOrders = [...orders].filter(([, state]) => state === 'CANCELADO').map(([id,state]) => ({
      id, state, reservationCount:data.TEST_PEDIDOS_STOCK_RESERVE.filter(row => trim(row.PEDIDO_ID) === id).length,
      movements:movements.filter(row => trim(row.PEDIDO_ID) === id),
    }));
    evidence.movements = movements;
    evidence.aggregateReconciliationPass = evidence.duplicateKeys.length === 0 && evidence.orphanMovements.length === 0
      && evidence.unknownTypes.length === 0 && evidence.reversalErrors.length === 0
      && evidence.bags.every(bag => bag.consumedDifference === 0 && bag.accumulatedDifference === 0 && bag.chainErrors.length === 0);
    evidence.limitations = ['SELECT statements are not one snapshot transaction: concurrent writers can change rows between statements.', 'No opening snapshot is invented for bags without movements.', 'No create, confirm, cancel, sync or payment business operation was executed by this read-only probe.'];
    evidence.phase = 'DONE';
  } catch (error) { failure = diagnostic(error); }
  finally {
    if (connection) {
      try { await connection.close(); evidence.closed = true; }
      catch (error) { evidence.closeError = diagnostic(error); failure ||= {code:'CONNECTION_CLOSE_FAILED'}; }
    }
  }
  evidence.success = !failure;
  if (failure) { evidence.error = failure; process.exitCode = 1; }
  process.stdout.write(encode(evidence) + '\n');
})().catch(() => { process.stdout.write('{"success":false,"code":"UNEXPECTED_READONLY_HARNESS_FAILURE"}\n'); process.exitCode=1; });
'@
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
