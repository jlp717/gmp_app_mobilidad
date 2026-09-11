'use strict';

const {
  DEBT_VIEW,
  DEBT_FETCH_FIRST_MAX,
  debtViewFrom,
  boundDebtFetchFirst,
  cvcLiveTypeSql,
  cvcDocumentJoins,
  cvcCliJoin,
  formaPagoLabel,
  isBelowMinCobro,
} = require('../services/debt-view-contract');

describe('debt-view-contract', () => {
  test('uses DSEDAC.CVC and never JAVIER.VISTA_DEUDA_BASE', () => {
    expect(DEBT_VIEW).toBe('DSEDAC.CVC');
    expect(debtViewFrom('CVC')).toBe('FROM DSEDAC.CVC CVC');
    expect(DEBT_VIEW).not.toMatch(/VISTA_DEUDA_BASE/i);
  });

  test('caps FETCH FIRST at 500', () => {
    expect(DEBT_FETCH_FIRST_MAX).toBe(500);
    expect(boundDebtFetchFirst(10000)).toBe(500);
    expect(boundDebtFetchFirst(25)).toBe(25);
    expect(boundDebtFetchFirst('nope')).toBe(500);
  });

  test('joins CAC/CPC/FPG and CLI for commercial live debt', () => {
    const joins = cvcDocumentJoins('C');
    expect(joins).toMatch(/LEFT JOIN DSEDAC\.CAC CAC/i);
    expect(joins).toMatch(/LEFT JOIN DSEDAC\.CPC CPC/i);
    expect(joins).toMatch(/LEFT JOIN DSEDAC\.FPG FPG/i);
    expect(joins).not.toMatch(/DSEDAC\.FPA/i);
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
