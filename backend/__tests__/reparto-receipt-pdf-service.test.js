'use strict';

const fs = require('fs');
const { buildReceiptPresentation, createRepartoReceiptPdfService } = require('../services/reparto-receipt-pdf-service');
const { HEADER_PNG_PATH, drawCompanyHeader, getHeaderAsset } = require('../services/company-header');

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
function pdfText(pdf) {
  const raw = pdf.toString('latin1');
  return [...raw.matchAll(/<([0-9a-f]+)>/gi)]
    .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
    .join('')
    .replace(/\x80/g, '€');
}

function occurrences(text, value) {
  return text.split(value).length - 1;
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

test('embeds the real proportional corporate logo in the canonical delivery note', async () => {
  const asset = getHeaderAsset();
  expect(fs.existsSync(HEADER_PNG_PATH)).toBe(true);
  expect(asset.buffer.length).toBeGreaterThan(0);
  expect(asset.dimensions).toEqual({ width: 1542, height: 437 });
  const calls = [];
  const bottom = drawCompanyHeader({
    page: { width: 595.28, margins: { left: 36, right: 36 } },
    image: (path, x, y, options) => calls.push({ path, x, y, options }),
  }, { yStart: 36 });
  expect(calls[0]).toMatchObject({ path: HEADER_PNG_PATH, y: 36 });
  expect(bottom).toBeGreaterThan(36);

  const result = await createRepartoReceiptPdfService().render({ receipt: receipt() });
  expect(result.pdf.toString('latin1')).toContain('/Subtype /Image');
});

test('exposes the delivery-note identity and planned-versus-delivered table model', async () => {
  const presentation = buildReceiptPresentation(receipt());
  expect(presentation.title).toBe('NOTA DE ENTREGA');
  expect(presentation.confirmationReference).toBe('7');
  expect(presentation.documentReference).toBe('ALB-7');
  expect(presentation.rows[0]).toMatchObject({ ordered: 3, delivered: 2, difference: -1, packages: null, amount: 10 });

  const result = await createRepartoReceiptPdfService().render({ receipt: receipt() });
  const text = pdfText(result.pdf);
  expect(text).toContain('NOTA DE ENTREGA');
  expect(text).toContain('Confirmación 7');
  expect(text).toContain('Documento ALB-7');
  for (const heading of ['Producto', 'Pedida', 'Entregada', 'Diferencia', 'Bultos', 'Importe']) expect(text).toContain(heading);
  expect(text).toContain('-1.00');
});

test.each([
  { label: 'un tipo', taxes: [{ base: 10, pct: 10, iva: 1 }], expectedRows: [{ base: 10, pct: 10, iva: 1 }], expectedTotal: 11, expectedPdf: ['Base IVA 10.00 %', '1.00 €'] },
  { label: 'varios tipos', taxes: [{ base: 5, pct: 21, iva: 1.05 }, { base: 2, pct: 4, iva: 0.08 }, { base: 3, pct: 4, iva: 0.12 }], expectedRows: [{ base: 5, pct: 4, iva: 0.2 }, { base: 5, pct: 21, iva: 1.05 }], expectedTotal: 11.25, expectedPdf: ['Base IVA 4.00 %', 'Base IVA 21.00 %', '1.05 €'] },
  { label: 'ningún tipo', taxes: [], expectedRows: [], expectedTotal: 10, expectedPdf: ['IVA no disponible'] },
])('renders a dynamic IVA summary with $label', async ({ taxes, expectedRows, expectedTotal, expectedPdf }) => {
  const fiscalReceipt = receipt({ ivaBreakdown: taxes });
  const presentation = buildReceiptPresentation(fiscalReceipt);
  expect(presentation.ivaBreakdown).toEqual(expectedRows);
  expect(presentation.totalConIva).toBeCloseTo(expectedTotal, 6);
  expect(presentation.fiscalAvailable).toBe(taxes.length > 0);
  const result = await createRepartoReceiptPdfService().render({ receipt: fiscalReceipt });
  const text = pdfText(result.pdf);
  for (const expected of expectedPdf) expect(text).toContain(expected);
});

test('renders the business details in the printable delivery note', async () => {
  const result = await createRepartoReceiptPdfService().render({ receipt: receipt() });
  const text = pdfText(result.pdf);
  expect(text).toContain('PRODUCTO REAL');
  expect(text).toContain('Pedida: 3.00');
  expect(text).toContain('Pendiente: 1.00');
  expect(text).toContain('OBSERVACION LINEA');
  expect(text).toContain('Falta producto');
  expect(text).toContain('OBSERVACION INCIDENCIA');
  expect(text).toContain('OBSERVACION GENERAL');
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

test('repeats headers and fixed page numbers while preserving long content above the footer', async () => {
  const lineas = Array.from({ length: 46 }, (_, index) => ({
    lineaId: `L${index + 1}`, codigoArticulo: `ART${index + 1}`,
    descripcion: index === 0 ? `PRODUCTO EXTENSO ${'DESCRIPCION CONTROLADA '.repeat(120)}` : `PRODUCTO PAGINADO ${index + 1}`,
    cantidadPedida: 3, cantidadEntregada: 2, cantidadRechazada: 0, cantidadPendiente: 1,
    precioUnitario: 5, motivoDiferencia: 'FALTANTE', observaciones: `OBSERVACION PAGINADA ${index + 1}`,
  }));
  lineas[lineas.length - 1].descripcion = 'ULTIMO PRODUCTO VISIBLE';
  const result = await createRepartoReceiptPdfService().render({
    receipt: receipt({
      lineas,
      firmaEvidenceId: 'ev_signature',
      observaciones: `OBSERVACION FINAL ${'CONTENIDO CONTROLADO '.repeat(180)}`,
      incidencia: { codigo: 'FALTANTE', descripcion: 'Falta producto', observaciones: `INCIDENCIA EXTENSA ${'DETALLE '.repeat(160)}` },
      ivaBreakdown: [{ base: 230, pct: 4, iva: 9.2 }, { base: 230, pct: 10, iva: 23 }],
    }),
    signature: { mimeType: 'image/png', contentBase64: VALID_PNG },
  });
  const pages = pageCount(result.pdf);
  const text = pdfText(result.pdf);
  expect(pages).toBeGreaterThan(2);
  expect(occurrences(text, 'NOTA DE ENTREGA')).toBe(pages);
  expect(occurrences(text, 'Producto')).toBe(pages);
  for (let page = 1; page <= pages; page += 1) expect(text).toContain(`Página ${page} de ${pages}`);
  expect(text).toContain('ULTIMO PRODUCTO VISIBLE');
  expect(text).toContain('TOTAL ENTREGA');
  expect(text).toContain('Firma del cliente');
  expect(text).toContain('Receptor: ANA REAL');
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
