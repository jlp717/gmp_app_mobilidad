'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const pdfService = require('../services/comercial-liquidacion-pdf.service');

const REFERENCE = {
  vendorCode: '72',
  date: '2026-06-27',
  liquidacionNumero: 91,
  efectivo: 844.29,
  tarjeta: 568.89,
  totalCobros: 1413.18,
  saldo: -1.69,
  totalAIngresar: 842.6,
  ingresoBanco: 840,
  delta: 2.6,
  email: 'josemiguel.acacio@mari-pepa.com',
};

describe('Comercial liquidacion PDF service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('buildLiquidacionPdfBuffer returns a PDF buffer for reference liquidation 91', async () => {
    const buffer = await pdfService.buildLiquidacionPdfBuffer({
      vendor: {
        code: REFERENCE.vendorCode,
        name: 'Jose Miguel',
        email: REFERENCE.email,
      },
      summary: {
        date: REFERENCE.date,
        liquidacionNumero: REFERENCE.liquidacionNumero,
        totalEfectivo: REFERENCE.efectivo,
        totalTarjeta: REFERENCE.tarjeta,
        totalCobrosDia: REFERENCE.totalCobros,
        saldoActual: REFERENCE.saldo,
        totalAIngresar: REFERENCE.totalAIngresar,
        ingresoBanco: REFERENCE.ingresoBanco,
        delta: REFERENCE.delta,
      },
      liquidacion: {
        idempotencyToken: 'liq-comercial-20260627-72',
        ingresoBanco: REFERENCE.ingresoBanco,
        entregado: 0,
      },
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(10);
    expect(buffer.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  test('buildLiquidacionPdfBuffer includes aggregate tarjeta only (no card line items)', async () => {
    const buffer = await pdfService.buildLiquidacionPdfBuffer({
      vendor: { code: '72', name: 'Jose Miguel', email: REFERENCE.email },
      summary: {
        date: REFERENCE.date,
        totalTarjeta: REFERENCE.tarjeta,
        totalCobrosDia: REFERENCE.totalCobros,
        totalAIngresar: REFERENCE.totalAIngresar,
      },
      liquidacion: { ingresoBanco: 840, entregado: 0 },
      cardPayments: [
        { maskedPan: '****1111', amount: 300 },
        { maskedPan: '****2222', amount: 268.89 },
      ],
    });

    const raw = buffer.toString('latin1');
    expect(buffer.slice(0, 5).toString('utf8')).toBe('%PDF-');
    expect(raw).not.toMatch(/\*\*\*\*1111/);
    expect(raw).not.toMatch(/\*\*\*\*2222/);
    expect(pdfService.formatMoneyPdf(REFERENCE.tarjeta)).toMatch(/568[,.]89/);
  });

  test('buildLiquidacionPdfBuffer includes reference efectivo and totalAIngresar', async () => {
    const buffer = await pdfService.buildLiquidacionPdfBuffer({
      vendor: { code: '72', name: 'Jose Miguel', email: REFERENCE.email },
      summary: {
        date: REFERENCE.date,
        liquidacionNumero: REFERENCE.liquidacionNumero,
        totalEfectivo: REFERENCE.efectivo,
        totalTarjeta: REFERENCE.tarjeta,
        totalCobrosDia: REFERENCE.totalCobros,
        saldoActual: REFERENCE.saldo,
        totalAIngresar: REFERENCE.totalAIngresar,
        ingresoBanco: REFERENCE.ingresoBanco,
      },
      liquidacion: { ingresoBanco: REFERENCE.ingresoBanco, entregado: 0 },
    });

    expect(buffer.slice(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(100);
    expect(pdfService.formatMoneyPdf(REFERENCE.efectivo)).toMatch(/844[,.]29/);
    expect(pdfService.formatMoneyPdf(REFERENCE.totalCobros)).toMatch(/1413[,.]18/);
    expect(pdfService.formatMoneyPdf(REFERENCE.totalAIngresar)).toMatch(/842[,.]6/);
  });

  test('buildLiquidacionEmailPayload targets comercial mailbox from auth profile', () => {
    const payload = pdfService.buildLiquidacionEmailPayload({
      vendor: { code: '72', name: 'Jose Miguel', email: REFERENCE.email },
      summary: { date: REFERENCE.date, totalAIngresar: REFERENCE.totalAIngresar },
      pdfFilename: 'Liquidacion_72_2026-06-27.pdf',
    });

    expect(payload.to).toBe(REFERENCE.email);
    expect(payload.subject).toMatch(/liquidaci[oó]n/i);
    expect(payload.subject).toMatch(/2026-06-27/);
    expect(payload.pdfFilename).toBe('Liquidacion_72_2026-06-27.pdf');
  });

  test('buildLiquidacionPdfBuffer tolerates negative saldo in summary aggregate', async () => {
    const extractText = pdfService.extractPdfTextForTests;
    const buffer = await pdfService.buildLiquidacionPdfBuffer({
      vendor: { code: '72', name: 'Jose Miguel', email: REFERENCE.email },
      summary: {
        date: REFERENCE.date,
        totalEfectivo: REFERENCE.efectivo,
        totalTarjeta: REFERENCE.tarjeta,
        totalCobrosDia: REFERENCE.totalCobros,
        saldoActual: REFERENCE.saldo,
        totalAIngresar: REFERENCE.totalAIngresar,
      },
      liquidacion: { ingresoBanco: REFERENCE.ingresoBanco, entregado: 0 },
    });

    const text = await extractText(buffer);
    expect(text).toMatch(/%PDF/);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
