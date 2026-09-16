'use strict';

const { comercialErpTable, isIsolatedCommercialTest } = require('../utils/comercial-erp-tables');

describe('comercial ERP table mapping', () => {
  const previous = {};
  const keys = ['REPARTO_TABLE_SET', 'COMERCIAL_ERP_READ_TEST', 'REPARTO_ENVIRONMENT', 'NODE_ENV'];

  beforeEach(() => {
    for (const key of keys) previous[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  test('production stays on DSEDAC / DSED.LACLAE', () => {
    process.env.REPARTO_TABLE_SET = 'production';
    expect(isIsolatedCommercialTest()).toBe(false);
    expect(comercialErpTable('CVC')).toBe('DSEDAC.CVC');
    expect(comercialErpTable('FPG')).toBe('DSEDAC.FPG');
    expect(comercialErpTable('LACLAE')).toBe('DSED.LACLAE');
    expect(comercialErpTable('LQD')).toBe('DSEDAC.LQD');
  });

  test('isolated_test reads JAVIER.TEST_* copies', () => {
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    expect(comercialErpTable('CVC')).toBe('JAVIER.TEST_CVC');
    expect(comercialErpTable('FPG')).toBe('JAVIER.TEST_FPG');
    expect(comercialErpTable('CAC')).toBe('JAVIER.TEST_CAC');
    expect(comercialErpTable('CPC')).toBe('JAVIER.TEST_CPC');
    expect(comercialErpTable('LQD')).toBe('JAVIER.TEST_LQD');
    expect(comercialErpTable('CLX')).toBe('JAVIER.TEST_CLX');
    expect(comercialErpTable('VDDX')).toBe('JAVIER.TEST_VDDX');
    expect(comercialErpTable('LACLAE')).toBe('JAVIER.TEST_LACLAE');
    expect(comercialErpTable('PMR')).toBe('JAVIER.TEST_PMR');
  });

  test('COMERCIAL_ERP_READ_TEST=false falls back to DSEDAC SELECT', () => {
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    process.env.COMERCIAL_ERP_READ_TEST = 'false';
    expect(comercialErpTable('CVC')).toBe('DSEDAC.CVC');
    expect(comercialErpTable('LACLAE')).toBe('DSED.LACLAE');
  });
});
