'use strict';

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
  query: jest.fn(),
  getPool: jest.fn(() => null),
  initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { queryWithParams } = require('../config/db');
const {
  isGiftLine,
  applyGiftPromotionsToLines,
  assertMinCobroAllowsOrder,
  evaluateMinCobroOrderGate,
  resetMinCobroColumnCache,
} = require('../services/pedidos-comercial-gates');
const { capPendingToDocument } = require('../services/debt-view-contract');

describe('pedidos comercial gates', () => {
  beforeEach(() => {
    queryWithParams.mockReset();
    resetMinCobroColumnCache();
  });

  test('isGiftLine detects tipo G / auto gift / SC at 0', () => {
    expect(isGiftLine({ tipoLinea: 'G', precio: 10 })).toBe(true);
    expect(isGiftLine({ isAutoGift: true, precio: 4 })).toBe(true);
    expect(isGiftLine({ claseLinea: 'SC', precioVenta: 0 })).toBe(true);
    expect(isGiftLine({ tipoLinea: 'R', precio: 10 })).toBe(false);
  });

  test('applyGiftPromotionsToLines adds 3+1 REGALO at price 0', () => {
    const lines = applyGiftPromotionsToLines(
      [{
        codigoArticulo: 'ART001',
        descripcion: 'Pastel',
        cantidadEnvases: 3,
        unidadMedida: 'CAJAS',
        precio: 10,
        precioVenta: 10,
        tipoLinea: 'R',
        promotionCode: 'PMR31',
      }],
      [{
        promoType: 'GIFT',
        promoCode: 'PMR31',
        productCode: 'ART001',
        minQty: 3,
        giftQty: 1,
        cumulative: false,
        promoDesc: '3+1 PASTELERIA',
      }],
    );
    expect(lines).toHaveLength(2);
    expect(isGiftLine(lines[1])).toBe(true);
    expect(lines[1].precioVenta).toBe(0);
    expect(lines[1].tipoLinea).toBe('G');
    expect(lines[1].promotionCode).toBe('PMR31');
  });

  test('capPendingToDocument uses min(CVC, documento)', () => {
    expect(capPendingToDocument(200, 100)).toBe(100);
    expect(capPendingToDocument(40, 100)).toBe(40);
    expect(capPendingToDocument(40, 0)).toBe(40);
  });

  test('assertMinCobroAllowsOrder blocks below CLX rigorous percent', async () => {
    queryWithParams.mockImplementation(async (sql) => {
      if (/SYSCOLUMNS/i.test(sql) && /PORCENTAJEMINIMOCOBRO/i.test(String(sql))) {
        return [{ COLUMN_NAME: 'PORCENTAJEMINIMOCOBRO' }];
      }
      if (/SYSCOLUMNS/i.test(sql)) return [{ COLUMN_NAME: 'X' }];
      if (/FROM DSEDAC\.VDDX/i.test(sql)) return [{ PCT: 30 }];
      if (/FROM DSEDAC\.CLX/i.test(sql)) return [{ SN: 'S', PCT: 50 }];
      if (/FROM DSEDAC\.CVC/i.test(sql)) return [{ TOTAL_DOC: 1000, PENDIENTE: 900 }];
      return [];
    });

    await expect(assertMinCobroAllowsOrder({
      clientCode: '4300000001',
      vendorCode: '35',
    })).rejects.toMatchObject({
      code: 'MIN_COBRO_ORDER_BLOCKED',
      status: 403,
    });
  });

  test('evaluateMinCobroOrderGate allows vendor who meets VDDX percent', async () => {
    queryWithParams.mockImplementation(async (sql) => {
      if (/SYSCOLUMNS/i.test(sql)) return [{ COLUMN_NAME: 'X' }];
      if (/FROM DSEDAC\.VDDX/i.test(sql)) return [{ PCT: 30 }];
      if (/FROM DSEDAC\.CLX/i.test(sql)) return [{ SN: 'N', PCT: 0 }];
      if (/FROM DSEDAC\.CVC/i.test(sql)) return [{ TOTAL_DOC: 1000, PENDIENTE: 200 }];
      return [];
    });

    const gate = await evaluateMinCobroOrderGate({
      clientCode: '4300000002',
      vendorCode: '80',
    });
    expect(gate.blocked).toBe(false);
    expect(gate.minPct).toBe(30);
    expect(gate.actualPct).toBe(80);
  });
});
