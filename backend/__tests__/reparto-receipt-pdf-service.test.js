'use strict';

const { buildReceiptPresentation, createRepartoReceiptPdfService } = require('../services/reparto-receipt-pdf-service');

const VALID_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const CORRUPT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQ9wAAAABJRU5ErkJggg==';

function receipt(overrides = {}) {
  return {
    confirmationId: '7',
    documentId: 'ALB-7',
    cliente: { codigo: 'C1', nombre: 'CLIENTE REAL' },
    pedido: { ejercicio: 2026, numero: 77 },
    confirmedAt: '2026-08-10T10:00:00Z',
    status: 'PARCIAL',
    lineas: [{
      lineaId: 'L1', codigoArticulo: 'ART1', descripcion: 'PRODUCTO REAL',
      cantidadPedida: 3, cantidadEntregada: 2, cantidadRechazada: 0,
      cantidadPendiente: 1, precioUnitario: 5, motivoDiferencia: 'FALTANTE',
      observaciones: 'OBSERVACION LINEA',
    }],
    receptor: { nombre: 'ANA', apellidos: 'REAL', dni: '12345678Z' },
    incidencia: { codigo: 'FALTANTE', descripcion: 'Falta producto', observaciones: 'OBSERVACION INCIDENCIA' },
    observaciones: 'OBSERVACION GENERAL',
    firmaEvidenceId: null,
    cobro: null,
    ...overrides,
  };
}

function pageCount(pdf) {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

test('builds a deterministic unpaid presentation from actual quantities and observations', () => {
  const presentation = buildReceiptPresentation(receipt());
  expect(presentation.header).toContain('COMPROBANTE DE REPARTO');
  expect(presentation.lines.join('\n')).toContain('entregada 2.00');
  expect(presentation.lines.join('\n')).toContain('pendiente 1.00');
  expect(presentation.footer).toContain('Total entregado valorado: 10.00');
  expect(presentation.lines.join('\n')).toContain('OBSERVACION LINEA');
  expect(presentation.footer.join('\n')).toContain('OBSERVACION INCIDENCIA');
  expect(presentation.footer).toContain('Cobro: no registrado');
});

test('uses the persisted payment calendar date in the presentation', () => {
  const presentation = buildReceiptPresentation(receipt({
    cobro: { importeCobrado: 10, formaPago: 'EFECTIVO', fecha: { dia: 9, mes: 8, ano: 2026 } },
  }));
  expect(presentation.footer).toContain('Cobro: 10.00 EFECTIVO | fecha 09/08/2026');
});

test('renders a PDF with a valid header without depending on a fragile parser', async () => {
  const result = await createRepartoReceiptPdfService().render({ receipt: receipt() });
  expect(result.fileName).toBe('RECIBO_REPARTO_7.pdf');
  expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-');
});

test('renders a validated PNG signature without an asynchronous decoder crash', async () => {
  const result = await createRepartoReceiptPdfService().render({
    receipt: receipt({ firmaEvidenceId: 'ev_signature' }),
    signature: { mimeType: 'image/png', contentBase64: VALID_PNG },
  });
  expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-');
});

test('keeps the compact signature block on a single page and moves it intact after long rows', async () => {
  const service = createRepartoReceiptPdfService();
  const signature = { mimeType: 'image/png', contentBase64: VALID_PNG };
  const shortPdf = await service.render({
    receipt: receipt({ firmaEvidenceId: 'ev_signature' }),
    signature,
  });
  expect(pageCount(shortPdf.pdf)).toBe(1);

  const longLines = Array.from({ length: 34 }, (_, index) => ({
    lineaId: `L${index + 1}`,
    codigoArticulo: `ART${index + 1}`,
    descripcion: `PRODUCTO CONFIRMADO ${index + 1} CON DESCRIPCION LARGA`,
    cantidadPedida: 3,
    cantidadEntregada: 2,
    cantidadRechazada: 0,
    cantidadPendiente: 1,
    precioUnitario: 5,
    motivoDiferencia: 'FALTANTE',
    observaciones: 'OBSERVACION DE LINEA PARA PROBAR PAGINACION',
  }));
  const longPdf = await service.render({
    receipt: receipt({ lineas: longLines, firmaEvidenceId: 'ev_signature' }),
    signature,
  });
  expect(pageCount(longPdf.pdf)).toBeGreaterThan(1);
  expect(longPdf.pdf.subarray(0, 5).toString()).toBe('%PDF-');
});

test('renders the explicit persisted 0 EUR prepaid invariant without ERP lines', () => {
  const presentation = buildReceiptPresentation(receipt({
    status: 'ENTREGADO', lineas: [], cobro: null,
    prepaidZeroWithoutLines: true, importeTotal: 0,
  }));
  expect(presentation.lines).toContain('Sin lineas ERP (prepago 0 EUR)');
  expect(presentation.footer).toContain('Total entregado valorado: 0.00');
});

test.each([
  { prepaidZeroWithoutLines: false, importeTotal: 0, status: 'ENTREGADO', cobro: null },
  { prepaidZeroWithoutLines: true, importeTotal: 1, status: 'ENTREGADO', cobro: null },
  { prepaidZeroWithoutLines: true, importeTotal: 0, status: 'PARCIAL', cobro: null },
  { prepaidZeroWithoutLines: true, importeTotal: 0, status: 'ENTREGADO', cobro: { importeCobrado: 1 } },
])('fails closed for empty ERP lines without the exact prepaid invariant', (invariant) => {
  expect(() => buildReceiptPresentation(receipt({ lineas: [], ...invariant })))
    .toThrow(expect.objectContaining({
      code: 'REPARTO_RECEIPT_LINES_UNAVAILABLE', statusCode: 503,
    }));
});

test('fails closed for an invalid signature payload and an aborted render', async () => {
  await expect(createRepartoReceiptPdfService().render({
    receipt: receipt({ firmaEvidenceId: 'ev_signature' }),
    signature: { mimeType: 'text/plain', contentBase64: 'bm90LWltYWdl' },
  })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', statusCode: 503 });

  await expect(createRepartoReceiptPdfService().render({
    receipt: receipt({ firmaEvidenceId: 'ev_signature' }),
    signature: { mimeType: 'image/png', contentBase64: CORRUPT_PNG },
  })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', statusCode: 503 });

  const controller = new AbortController();
  controller.abort();
  await expect(createRepartoReceiptPdfService().render({
    receipt: receipt(), signal: controller.signal,
  })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_TIMEOUT', statusCode: 504 });
});
