'use strict';

const {
  assertTalonPayment,
  isTalonPaymentMethod,
  normalizeBankCode,
  parseTalonDueDate,
  clearBankCatalogCache,
} = require('../services/reparto-bank-catalog');

describe('reparto-bank-catalog', () => {
  afterEach(() => {
    clearBankCatalogCache();
  });

  test('normalizes 4-digit ENB codes', () => {
    expect(normalizeBankCode('49')).toBe('0049');
    expect(normalizeBankCode('2100')).toBe('2100');
  });

  test('parses ISO and slash due dates', () => {
    expect(parseTalonDueDate('2026-10-15')).toEqual({ year: 2026, month: 10, day: 15 });
    expect(parseTalonDueDate('15/10/2026')).toEqual({ year: 2026, month: 10, day: 15 });
  });

  test('TALON is a talon payment method', () => {
    expect(isTalonPaymentMethod('TALON')).toBe(true);
    expect(isTalonPaymentMethod('TRANSFERENCIA')).toBe(true);
    expect(isTalonPaymentMethod('TR')).toBe(true);
    expect(isTalonPaymentMethod('EFECTIVO')).toBe(false);
  });

  test('assertTalonPayment validates bank against ENB', async () => {
    const query = jest.fn(async (sql) => {
      if (String(sql).includes('SYSTABLES')) {
        return [{ TABLE_NAME: 'ENB' }];
      }
      if (String(sql).includes('SYSCOLUMNS')) {
        return [
          { COLUMN_NAME: 'CODIGOENTIDADBANCARIA' },
          { COLUMN_NAME: 'DESCRICIONENTIDADBANCARIA' },
        ];
      }
      return [{ CODIGO: '0049', NOMBRE: 'BANCO SANTANDER' }];
    });

    const talon = await assertTalonPayment({
      formaPago: 'TALON',
      numeroTalon: '123456',
      fechaVencimientoTalon: '2026-12-01',
      codigoEntidadBancaria: '0049',
      nombreBanco: 'SANTANDER',
    }, { query });

    expect(talon.numeroTalon).toBe('123456');
    expect(talon.codigoEntidadBancaria).toBe('0049');
    expect(talon.nombreBanco).toMatch(/SANTANDER/i);
  });

  test('assertTalonPayment rejects unknown bank', async () => {
    const query = jest.fn(async (sql) => {
      if (String(sql).includes('SYSTABLES')) return [{ TABLE_NAME: 'ENB' }];
      if (String(sql).includes('SYSCOLUMNS')) {
        return [
          { COLUMN_NAME: 'CODIGOENTIDADBANCARIA' },
          { COLUMN_NAME: 'DESCRICIONENTIDADBANCARIA' },
        ];
      }
      return [];
    });

    await expect(assertTalonPayment({
      formaPago: 'TALON',
      numeroTalon: '99',
      fechaVencimientoTalon: '2026-12-01',
      codigoEntidadBancaria: '9999',
      nombreBanco: 'BANCO FANTASMA',
    }, { query })).rejects.toMatchObject({ code: 'BANK_NOT_FOUND', statusCode: 422 });
  });

  test('assertTalonPayment rejects missing numero', async () => {
    await expect(assertTalonPayment({
      formaPago: 'TALON',
      fechaVencimientoTalon: '2026-12-01',
      nombreBanco: 'SANTANDER',
    })).rejects.toMatchObject({ code: 'TALON_FIELDS_REQUIRED', statusCode: 422 });
  });

  test('assertTalonPayment rejects missing vencimiento', async () => {
    await expect(assertTalonPayment({
      formaPago: 'TALON',
      numeroTalon: '123456',
      nombreBanco: 'SANTANDER',
    })).rejects.toMatchObject({ code: 'TALON_FIELDS_REQUIRED', statusCode: 422 });
  });

  test('assertTalonPayment rejects missing banco', async () => {
    const query = jest.fn(async (sql) => {
      if (String(sql).includes('SYSTABLES')) return [{ TABLE_NAME: 'ENB' }];
      if (String(sql).includes('SYSCOLUMNS')) {
        return [
          { COLUMN_NAME: 'CODIGOENTIDADBANCARIA' },
          { COLUMN_NAME: 'DESCRICIONENTIDADBANCARIA' },
        ];
      }
      return [];
    });
    await expect(assertTalonPayment({
      formaPago: 'TALON',
      numeroTalon: '123456',
      fechaVencimientoTalon: '2026-12-01',
    }, { query })).rejects.toMatchObject({ statusCode: 422 });
  });
});
