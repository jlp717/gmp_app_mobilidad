'use strict';

/**
 * Commercial ERP table resolution for isolated_test.
 * Writes never go here (CVC/FPG/LQD stay read-only copies).
 * isolated_test reads JAVIER.TEST_* unless COMERCIAL_ERP_READ_TEST=false.
 * Production / missing mapping → DSEDAC (or DSED.LACLAE).
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
  LAC: 'DSEDAC.LAC',
  LACLAE: 'DSED.LACLAE',
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
  LAC: 'JAVIER.TEST_LAC',
  LACLAE: 'JAVIER.TEST_LACLAE',
});

function isIsolatedCommercialTest(env = process.env) {
  return String(env.REPARTO_TABLE_SET || '').trim().toLowerCase() === 'isolated_test';
}

function comercialErpReadTestEnabled(env = process.env) {
  return String(env.COMERCIAL_ERP_READ_TEST || 'true').trim().toLowerCase() !== 'false';
}

function comercialErpTable(name, env = process.env) {
  const key = String(name || '').trim().toUpperCase();
  const prod = ERP_PROD[key];
  if (!prod) {
    throw new Error(`Unknown commercial ERP table: ${name}`);
  }
  if (isIsolatedCommercialTest(env) && comercialErpReadTestEnabled(env)) {
    return ERP_TEST[key];
  }
  return prod;
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
  comercialErpTable,
  comercialErpSchemaAndName,
  comercialErpReadMap,
  comercialErpWriteForbiddenSql,
  assertNoDsedacWriteSql,
};
