'use strict';

const {
  formatGmpLiquidacionDisplay,
  cashToDeposit,
  paymentTypeLabel,
  paperDocumentLabel,
  buildLiquidacionPdfBuffer,
} = require('../services/liquidacion-pdf-service');
const { settleIdleDeposit, roundMoney } = require('../utils/money-cents');

describe('liquidacion-pdf-service', () => {
  test('formats GMP number like the paper liquidacion', () => {
    expect(formatGmpLiquidacionDisplay({
      year: 2026,
      vendorCode: '72',
      serie: 'A',
      numero: 91,
    })).toBe('GMP 2026 A 072 000091');
    expect(formatGmpLiquidacionDisplay({
      year: 2026,
      vendorCode: '57',
      numero: 2082,
    })).toBe('GMP 2026 A 057 002082');
  });

  test('idle day with a one-cent residue deposits nothing', () => {
    expect(roundMoney(8.43) + roundMoney(0.84)).toBeCloseTo(9.27, 2);
    expect(settleIdleDeposit({
      cobrosCount: 0,
      totalEfectivo: 0,
      saldoActual: 0.01,
      totalAIngresar: 0.01,
    })).toEqual({ saldoActual: 0, totalAIngresar: 0 });
    expect(settleIdleDeposit({
      cobrosCount: 0,
      saldoActual: 50,
      totalAIngresar: 50,
    }).totalAIngresar).toBe(50);
    expect(settleIdleDeposit({
      cobrosCount: 1,
      totalEfectivo: 10,
      saldoActual: 0.01,
      totalAIngresar: 10.01,
    }).totalAIngresar).toBe(10.01);
  });

  test('cashToDeposit = efectivo + saldo − gastos ± ajustes; cheques/tarjeta fuera', () => {
    expect(cashToDeposit({
      totalEfectivo: 844.29,
      saldoActual: -1.69,
      gastos: 0,
      ajustes: 0,
    })).toBe(842.6);
    expect(cashToDeposit({
      totalEfectivo: 300,
      saldoActual: 25,
      gastos: 0,
      ajustes: 0,
    })).toBe(325);
    // Cheques/postdatados intentionally ignored even if passed by old callers.
    expect(cashToDeposit({
      totalEfectivo: 100,
      totalCheques: 50,
      totalPostdatados: 20,
      saldoActual: 10,
      gastos: 5,
      ajustes: 0,
    })).toBe(105);
  });

  test('computeClosingBalance arrastra solo efectivo', () => {
    const { computeClosingBalance } = require('../services/liquidacion-pdf-service');
    expect(computeClosingBalance({
      openingBalance: -1.69,
      cashPayments: 844.29,
      expenses: 0,
      adjustments: 0,
      bankDeposits: 840,
    })).toBe(2.6);
  });

  test('payment and document labels match paper', () => {
    expect(paymentTypeLabel('TJ')).toBe('TARJETA');
    expect(paperDocumentLabel({
      tipoDocumento: 'FAC',
      terminalDocumento: 0,
      numeroDocumento: 6290,
    })).toBe('F-0-6290');
    expect(paperDocumentLabel({
      serieDocumento: 'P',
      terminalDocumento: 15,
      numeroDocumento: 2296,
    })).toBe('P-15-2296');
    expect(paymentTypeLabel('TR')).toBe('TALÓN');
    expect(paymentTypeLabel('TRANSFERENCIA')).toBe('TALÓN');
    expect(paymentTypeLabel('TALON')).toBe('TALÓN');
  });

  test('pdf buffer contains GMP title and tesoreria labels', async () => {
    const buffer = await buildLiquidacionPdfBuffer({
      displayNumber: 'GMP 2026 A 057 002082',
      repartidorId: '57',
      repartidorName: 'REPARTIDOR TEST',
      dateLabel: '2026-08-17',
      totals: {
        totalEfectivo: 844.29,
        totalTarjeta: 568.89,
        totalCobrosDia: 1413.18,
        saldoActual: -1.69,
        totalAIngresar: 842.6,
        ingresoBanco: 840,
      },
      cobros: [{
        fecha: '2026-08-17',
        codigoCliente: '4300040696',
        nombreCliente: 'LINARES ROMAN CARLOS ANDRES',
        tipoCobro: 'EFECTIVO',
        tipoDocumento: 'FAC',
        terminalDocumento: 0,
        numeroDocumento: 6290,
        importe: 1413.18,
      }],
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
  });
});
