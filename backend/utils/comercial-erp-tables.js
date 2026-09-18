'use strict';

/**
 * Commercial ERP table resolution.
 *
 * Product READS (ventas/rutero/facturas/objetivos/panel/cartera):
 *   always DSEDAC/DSED SELECT-only. Isolated_test must see live ERP sales;
 *   JAVIER.TEST_* copies go stale the next delivery day.
 *
 * Snapshot reads (copy/lab only): COMERCIAL_ERP_READ_TEST=true → JAVIER.TEST_*.
 *
 * App WRITES never go through this helper. Pedidos/cobros/liquidacion/devoluciones
 * overlay stay on db2AppTable / TABLE_MAPPINGS → JAVIER.TEST_* (dsedacWrite=false).
 */

const ERP_PROD = Object.freeze({
  FPG: 'DSEDAC.FPG',
  CVC: 'DSEDAC.CVC',
  CAC: 'DSEDAC.CAC',
  CPC: 'DSEDAC.CPC',
  LQD: 'DSEDAC.LQD',
  CLX: 'DSEDAC.CLX',
  VDDX: 'DSEDAC.VDDX',
  PMR: 'DSEDAC.PMR',
  PMRC: 'DSEDAC.PMRC',
  PMP: 'DSEDAC.PMP',
  ARA: 'DSEDAC.ARA',
  LPC: 'DSEDAC.LPC',
  ART: 'DSEDAC.ART',
  CLI: 'DSEDAC.CLI',
  CLC: 'DSEDAC.CLC',
  CLP: 'DSEDAC.CLP',
  LAC: 'DSEDAC.LAC',
  LACLAE: 'DSED.LACLAE',
  CFC: 'DSEDAC.CFC',
  OPP: 'DSEDAC.OPP',
  LINDTO: 'DSEDAC.LINDTO',
  FAM: 'DSEDAC.FAM',
  FI1: 'DSEDAC.FI1',
  FI2: 'DSEDAC.FI2',
  FI3: 'DSEDAC.FI3',
  FI4: 'DSEDAC.FI4',
  FI5: 'DSEDAC.FI5',
  COFC: 'DSEDAC.COFC',
  CMV: 'DSEDAC.CMV',
  CDVI: 'DSEDAC.CDVI',
  VDD: 'DSEDAC.VDD',
  VDC: 'DSEDAC.VDC',
  VEH: 'DSEDAC.VEH',
  ARTX: 'DSEDAC.ARTX',
  PES: 'DSEDAC.PES',
  TRF: 'DSEDAC.TRF',
  ARTALM: 'DSEDAC.ARTALM',
  ARO: 'DSEDAC.ARO',
  CRUT: 'DSEDAC.CRUT',
  CPES: 'DSEDAC.CPES',
  PPU: 'DSEDAC.PPU',
  ALM: 'DSEDAC.ALM',
});

const ERP_TEST = Object.freeze({
  FPG: 'JAVIER.TEST_FPG',
  CVC: 'JAVIER.TEST_CVC',
  CAC: 'JAVIER.TEST_CAC',
  CPC: 'JAVIER.TEST_CPC',
  LQD: 'JAVIER.TEST_LQD',
  CLX: 'JAVIER.TEST_CLX',
  VDDX: 'JAVIER.TEST_VDDX',
  PMR: 'JAVIER.TEST_PMR',
  PMRC: 'JAVIER.TEST_PMRC',
  PMP: 'JAVIER.TEST_PMP',
  ARA: 'JAVIER.TEST_ARA',
  LPC: 'JAVIER.TEST_LPC',
  ART: 'JAVIER.TEST_ART',
  CLI: 'JAVIER.TEST_CLI',
  CLC: 'JAVIER.TEST_CLC',
  CLP: 'JAVIER.TEST_CLP',
  LAC: 'JAVIER.TEST_LAC',
  LACLAE: 'JAVIER.TEST_LACLAE',
  CFC: 'JAVIER.TEST_CFC',
  OPP: 'JAVIER.TEST_OPP',
  LINDTO: 'JAVIER.TEST_LINDTO',
  FAM: 'JAVIER.TEST_FAM',
  FI1: 'JAVIER.TEST_FI1',
  FI2: 'JAVIER.TEST_FI2',
  FI3: 'JAVIER.TEST_FI3',
  FI4: 'JAVIER.TEST_FI4',
  FI5: 'JAVIER.TEST_FI5',
  COFC: 'JAVIER.TEST_COFC',
  CMV: 'JAVIER.TEST_CMV',
  CDVI: 'JAVIER.TEST_CDVI',
  VDD: 'JAVIER.TEST_VDD',
  VDC: 'JAVIER.TEST_VDC',
  VEH: 'JAVIER.TEST_VEH',
  ARTX: 'JAVIER.TEST_ARTX',
  PES: 'JAVIER.TEST_PES',
  TRF: 'JAVIER.TEST_TRF',
  ARTALM: 'JAVIER.TEST_ARTALM',
  ARO: 'JAVIER.TEST_ARO',
  CRUT: 'JAVIER.TEST_CRUT',
  CPES: 'JAVIER.TEST_CPES',
  PPU: 'JAVIER.TEST_PPU',
  ALM: 'JAVIER.TEST_ALM',
});

function isIsolatedCommercialTest(env = process.env) {
  return String(env.REPARTO_TABLE_SET || '').trim().toLowerCase() === 'isolated_test';
}

function comercialErpReadTestEnabled(env = process.env) {
  return String(env.COMERCIAL_ERP_READ_TEST || '').trim().toLowerCase() === 'true';
}

function comercialErpLiveTable(name) {
  const key = String(name || '').trim().toUpperCase();
  const live = ERP_PROD[key];
  if (!live) {
    throw new Error(`Unknown commercial ERP table: ${name}`);
  }
  return live;
}

function comercialErpSnapshotTable(name) {
  const key = String(name || '').trim().toUpperCase();
  const snap = ERP_TEST[key];
  if (!snap) {
    throw new Error(`Unknown commercial ERP table: ${name}`);
  }
  return snap;
}

function comercialErpTable(name, env = process.env) {
  const live = comercialErpLiveTable(name);
  if (isIsolatedCommercialTest(env) && comercialErpReadTestEnabled(env)) {
    return comercialErpSnapshotTable(name);
  }
  return live;
}

function comercialErpSchemaAndName(name, env = process.env) {
  const qualified = comercialErpTable(name, env);
  const [schema, table] = qualified.split('.');
  return { qualified, schema, table };
}

function comercialErpReadMap(env = process.env) {
  const map = {};
  for (const key of Object.keys(ERP_PROD)) {
    map[key] = comercialErpTable(key, env);
  }
  return map;
}

function comercialErpWriteForbiddenSql(sql) {
  const s = String(sql || '').toUpperCase().replace(/\s+/g, ' ');
  return [
    /\bINSERT\s+INTO\s+DSEDAC\./,
    /\bINSERT\s+INTO\s+DSED\./,
    /\bUPDATE\s+DSEDAC\./,
    /\bUPDATE\s+DSED\./,
    /\bDELETE\s+FROM\s+DSEDAC\./,
    /\bDELETE\s+FROM\s+DSED\./,
    /\bMERGE\s+INTO\s+DSEDAC\./,
    /\bMERGE\s+INTO\s+DSED\./,
    /\bALTER\s+TABLE\s+DSEDAC\./,
    /\bALTER\s+TABLE\s+DSED\./,
    /\bCREATE\s+TABLE\s+DSEDAC\./,
    /\bCREATE\s+TABLE\s+DSED\./,
    /\bDROP\s+TABLE\s+DSEDAC\./,
    /\bDROP\s+TABLE\s+DSED\./,
    /\bTRUNCATE\s+TABLE\s+DSEDAC\./,
    /\bTRUNCATE\s+TABLE\s+DSED\./,
  ].some((re) => re.test(s));
}

function assertNoDsedacWriteSql(sql) {
  if (comercialErpWriteForbiddenSql(sql)) {
    const error = new Error('Refusing DSEDAC/DSED write SQL');
    error.code = 'DSEDAC_WRITE_FORBIDDEN';
    throw error;
  }
}

module.exports = {
  ERP_PROD,
  ERP_TEST,
  isIsolatedCommercialTest,
  comercialErpReadTestEnabled,
  comercialErpLiveTable,
  comercialErpSnapshotTable,
  comercialErpTable,
  comercialErpSchemaAndName,
  comercialErpReadMap,
  comercialErpWriteForbiddenSql,
  assertNoDsedacWriteSql,
};
