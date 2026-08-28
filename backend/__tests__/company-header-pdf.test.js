'use strict';

const fs = require('fs');
const PDFDocument = require('pdfkit');
const { HEADER_PNG_PATH, getHeaderAsset, drawCompanyHeader } = require('../services/company-header');
const { generateInvoicePDF: cleanInvoice } = require('../services/pdf.service');
const { generateInvoicePDF: documentInvoice } = require('../app/services/pdfService');
const { buildLiquidacionPdfBuffer } = require('../services/liquidacion-pdf-service');
const { buildCobroPdfBuffer } = require('../services/reparto-cobro-pdf-service');
const { createRepartoReceiptPdfService } = require('../services/reparto-receipt-pdf-service');

const cases = [
  ['factura', (count) => cleanInvoice({
    header: { serie: 'F', numero: 1, total: 11, bases: [{ base: 10, pct: 10, iva: 1 }] },
    lines: Array.from({ length: count }, () => ({
      codigo: 'ART1', descripcion: 'Producto', cantidad: 1, precio: 10, importe: 10,
    })),
  })],
  ['albaran', (count) => documentInvoice({
    documentType: 'albaran',
    header: { SERIEALBARAN: 'A', NUMEROALBARAN: 1, IVA_BREAKDOWN: { BI1: 10, IVA1_PCT: 10, IVA1_IMP: 1 } },
    lines: Array.from({ length: count }, () => ({
      CODIGOARTICULO: 'ART1', DESCRIPCIONARTICULO: 'Producto', CAJASARTICULO: 1, IMPORTENETOARTICULO: 10,
    })),
  })],
  ['liquidacion', (count) => buildLiquidacionPdfBuffer({
    displayNumber: 'GMP 2026 A 072 000091',
    totals: { totalEfectivo: 11 },
    cobros: Array.from({ length: count }, () => ({
      codigoCliente: 'C1', nombreCliente: 'Cliente', tipoCobro: 'EFECTIVO', importe: 11,
    })),
  })],
  ['nota de entrega', async (count) => (await createRepartoReceiptPdfService().render({
    receipt: {
      confirmationId: '1', documentId: 'ALB-1', status: 'ENTREGADO',
      lineas: Array.from({ length: count }, () => ({
        lineaId: 'L1', codigoArticulo: 'ART1', descripcion: 'Producto',
        cantidadPedida: 1, cantidadEntregada: 1, cantidadRechazada: 0,
        cantidadPendiente: 0, precioUnitario: 10,
      })),
    },
  })).pdf],
  ['justificante de cobro', () => buildCobroPdfBuffer({
    cobroId: '1', importe: 11, pendiente: 0, notas: 'Pago confirmado',
  })],
];

afterEach(() => jest.restoreAllMocks());

test.each(cases)('%s embeds only the real proportional PNG above the content', async (_name, render) => {
  const drawImage = PDFDocument.prototype.image;
  const drawText = PDFDocument.prototype.text;
  const images = [];
  const textPositions = [];
  jest.spyOn(PDFDocument.prototype, 'image').mockImplementation(function (source, x, y, options) {
    images.push({ source, x, y, options, page: this.page });
    return drawImage.call(this, source, x, y, options);
  });
  jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (...args) {
    textPositions.push({ text: String(args[0]), y: typeof args[2] === 'number' ? args[2] : this.y });
    return drawText.apply(this, args);
  });

  const pdf = await render(1);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
  expect(images).toHaveLength(1);
  const [header] = images;
  const { dimensions } = getHeaderAsset();
  expect(header.source).toBe(HEADER_PNG_PATH);
  expect(header.y).toBe(10);
  expect(header.options.height / header.options.width).toBeCloseTo(dimensions.height / dimensions.width, 8);
  expect(header.x + header.options.width / 2).toBeCloseTo(header.page.width / 2, 8);
  expect(Math.min(...textPositions.map((item) => item.y))).toBeGreaterThanOrEqual(header.y + header.options.height);
  expect(textPositions.map((item) => item.text).join(' ')).not.toMatch(/GRANJA MARI PEPA S\.L\.|Granja Mari Pepa · GMP Mobilidad|Food & Frozen/);
});

test.each(cases.slice(0, 4))('%s draws the same PNG exactly once on every continuation page', async (_name, render) => {
  const drawImage = PDFDocument.prototype.image;
  const pages = [];
  jest.spyOn(PDFDocument.prototype, 'image').mockImplementation(function (source, ...args) {
    expect(source).toBe(HEADER_PNG_PATH);
    pages.push(this.page);
    return drawImage.call(this, source, ...args);
  });
  const pdf = await render(60);
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  expect(pageCount).toBeGreaterThan(1);
  expect(pages).toHaveLength(pageCount);
  expect(new Set(pages).size).toBe(pageCount);
});

test('justificante de cobro repeats the PNG header on controlled continuation pages', async () => {
  const drawImage = PDFDocument.prototype.image;
  const pages = [];
  jest.spyOn(PDFDocument.prototype, 'image').mockImplementation(function (source, ...args) {
    expect(source).toBe(HEADER_PNG_PATH);
    pages.push(this.page);
    return drawImage.call(this, source, ...args);
  });

  const pdf = await buildCobroPdfBuffer({
    cobroId: '1',
    importe: 11,
    pendiente: 0,
    notas: Array(12).fill('observacion extensa').join('\n'),
  });
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  expect(pageCount).toBeGreaterThan(1);
  expect(pages).toHaveLength(pageCount);
  expect(new Set(pages).size).toBe(pageCount);
});

test('missing corporate PNG fails closed instead of drawing a placeholder', () => {
  const exists = fs.existsSync;
  jest.spyOn(fs, 'existsSync').mockImplementation((file) => file === HEADER_PNG_PATH ? false : exists(file));
  const doc = { page: { width: 595.28, margins: { left: 36, right: 36 } }, image: jest.fn() };
  expect(() => drawCompanyHeader(doc)).toThrow(expect.objectContaining({ code: 'COMPANY_HEADER_ASSET_UNAVAILABLE' }));
  expect(doc.image).not.toHaveBeenCalled();
});
