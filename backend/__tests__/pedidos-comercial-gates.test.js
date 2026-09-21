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

  test('rejects arbitrary, unknown and over-entitled submitted gifts', () => {
    const promotion = [{ promoType: 'GIFT', promoCode: 'PMR31', productCode: '4773', giftSkus: ['4773'], minQty: 3, giftQty: 1 }];
    const paid = { codigoArticulo: '4773', cantidadEnvases: 3, unidadMedida: 'CAJAS', promotionCode: 'PMR31' };
    const gift = { codigoArticulo: '9999', cantidadEnvases: 1, unidadMedida: 'CAJAS', tipoLinea: 'G', promotionCode: 'PMR31' };
    expect(() => applyGiftPromotionsToLines([paid, gift], promotion)).toThrow(expect.objectContaining({ code: 'INVALID_PROMOTION_GIFT' }));
    expect(() => applyGiftPromotionsToLines([paid, { ...gift, codigoArticulo: '4773', promotionCode: 'UNKNOWN' }], promotion)).toThrow(expect.objectContaining({ code: 'INVALID_PROMOTION_GIFT' }));
    expect(() => applyGiftPromotionsToLines([paid, { ...gift, codigoArticulo: '4773', cantidadEnvases: 2 }], promotion)).toThrow(expect.objectContaining({ code: 'INVALID_PROMOTION_GIFT' }));
  });

  test('uses the submitted eligible SKU and deduplicates PMP rows by promo code', () => {
    const promotions = [
      { promoType: 'GIFT', promoCode: 'NST', productCode: '3568', giftSkus: ['3568', '4773'], minQty: 3, giftQty: 2, noGiftBought: false },
      { promoType: 'GIFT', promoCode: 'NST', productCode: '4773', giftSkus: ['3568', '4773'], minQty: 3, giftQty: 2, noGiftBought: false },
    ];
    const lines = applyGiftPromotionsToLines([
      { codigoArticulo: '4773', cantidadEnvases: 3, unidadMedida: 'CAJAS', promotionCode: 'NST' },
      { codigoArticulo: '4773', cantidadEnvases: 2, unidadMedida: 'CAJAS', tipoLinea: 'G', promotionCode: 'NST' },
    ], promotions);
    expect(lines.filter(isGiftLine)).toHaveLength(1);
    expect(lines.filter(isGiftLine)[0].codigoArticulo).toBe('4773');
  });

  test('requires a different explicit selection when noGiftBought leaves no eligible SKU', () => {
    expect(() => applyGiftPromotionsToLines([
      { codigoArticulo: '4773', cantidadEnvases: 3, unidadMedida: 'CAJAS', promotionCode: 'NST' },
    ], [{ promoType: 'GIFT', promoCode: 'NST', productCode: '4773', giftSkus: ['4773'], minQty: 3, giftQty: 1, noGiftBought: true }]))
      .toThrow(expect.objectContaining({ code: 'GIFT_SELECTION_REQUIRED' }));
  });

  test('uses the UI paid-plus-explicit-gift shape without trusting a paid promo marker', () => {
    const lines = applyGiftPromotionsToLines([
      { codigoArticulo: '4773', cantidadEnvases: 3, unidadMedida: 'CAJAS', precioVenta: 8 },
      { codigoArticulo: '4773', cantidadEnvases: 2, unidadMedida: 'CAJAS', precioVenta: 0, tipoLinea: 'G', promotionCode: 'NST' },
    ], [{ promoType: 'GIFT', promoCode: 'NST', productCode: '3568', giftSkus: ['3568', '4773'], minQty: 3, giftQty: 2, noGiftBought: false }]);
    expect(lines.filter(isGiftLine)).toEqual([expect.objectContaining({ codigoArticulo: '4773', cantidadEnvases: 2, precioVenta: 0 })]);
  });

  test('rejects gifts without entitlement, noGiftBought reuse, and invalid zero or negative quantities', () => {
    const promotion = [{ promoType: 'GIFT', promoCode: 'NST', productCode: '4773', giftSkus: ['4773', '3568'], minQty: 3, giftQty: 1, noGiftBought: true }];
    const gift = { codigoArticulo: '4773', cantidadEnvases: 1, unidadMedida: 'CAJAS', precioVenta: 0, tipoLinea: 'G', promotionCode: 'NST' };
    expect(() => applyGiftPromotionsToLines([{ codigoArticulo: '4773', cantidadEnvases: 2, unidadMedida: 'CAJAS' }, gift], promotion))
      .toThrow(expect.objectContaining({ code: 'INVALID_PROMOTION_GIFT' }));
    expect(() => applyGiftPromotionsToLines([{ codigoArticulo: '4773', cantidadEnvases: 3, unidadMedida: 'CAJAS' }, gift], promotion))
      .toThrow(expect.objectContaining({ code: 'INVALID_PROMOTION_GIFT' }));
    expect(() => applyGiftPromotionsToLines([{ codigoArticulo: '4773', cantidadEnvases: 3, unidadMedida: 'CAJAS' }, { ...gift, codigoArticulo: '3568', cantidadEnvases: 0 }], promotion))
      .toThrow(expect.objectContaining({ code: 'INVALID_PROMOTION_GIFT' }));
  });

  test('auto gift prefers the purchased eligible SKU over the first PMP row', () => {
    const lines = applyGiftPromotionsToLines([
      { codigoArticulo: '4773', cantidadEnvases: 3, unidadMedida: 'CAJAS', promotionCode: 'NST' },
    ], [
      { promoType: 'GIFT', promoCode: 'NST', productCode: '3568', giftSkus: ['3568', '4773'], minQty: 3, giftQty: 1, noGiftBought: false },
      { promoType: 'GIFT', promoCode: 'NST', productCode: '4773', giftSkus: ['3568', '4773'], minQty: 3, giftQty: 1, noGiftBought: false },
    ]);
    expect(lines.filter(isGiftLine)[0].codigoArticulo).toBe('4773');
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

  test('assertMinCobroAllowsOrder uses TEST_CLX/TEST_CVC overlay when live CLX has no row', async () => {
    const previous = process.env.REPARTO_TABLE_SET;
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    resetMinCobroColumnCache();
    queryWithParams.mockImplementation(async (sql) => {
      if (/SYSCOLUMNS/i.test(sql)) return [{ COLUMN_NAME: 'X' }];
      if (/FROM DSEDAC\.VDDX/i.test(sql)) return [{ PCT: 30 }];
      if (/FROM DSEDAC\.CLX/i.test(sql)) return [];
      if (/FROM JAVIER\.TEST_CLX/i.test(sql)) return [{ SN: 'S', PCT: 90 }];
      if (/FROM JAVIER\.TEST_CVC/i.test(sql)) return [{ TOTAL_DOC: 1000, PENDIENTE: 900 }];
      if (/FROM DSEDAC\.CVC/i.test(sql)) return [{ TOTAL_DOC: 0, PENDIENTE: 0 }];
      return [];
    });

    try {
      await expect(assertMinCobroAllowsOrder({
        clientCode: 'ZZHITMIN01',
        vendorCode: '35',
      })).rejects.toMatchObject({
        code: 'MIN_COBRO_ORDER_BLOCKED',
        status: 403,
      });
    } finally {
      if (previous === undefined) delete process.env.REPARTO_TABLE_SET;
      else process.env.REPARTO_TABLE_SET = previous;
    }
  });
});
