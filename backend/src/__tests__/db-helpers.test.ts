/**
 * Tests for db-helpers.ts - Shared Data Transformation Utilities
 *
 * Tests cover all exported functions:
 * - toFloat, toInt, toStr (row value extractors)
 * - formatDateDMY, formatNumericDate (date formatting)
 * - clampLimit, clampOffset, currentPage, totalPages (pagination)
 */

import {
  toFloat,
  toInt,
  toStr,
  formatDateDMY,
  formatNumericDate,
  clampLimit,
  clampOffset,
  currentPage,
  totalPages,
} from '../utils/db-helpers';

// ============================================
// toFloat
// ============================================
describe('toFloat', () => {
  test('converts number values', () => {
    expect(toFloat(42.5)).toBe(42.5);
    expect(toFloat(0)).toBe(0);
    expect(toFloat(-10.3)).toBe(-10.3);
  });

  test('converts string values', () => {
    expect(toFloat('42.5')).toBe(42.5);
    expect(toFloat('0')).toBe(0);
    expect(toFloat('-10.3')).toBe(-10.3);
    expect(toFloat('100')).toBe(100);
  });

  test('returns 0 for null/undefined', () => {
    expect(toFloat(null)).toBe(0);
    expect(toFloat(undefined)).toBe(0);
  });

  test('returns 0 for NaN-producing values', () => {
    expect(toFloat('abc')).toBe(0);
    expect(toFloat('')).toBe(0);
    expect(toFloat('not a number')).toBe(0);
  });

  test('handles DB-style string numbers', () => {
    // Common pattern in DB2 results: numbers as strings
    expect(toFloat('1234.56')).toBe(1234.56);
    expect(toFloat(' 42.5 ')).toBe(42.5);
  });
});

// ============================================
// toInt
// ============================================
describe('toInt', () => {
  test('converts number values', () => {
    expect(toInt(42)).toBe(42);
    expect(toInt(0)).toBe(0);
    expect(toInt(-10)).toBe(-10);
  });

  test('truncates floating point numbers', () => {
    expect(toInt(42.9)).toBe(42);
    expect(toInt(42.1)).toBe(42);
    expect(toInt(-10.9)).toBe(-10);
  });

  test('converts string values', () => {
    expect(toInt('42')).toBe(42);
    expect(toInt('0')).toBe(0);
    expect(toInt('-10')).toBe(-10);
  });

  test('returns 0 for null/undefined', () => {
    expect(toInt(null)).toBe(0);
    expect(toInt(undefined)).toBe(0);
  });

  test('returns 0 for NaN-producing values', () => {
    expect(toInt('abc')).toBe(0);
    expect(toInt('')).toBe(0);
  });

  test('parses integer part of float strings', () => {
    expect(toInt('42.9')).toBe(42);
  });
});

// ============================================
// toStr
// ============================================
describe('toStr', () => {
  test('trims string values', () => {
    expect(toStr('  hello  ')).toBe('hello');
    expect(toStr('hello')).toBe('hello');
  });

  test('converts number to string', () => {
    expect(toStr(42)).toBe('42');
    expect(toStr(0)).toBe('0');
  });

  test('returns empty string for null/undefined', () => {
    expect(toStr(null)).toBe('');
    expect(toStr(undefined)).toBe('');
  });

  test('handles boolean values', () => {
    expect(toStr(true)).toBe('true');
    expect(toStr(false)).toBe('false');
  });

  test('handles DB column values with trailing spaces', () => {
    // DB2 CHAR fields often have trailing spaces
    expect(toStr('CLIENTE001     ')).toBe('CLIENTE001');
    expect(toStr('   TRIMMED   ')).toBe('TRIMMED');
  });
});

// ============================================
// formatDateDMY
// ============================================
describe('formatDateDMY', () => {
  test('formats valid day/month/year', () => {
    expect(formatDateDMY(5, 3, 2026)).toBe('05/03/2026');
    expect(formatDateDMY(25, 12, 2025)).toBe('25/12/2025');
    expect(formatDateDMY(1, 1, 2020)).toBe('01/01/2020');
  });

  test('pads single-digit day and month', () => {
    expect(formatDateDMY(1, 1, 2026)).toBe('01/01/2026');
    expect(formatDateDMY(9, 9, 2026)).toBe('09/09/2026');
  });

  test('handles string values (from DB rows)', () => {
    expect(formatDateDMY('5', '3', '2026')).toBe('05/03/2026');
    expect(formatDateDMY('25', '12', '2025')).toBe('25/12/2025');
  });

  test('returns empty string for missing values', () => {
    expect(formatDateDMY(0, 3, 2026)).toBe('');
    expect(formatDateDMY(5, 0, 2026)).toBe('');
    expect(formatDateDMY(5, 3, 0)).toBe('');
    expect(formatDateDMY(null, 3, 2026)).toBe('');
    expect(formatDateDMY(5, null, 2026)).toBe('');
    expect(formatDateDMY(5, 3, null)).toBe('');
    expect(formatDateDMY(undefined, undefined, undefined)).toBe('');
  });

  test('handles double-digit months and days without extra padding', () => {
    expect(formatDateDMY(15, 11, 2026)).toBe('15/11/2026');
    expect(formatDateDMY(31, 12, 2026)).toBe('31/12/2026');
  });
});

// ============================================
// formatNumericDate
// ============================================
describe('formatNumericDate', () => {
  test('formats YYYYMMDD integer to DD/MM/YYYY', () => {
    expect(formatNumericDate(20260214)).toBe('14/02/2026');
    expect(formatNumericDate(20251231)).toBe('31/12/2025');
    expect(formatNumericDate(20200101)).toBe('01/01/2020');
  });

  test('returns undefined for falsy values', () => {
    expect(formatNumericDate(0)).toBeUndefined();
    expect(formatNumericDate(null)).toBeUndefined();
    expect(formatNumericDate(undefined)).toBeUndefined();
  });

  test('returns undefined for short numbers', () => {
    expect(formatNumericDate(2026)).toBeUndefined();
    expect(formatNumericDate(202601)).toBeUndefined();
  });

  test('handles string input', () => {
    expect(formatNumericDate('20260214')).toBe('14/02/2026');
  });
});

// ============================================
// clampLimit
// ============================================
describe('clampLimit', () => {
  test('returns default when value is falsy', () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(null)).toBe(50);
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit('')).toBe(50);
  });

  test('uses custom default', () => {
    expect(clampLimit(undefined, 100)).toBe(100);
    expect(clampLimit(0, 12)).toBe(12);
  });

  test('clamps to minimum 1', () => {
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(-100)).toBe(1);
  });

  test('clamps to maximum (default 500)', () => {
    expect(clampLimit(1000)).toBe(500);
    expect(clampLimit(999)).toBe(500);
  });

  test('clamps to custom maximum', () => {
    expect(clampLimit(100, 50, 200)).toBe(100);
    expect(clampLimit(300, 50, 200)).toBe(200);
    expect(clampLimit(100, 50, 52)).toBe(52);
  });

  test('accepts valid values within range', () => {
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(500)).toBe(500);
    expect(clampLimit(100)).toBe(100);
  });

  test('handles string values', () => {
    expect(clampLimit('50')).toBe(50);
    expect(clampLimit('1000')).toBe(500);
  });
});

// ============================================
// clampOffset
// ============================================
describe('clampOffset', () => {
  test('returns 0 for falsy values', () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(null)).toBe(0);
    expect(clampOffset(0)).toBe(0);
    expect(clampOffset('')).toBe(0);
  });

  test('clamps negative to 0', () => {
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(-100)).toBe(0);
  });

  test('accepts positive values', () => {
    expect(clampOffset(50)).toBe(50);
    expect(clampOffset(100)).toBe(100);
    expect(clampOffset(999)).toBe(999);
  });

  test('handles string values', () => {
    expect(clampOffset('50')).toBe(50);
    expect(clampOffset('0')).toBe(0);
    expect(clampOffset('-10')).toBe(0);
  });
});

// ============================================
// currentPage
// ============================================
describe('currentPage', () => {
  test('calculates page 1 for offset 0', () => {
    expect(currentPage(0, 50)).toBe(1);
    expect(currentPage(0, 100)).toBe(1);
  });

  test('calculates correct page for offset', () => {
    expect(currentPage(50, 50)).toBe(2);
    expect(currentPage(100, 50)).toBe(3);
    expect(currentPage(150, 50)).toBe(4);
  });

  test('handles non-aligned offsets', () => {
    expect(currentPage(25, 50)).toBe(1); // floor(25/50) + 1 = 1
    expect(currentPage(75, 50)).toBe(2); // floor(75/50) + 1 = 2
  });
});

// ============================================
// totalPages
// ============================================
describe('totalPages', () => {
  test('calculates correct total pages', () => {
    expect(totalPages(100, 50)).toBe(2);
    expect(totalPages(101, 50)).toBe(3);
    expect(totalPages(50, 50)).toBe(1);
    expect(totalPages(0, 50)).toBe(0);
  });

  test('handles single item per page', () => {
    expect(totalPages(5, 1)).toBe(5);
  });

  test('handles exactly divisible totals', () => {
    expect(totalPages(200, 100)).toBe(2);
    expect(totalPages(500, 50)).toBe(10);
  });
});

// ============================================
// INTEGRATION: Simulated DB row processing
// ============================================
describe('Integration: DB row processing', () => {
  test('processes a typical DB2 CAC row', () => {
    const dbRow = {
      SERIE: '  A  ',
      NUMERO: 12345,
      EJERCICIO: 2026,
      DIA: 14,
      MES: 2,
      ANO: 2026,
      CODIGO_CLIENTE: '  CLI001  ',
      NOMBRE_CLIENTE: '  GRANJA MARI PEPA  ',
      TOTAL: '1234.56',
      BASE: '1020.30',
      IVA: '214.26',
    };

    const mapped = {
      serie: toStr(dbRow.SERIE),
      numero: dbRow.NUMERO,
      ejercicio: dbRow.EJERCICIO,
      fecha: formatDateDMY(dbRow.DIA, dbRow.MES, dbRow.ANO),
      clienteId: toStr(dbRow.CODIGO_CLIENTE),
      clienteNombre: toStr(dbRow.NOMBRE_CLIENTE),
      total: toFloat(dbRow.TOTAL),
      base: toFloat(dbRow.BASE),
      iva: toFloat(dbRow.IVA),
    };

    expect(mapped.serie).toBe('A');
    expect(mapped.fecha).toBe('14/02/2026');
    expect(mapped.clienteId).toBe('CLI001');
    expect(mapped.clienteNombre).toBe('GRANJA MARI PEPA');
    expect(mapped.total).toBe(1234.56);
    expect(mapped.base).toBe(1020.30);
    expect(mapped.iva).toBe(214.26);
  });

  test('processes a row with null/missing fields', () => {
    const dbRow: Record<string, unknown> = {
      SERIE: null,
      NUMERO: undefined,
      TOTAL: '',
      DIA: null,
      MES: null,
      ANO: null,
    };

    expect(toStr(dbRow.SERIE)).toBe('');
    expect(toFloat(dbRow.TOTAL)).toBe(0);
    expect(toInt(dbRow.NUMERO)).toBe(0);
    expect(formatDateDMY(dbRow.DIA, dbRow.MES, dbRow.ANO)).toBe('');
  });

  test('pagination calculation roundtrip', () => {
    const limit = clampLimit(25, 50, 500);
    const offset = clampOffset(50);
    const page = currentPage(offset, limit);
    const pages = totalPages(250, limit);

    expect(limit).toBe(25);
    expect(offset).toBe(50);
    expect(page).toBe(3); // floor(50/25) + 1
    expect(pages).toBe(10); // ceil(250/25)
  });
});
