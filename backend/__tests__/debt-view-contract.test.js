'use strict';

const {
  DEBT_VIEW,
  DEBT_FETCH_FIRST_MAX,
  debtViewFrom,
  boundDebtFetchFirst,
} = require('../services/debt-view-contract');

describe('debt-view-contract', () => {
  test('uses JAVIER.VISTA_DEUDA_BASE with an alias', () => {
    expect(DEBT_VIEW).toBe('JAVIER.VISTA_DEUDA_BASE');
    expect(debtViewFrom('CVC')).toBe('FROM JAVIER.VISTA_DEUDA_BASE CVC');
  });

  test('caps FETCH FIRST at 500', () => {
    expect(DEBT_FETCH_FIRST_MAX).toBe(500);
    expect(boundDebtFetchFirst(10000)).toBe(500);
    expect(boundDebtFetchFirst(25)).toBe(25);
    expect(boundDebtFetchFirst('nope')).toBe(500);
  });
});
