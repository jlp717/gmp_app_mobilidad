'use strict';

const pdfParse = require('pdf-parse');
const {
  formatDiasFactura,
  devolucionPdfFileName,
  buildReturnPdfPath,
  buildDevolucionPdfPresentation,
  buildDevolucionPdfBuffer,
} = require('../services/comercial-devolucion-pdf-service');

describe('comercial devolucion PDF', () => {
  test('formats FPG days as N D F.Factura and never hardcodes 30', () => {
    expect(formatDiasFactura(30)).toBe('30 D F.Factura');
    expect(formatDiasFactura(60)).toBe('60 D F.Factura');
    expect(formatDiasFactura(0)).toBeNull();
    expect(formatDiasFactura(null)).toBeNull();
    expect(formatDiasFactura(undefined)).toBeNull();
  });

  test('builds TEST pdf path with full query', () => {
    expect(buildReturnPdfPath({
      vendedor: '80',
      fecha: '2026-05-31',
      serie: 'D',
      numero: 4,
    })).toBe('/comercial-liquidacion/devoluciones/pdf?vendedor=80&fecha=2026-05-31&serie=D&numero=4');
  });

  test('presentation covers pizarra boxes: cliente, factura PG, albaran, LIQ.Vd, dias', () => {
    const view = buildDevolucionPdfPresentation({
      cliente: '4300010001',
      factura: 'F-1-1',
      albaran: 'P-2-1',
      documento: 'D-4',
      formaPago: 'P1',
      formaPagoDias: 30,
      date: '2026-05-31',
      vencimiento: '2026-08-31',
      amount: -1000,
      impactoLqd: 'YA_COBRADOS',
      pendienteTecnicoMovimiento: true,
      vendedor: '80',
    });
    expect(view.title).toBe('Documento de Devolucion');
    expect(view.cliente).toBe('4300010001');
    expect(view.factura).toBe('F-1-1');
    expect(view.albaran).toBe('P-2-1');
    expect(view.diasLabel).toBe('30 D F.Factura');
    expect(view.impactoLabel).toBe('LIQ.Vd ya cobrados');
    expect(view.signo).toBe('(-)');
    expect(view.pendienteTecnico).toBe(true);
    expect(devolucionPdfFileName(view)).toBe('DEVOLUCION_D-4_2026-05-31.pdf');
  });

  test('pdf buffer is %PDF and contains pizarra fields', async () => {
    const buffer = await buildDevolucionPdfBuffer({
      cliente: '4300010001',
      factura: 'F-1-1',
      albaranOrigen: 'P-2-1',
      documento: 'D-4',
      serie: 'D',
      numero: 4,
      formaPago: 'P1',
      formaPagoDias: 30,
      date: '2026-05-31',
      vencimiento: '2026-08-31',
      amount: -1000,
      impactoLqd: 'YA_COBRADOS',
      pendienteTecnicoMovimiento: true,
      vendedor: '80',
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const parsed = await pdfParse(buffer);
    const text = parsed.text;
    expect(text).toMatch(/Documento de Devolucion/);
    expect(text).toMatch(/4300010001/);
    expect(text).toMatch(/F-1-1/);
    expect(text).toMatch(/P-2-1/);
    expect(text).toMatch(/30 D F\.Factura/);
    expect(text).toMatch(/LIQ\.Vd ya cobrados/);
    expect(text).toMatch(/Pde\. Tech\. Mov\./);
    expect(text).toMatch(/2026-08-31/);
    expect(text).not.toMatch(/VISTA_DEUDA_BASE/);
  });

  test('uses 60 D F.Factura when FPG days are 60, not 30', async () => {
    const buffer = await buildDevolucionPdfBuffer({
      cliente: 'C1',
      factura: 'F-9-9',
      albaran: 'P-15-2296',
      documento: 'D-1',
      serie: 'D',
      numero: 1,
      formaPagoDias: 60,
      date: '2026-05-31',
      amount: 1000,
    });
    const parsed = await pdfParse(buffer);
    expect(parsed.text).toMatch(/60 D F\.Factura/);
    expect(parsed.text).toMatch(/P-15-2296/);
    expect(parsed.text).not.toMatch(/30 D F\.Factura/);
  });
});
