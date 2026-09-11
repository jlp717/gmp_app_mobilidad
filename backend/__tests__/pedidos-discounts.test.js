'use strict';

const {
  clampDiscountPct,
  parseLineDiscountPct,
  parseGlobalDiscountPct,
  applyPctToAmount,
  isCobroPropio,
} = require('../services/pedidos/discounts');

describe('pedidos discount helpers', () => {
  test('clamps percent to 0-100 with two decimals', () => {
    expect(clampDiscountPct(-4)).toBe(0);
    expect(clampDiscountPct('12.345')).toBe(12.35);
    expect(clampDiscountPct(250)).toBe(100);
  });

  test('reads line discount from Flutter and ERP aliases', () => {
    expect(parseLineDiscountPct({ lineDiscountPct: 10 })).toBe(10);
    expect(parseLineDiscountPct({ descuentoLinea: 8 })).toBe(8);
    expect(parseLineDiscountPct({ DESCUENTO_LINEA: 5 })).toBe(5);
    expect(parseLineDiscountPct({ PORCENTAJEDESCUENTO: 12 })).toBe(12);
  });

  test('reads pie discount from header aliases', () => {
    expect(parseGlobalDiscountPct({ descuentoGlobal: 7 })).toBe(7);
    expect(parseGlobalDiscountPct({ globalDiscountPct: 15 })).toBe(15);
    expect(parseGlobalDiscountPct({ PORCENTAJEDESCUENTO1: 7 })).toBe(7);
  });

  test('applies percent to gross amount without mutating unit price', () => {
    expect(applyPctToAmount(20, 10)).toBe(18);
    expect(applyPctToAmount(10, 0)).toBe(10);
  });

  test('detects cobro en mano del comercial', () => {
    expect(isCobroPropio({ cobroPropio: true })).toBe(true);
    expect(isCobroPropio({ cobroEnMano: 'S' })).toBe(true);
    expect(isCobroPropio({})).toBe(false);
  });

  test('maps line discount to LPC.PORCENTAJEDESCUENTO and pie to CPC.PORCENTAJEDESCUENTO1', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../services/pedidos/index.js'), 'utf8');
    expect(src).toMatch(/function buildDsedacLpcInsert[\s\S]*'PORCENTAJEDESCUENTO'/);
    expect(src).toMatch(/function buildDsedacCpcInsert[\s\S]*'PORCENTAJEDESCUENTO1'/);
  });
});
