'use strict';

const {
  DEBT_VIEW,
  DEBT_FETCH_FIRST_MAX,
  debtViewFrom,
  boundDebtFetchFirst,
  cvcLiveTypeSql,
  cvcDocumentJoins,
  cvcPendientesJoins,
  cvcCliJoin,
  formaPagoLabel,
  isBelowMinCobro,
} = require('../services/debt-view-contract');

describe('debt-view-contract', () => {
  const previousTableSet = process.env.REPARTO_TABLE_SET;

  afterEach(() => {
    if (previousTableSet === undefined) delete process.env.REPARTO_TABLE_SET;
    else process.env.REPARTO_TABLE_SET = previousTableSet;
    jest.resetModules();
  });

  test('uses DSEDAC.CVC and never JAVIER.VISTA_DEUDA_BASE', () => {
    delete process.env.REPARTO_TABLE_SET;
    jest.resetModules();
    const {
      DEBT_VIEW,
      debtViewFrom,
    } = require('../services/debt-view-contract');
    expect(DEBT_VIEW).toBe('DSEDAC.CVC');
    expect(debtViewFrom('CVC')).toBe('FROM DSEDAC.CVC CVC');
    expect(DEBT_VIEW).not.toMatch(/VISTA_DEUDA_BASE/i);
  });

  test('isolated_test debt reads live DSEDAC CVC/FPG not TEST copies', () => {
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    delete process.env.COMERCIAL_ERP_READ_TEST;
    jest.resetModules();
    const {
      getDebtView,
      cvcPendientesJoins,
      cvcDocumentJoins,
      cvcCliJoin,
    } = require('../services/debt-view-contract');
    expect(getDebtView()).toBe('DSEDAC.CVC');
    expect(cvcPendientesJoins('C')).toMatch(/LEFT JOIN DSEDAC\.FPG FPG/i);
    expect(cvcDocumentJoins('C')).toMatch(/LEFT JOIN DSEDAC\.CAC CAC/i);
    expect(cvcDocumentJoins('C')).toMatch(/LEFT JOIN DSEDAC\.CPC CPC/i);
    expect(cvcDocumentJoins('C')).not.toMatch(/VISTA_DEUDA_BASE/i);
    expect(cvcCliJoin('CVC')).toMatch(/LEFT JOIN DSEDAC\.CLI CLI/i);
    expect(getDebtView()).not.toMatch(/TEST_CVC/i);
  });

  test('caps FETCH FIRST at 500', () => {
    expect(DEBT_FETCH_FIRST_MAX).toBe(500);
    expect(boundDebtFetchFirst(10000)).toBe(500);
    expect(boundDebtFetchFirst(25)).toBe(25);
    expect(boundDebtFetchFirst('nope')).toBe(500);
  });

  test('joins CAC/CPC/FPG and CLI for commercial live debt', () => {
    delete process.env.REPARTO_TABLE_SET;
    const {
      cvcDocumentJoins,
      cvcPendientesJoins,
      cvcCliJoin,
      cvcLiveTypeSql,
    } = require('../services/debt-view-contract');
    const joins = cvcDocumentJoins('C');
    expect(joins).toMatch(/LEFT JOIN DSEDAC\.CAC CAC/i);
    expect(joins).toMatch(/LEFT JOIN DSEDAC\.CPC CPC/i);
    expect(joins).toMatch(/LEFT JOIN DSEDAC\.FPG FPG/i);
    expect(joins).not.toMatch(/DSEDAC\.FPA/i);
    const pendientesJoins = cvcPendientesJoins('C');
    expect(pendientesJoins).toMatch(/LEFT JOIN DSEDAC\.FPG FPG/i);
    expect(pendientesJoins).toMatch(/FPG\.CODIGOFORMAPAGO = C\.CODIGOFORMAPAGO/);
    expect(pendientesJoins).not.toMatch(/TRIM\(FPG\.CODIGOFORMAPAGO\)/);
    expect(pendientesJoins).not.toMatch(/LEFT JOIN DSEDAC\.CAC/i);
    expect(pendientesJoins).not.toMatch(/LEFT JOIN DSEDAC\.CPC/i);
    expect(cvcCliJoin('CVC')).toMatch(/LEFT JOIN DSEDAC\.CLI CLI/i);
    expect(cvcLiveTypeSql('CVC')).toMatch(/'COB'/);
    expect(cvcLiveTypeSql('CVC')).toMatch(/'DEV'/);
  });

  test('maps PG to PAGARE and blocks cobro below the rigorous minimum', () => {
    expect(formaPagoLabel('PG')).toBe('PAGARE');
    expect(formaPagoLabel('02', 'CONTADO')).toBe('CONTADO');
    expect(isBelowMinCobro({
      cobroRiguroso: true,
      porcentajeMinimoCobro: 50,
      pendingAmount: 100,
      amount: 20,
    })).toBe(true);
    expect(isBelowMinCobro({
      cobroRiguroso: true,
      porcentajeMinimoCobro: 50,
      pendingAmount: 100,
      amount: 100,
    })).toBe(false);
  });
});
