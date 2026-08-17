'use strict';

const {
  formatGmpLiquidacionDisplay,
  cashToDeposit,
  paymentTypeLabel,
  paperDocumentLabel,
  buildLiquidacionPdfBuffer,
} = require('../services/liquidacion-pdf-service');

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

  test('cashToDeposit excludes tarjeta', () => {
    expect(cashToDeposit({
      totalEfectivo: 844.29,
      totalCheques: 0,
      totalPostdatados: 0,
      saldoActual: -1.69,
      gastos: 0,
      ajustes: 0,
    })).toBe(842.6);
    expect(cashToDeposit({
      totalEfectivo: 300,
      totalCheques: 0,
      totalPostdatados: 0,
      saldoActual: 25,
      gastos: 0,
      ajustes: 0,
    })).toBe(325);
  });

  test('payment and document labels match paper', () => {
    expect(paymentTypeLabel('TJ')).toBe('TARJETA');
    expect(paperDocumentLabel({
      tipoDocumento: 'FAC',
      terminalDocumento: 0,
      numeroDocumento: 6290,
    })).toBe('F 000 006290');
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
