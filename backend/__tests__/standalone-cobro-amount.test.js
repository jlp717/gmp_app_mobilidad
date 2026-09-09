'use strict';

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
  query: jest.fn(),
  getPool: jest.fn(),
  initDb: jest.fn(),
}));

const {
  erpDocumentAmountFromRow,
  evaluateStandaloneCobroRequest,
  resolveStandaloneCobroAvailable,
} = require('../services/repartidor-finance-service');
const { resolveDocumentCollectable } = require('../services/delivery-cobro-availability');
const { documentCappedPendingExpression } = require('../repositories/reparto-finance-db2-repository');

describe('standalone cobro amount (read/write parity)', () => {
  test('caps P-93-1532 style document to CPC total against higher CVC', () => {
    const row = {
      ERP_DOCUMENT_ROWS: 1,
      ERP_IMPORTEPENDIENTE: 3279.61,
      ERP_CPC_TOTAL: 2841.76,
      ERP_CAC_TOTAL: 3279.61,
      ERP_CPC_NETO_SUM: 2586.07,
      ERP_CPC_IVA_SUM: 255.69,
      ERP_LAC_LINE_SUM: 0,
      ERP_LAC_QTY_LINES: 0,
      ERP_LAC_ZERO_PRICE_LINES: 0,
    };
    expect(erpDocumentAmountFromRow(row)).toBe(2841.76);
    expect(resolveStandaloneCobroAvailable(row)).toBe(2841.76);
    expect(resolveStandaloneCobroAvailable(row, 1000)).toBe(1841.76);
  });

  test('uses LAC line sum when CPC header is empty but lines exist', () => {
    const row = {
      ERP_DOCUMENT_ROWS: 1,
      ERP_IMPORTEPENDIENTE: 120,
      ERP_CPC_TOTAL: 0,
      ERP_CAC_TOTAL: 0,
      ERP_CPC_NETO_SUM: 0,
      ERP_CPC_IVA_SUM: 0,
      ERP_LAC_LINE_SUM: 98.5,
      ERP_LAC_QTY_LINES: 3,
      ERP_LAC_ZERO_PRICE_LINES: 0,
    };
    expect(erpDocumentAmountFromRow(row)).toBe(98.5);
    expect(resolveDocumentCollectable({
      cvcState: 'AVAILABLE',
      cvcPending: 120,
      documentAmount: erpDocumentAmountFromRow(row),
    })).toMatchObject({
      importeDisponibleCobro: 98.5,
      capped: true,
    });
  });

  test('does not invent cobro from zero-price LAC when CPC header is empty', () => {
    const row = {
      ERP_DOCUMENT_ROWS: 1,
      ERP_IMPORTEPENDIENTE: 80,
      ERP_CPC_TOTAL: 0,
      ERP_CAC_TOTAL: 0,
      ERP_CPC_NETO_SUM: 0,
      ERP_CPC_IVA_SUM: 0,
      ERP_LAC_LINE_SUM: 0,
      ERP_LAC_QTY_LINES: 2,
      ERP_LAC_ZERO_PRICE_LINES: 2,
    };
    expect(erpDocumentAmountFromRow(row)).toBe(0);
    expect(resolveStandaloneCobroAvailable(row)).toBe(0);
  });

  test('fails closed when ERP exposes ambiguous CVC rows', () => {
    const row = {
      ERP_DOCUMENT_ROWS: 2,
      ERP_IMPORTEPENDIENTE: 200,
      ERP_CPC_TOTAL: 150,
      ERP_CAC_TOTAL: 0,
      ERP_CPC_NETO_SUM: 0,
      ERP_CPC_IVA_SUM: 0,
      ERP_LAC_LINE_SUM: 0,
      ERP_LAC_QTY_LINES: 0,
      ERP_LAC_ZERO_PRICE_LINES: 0,
    };
    expect(resolveStandaloneCobroAvailable(row)).toBe(0);
    expect(resolveStandaloneCobroAvailable({
      ...row,
      ERP_DOCUMENT_ROWS: '2',
    })).toBe(0);
  });

  test('subtracts prior app cobros for partial replay ceiling', () => {
    const row = {
      ERP_DOCUMENT_ROWS: 1,
      ERP_IMPORTEPENDIENTE: 200,
      ERP_CPC_TOTAL: 150,
      ERP_CAC_TOTAL: 0,
      ERP_CPC_NETO_SUM: 0,
      ERP_CPC_IVA_SUM: 0,
      ERP_LAC_LINE_SUM: 0,
      ERP_LAC_QTY_LINES: 0,
      ERP_LAC_ZERO_PRICE_LINES: 0,
    };
    expect(resolveStandaloneCobroAvailable(row, 60)).toBe(90);
  });

  test('live 84.68 CVC vs 49.56 document: GET/POST share the document cap', () => {
    const row = {
      ERP_DOCUMENT_ROWS: 1,
      ERP_IMPORTEPENDIENTE: 84.68,
      ERP_CPC_TOTAL: 49.56,
      ERP_CAC_TOTAL: 84.68,
      ERP_CPC_NETO_SUM: 0,
      ERP_CPC_IVA_SUM: 0,
      ERP_LAC_LINE_SUM: 0,
      ERP_LAC_QTY_LINES: 0,
      ERP_LAC_ZERO_PRICE_LINES: 0,
    };
    expect(resolveDocumentCollectable({
      cvcState: 'AVAILABLE',
      cvcPending: 84.68,
      documentAmount: erpDocumentAmountFromRow(row),
    })).toMatchObject({
      importeDisponibleCobro: 49.56,
      importeCvcPendiente: 84.68,
      capped: true,
    });
    expect(resolveStandaloneCobroAvailable(row)).toBe(49.56);
    expect(evaluateStandaloneCobroRequest({
      documentRow: row,
      requested: 0.01,
    })).toEqual({
      ok: true,
      available: 49.56,
      requested: 0.01,
      expectedRemaining: 49.55,
    });
    expect(evaluateStandaloneCobroRequest({
      documentRow: row,
      requested: 84.68,
    })).toEqual({
      ok: false,
      available: 49.56,
      requested: 84.68,
      expectedRemaining: 0,
    });
    expect(evaluateStandaloneCobroRequest({
      documentRow: row,
      requested: 49.56,
    })).toMatchObject({ ok: true, expectedRemaining: 0 });
  });

  test('stale GET remaining does not reject a cobro within the document cap', () => {
    const row = {
      ERP_DOCUMENT_ROWS: 1,
      ERP_IMPORTEPENDIENTE: 84.68,
      ERP_CPC_TOTAL: 49.56,
      ERP_CAC_TOTAL: 0,
      ERP_CPC_NETO_SUM: 0,
      ERP_CPC_IVA_SUM: 0,
      ERP_LAC_LINE_SUM: 0,
      ERP_LAC_QTY_LINES: 0,
      ERP_LAC_ZERO_PRICE_LINES: 0,
    };
    const accepted = evaluateStandaloneCobroRequest({
      documentRow: row,
      requested: 0.01,
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.expectedRemaining).toBe(49.55);
  });

  test('GET vencimientos pending SQL caps at CPC.IMPORTETOTAL then subtracts app cobros', () => {
    const withApp = documentCappedPendingExpression('APP_COBROS.IMPORTE_COBRADO_APP');
    expect(withApp).toContain('CPC.IMPORTETOTAL');
    expect(withApp).toContain('APP_COBROS.IMPORTE_COBRADO_APP');
    expect(withApp).toMatch(/CVC\.IMPORTEPENDIENTE > CPC\.IMPORTETOTAL/);
    expect(withApp).toMatch(/AS IMPORTEPENDIENTE$/);
    const withoutApp = documentCappedPendingExpression(null);
    expect(withoutApp).toContain('CPC.IMPORTETOTAL');
    expect(withoutApp).not.toContain('APP_COBROS');
  });
});
