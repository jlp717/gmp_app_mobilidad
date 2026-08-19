const fs = require('fs');
const path = require('path');

const pdfParse = require('pdf-parse');

const cleanPdfService = require('../services/pdf.service');
const documentPdfService = require('../app/services/pdfService');
const deliveryReceiptService = require('../app/services/deliveryReceiptService');

async function parsePages(buffer) {
  const data = await pdfParse(buffer, {
    pagerender: pageData => pageData.getTextContent().then(textContent => (
      textContent.items.map(item => item.str).join(' ') + '\n__PAGE__\n'
    ))
  });

  return data.text
    .split('__PAGE__')
    .map(page => page.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function expectTotalBeforeFooter(pages, totalLabel) {
  const totalPage = pages.find(page => page.includes(totalLabel));

  expect(totalPage).toBeTruthy();
  expect(totalPage).toContain('417,80');

  const labelIndex = totalPage.indexOf(totalLabel);
  const amountIndex = totalPage.lastIndexOf('417,80');
  const footerIndex = totalPage.indexOf('Inscrita en el registro mercantil');

  expect(labelIndex).toBeGreaterThanOrEqual(0);
  expect(amountIndex).toBeGreaterThan(labelIndex);
  expect(footerIndex).toBeGreaterThan(amountIndex);
}

function expectReceiptTotalBeforeTerms(pages) {
  const receiptText = pages.join(' ');
  const itemIndex = receiptText.indexOf('ART119');
  const totalIndex = receiptText.indexOf('TOTAL:');
  const amountIndex = receiptText.lastIndexOf('145,20');
  const termsIndex = receiptText.indexOf('No se admiten devoluciones');

  expect(pages).toHaveLength(1);
  expect(itemIndex).toBeGreaterThanOrEqual(0);
  expect(totalIndex).toBeGreaterThan(itemIndex);
  expect(amountIndex).toBeGreaterThan(totalIndex);
  expect(termsIndex).toBeGreaterThan(amountIndex);
}

function buildCleanInvoice(lineCount) {
  return {
    header: {
      serie: 'F',
      numero: 6112,
      ejercicio: 2026,
      fecha: '31/05/2026',
      clienteId: '4300008591',
      clienteNombre: 'ALIMENTACION SUPER MAJA, SL',
      clienteDireccion: 'CL NUEVA, 10',
      clientePoblacion: '18830 HUESCAR',
      clienteNif: 'B19711829',
      bases: [{ base: 379.82, pct: 10, iva: 37.98 }],
      total: 417.80
    },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      codigo: String(3000 + index),
      descripcion: `PK EXTREME LEMON CHEESECAKE 6X110ML ${index}`,
      cantidad: -6,
      precio: 5.379,
      descuento: 0,
      importe: -32.27
    }))
  };
}

function buildDocumentInvoice(lineCount) {
  return {
    documentType: 'factura',
    header: {
      SERIEFACTURA: 'F',
      NUMEROFACTURA: 6112,
      EJERCICIOFACTURA: 2026,
      DIAFACTURA: 31,
      MESFACTURA: 5,
      ANOFACTURA: 2026,
      CODIGOCLIENTEFACTURA: '4300008591',
      NOMBRECLIENTEFACTURA: 'ALIMENTACION SUPER MAJA, SL',
      DIRECCIONCLIENTEFACTURA: 'CL NUEVA, 10',
      POBLACIONCLIENTEFACTURA: 'HUESCAR',
      PROVINCIACLIENTEFACTURA: 'ALMERIA',
      CIFCLIENTEFACTURA: 'B19711829',
      IVA_BREAKDOWN: {
        BI1: 379.82,
        IVA1_PCT: 10,
        IVA1_IMP: 37.98
      }
    },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      CODIGOARTICULO: String(3000 + index),
      DESCRIPCIONARTICULO: `PK EXTREME LEMON CHEESECAKE 6X110ML ${index}`,
      CANTIDADUNIDADES: -6,
      PRECIOVENTA: 5.379,
      PORCENTAJEDESCUENTO: 0,
      CODIGOIVA: '1',
      IMPORTENETOARTICULO: -32.27
    }))
  };
}

function buildSignedAlbaran(lineCount) {
  return {
    documentType: 'albaran',
    header: {
      SERIEALBARAN: 'A', NUMEROALBARAN: 91, EJERCICIOALBARAN: 2026,
      DIAFACTURA: 31, MESFACTURA: 5, ANOFACTURA: 2026,
      CODIGOCLIENTEFACTURA: '4300008591',
      NOMBRECLIENTEFACTURA: 'ALIMENTACION SUPER MAJA, SL',
      DIRECCIONCLIENTEFACTURA: 'CL NUEVA, 10', POBLACIONCLIENTEFACTURA: 'HUESCAR',
      PROVINCIACLIENTEFACTURA: 'ALMERIA', CIFCLIENTEFACTURA: 'B19711829',
      IVA_BREAKDOWN: { BI1: 10, IVA1_PCT: 10, IVA1_IMP: 1 }
    },
    receptorNombre: 'Ana', receptorApellidos: 'Lopez', receptorDni: '12345678Z',
    signatureBase64: fs.readFileSync(path.join(__dirname, '..', 'assets', 'header.png')).toString('base64'),
    lines: Array.from({ length: lineCount }, (_, index) => ({
      CODIGOARTICULO: `ART${index + 1}`,
      DESCRIPCIONARTICULO: `Producto de prueba para albaran ${index + 1}`,
      CAJASARTICULO: 1, IMPORTENETOARTICULO: 1
    }))
  };
}

function buildLongDeliveryReceipt(lineCount) {
  return {
    albaranNum: 'A-9999',
    clientCode: '4300008591',
    clientName: 'ALIMENTACION SUPER MAJA, SL',
    fecha: '31/05/2026',
    formaPago: 'CONTADO',
    repartidor: '02 REPARTIDOR',
    items: Array.from({ length: lineCount }, (_, index) => ({
      codigoArticulo: `ART${String(index).padStart(3, '0')}`,
      descripcion: `Producto largo para ticket ${index}`,
      bultos: 1,
      cantidad: 1,
      precio: 1.10,
      importe: 1.10
    }))
  };
}

describe('invoice PDF total/footer layout', () => {
  test('keeps clean invoice final amount with total label before footer', async () => {
    const buffer = await cleanPdfService.generateInvoicePDF(buildCleanInvoice(17));
    const pages = await parsePages(buffer);

    expectTotalBeforeFooter(pages, 'TOTAL FACTURA');
  });

  test('keeps document invoice final amount with total label before footer', async () => {
    const buffer = await documentPdfService.generateInvoicePDF(buildDocumentInvoice(17));
    const pages = await parsePages(buffer);

    expectTotalBeforeFooter(pages, 'TOTAL CON IVA');
  });

  test('prints receptor name and DNI next to the signature', async () => {
    const buffer = await documentPdfService.generateInvoicePDF({
      ...buildDocumentInvoice(2),
      receptorNombre: 'Ana',
      receptorApellidos: 'Lopez',
      receptorDni: '12345678Z',
    });
    const pages = await parsePages(buffer);
    const text = pages.join(' ');
    expect(text).toContain('Receptor');
    expect(text).toContain('Ana');
    expect(text).toContain('Lopez');
    expect(text).toContain('12345678Z');
  });

  test('keeps a short signed albaran on one A4 page with the closing block before the footer', async () => {
    const pages = await parsePages(await documentPdfService.generateInvoicePDF(buildSignedAlbaran(2)));
    const page = pages[0];

    expect(pages).toHaveLength(1);
    expect(page).toContain('ALBARÁN');
    expect(page.indexOf('TOTAL CON IVA')).toBeGreaterThan(page.indexOf('Producto de prueba'));
    expect(page.indexOf('Receptor')).toBeGreaterThan(page.indexOf('TOTAL CON IVA'));
    expect(page.indexOf('12345678Z')).toBeGreaterThan(page.indexOf('Receptor'));
    expect(page.indexOf('Inscrita en el registro mercantil')).toBeGreaterThan(page.indexOf('12345678Z'));
  });

  test('puts the signed albaran closing block only on the final page when rows paginate', async () => {
    const pages = await parsePages(await documentPdfService.generateInvoicePDF(buildSignedAlbaran(70)));
    const finalPage = pages.at(-1);

    expect(pages.length).toBeGreaterThan(1);
    expect(finalPage).toContain('TOTAL CON IVA');
    expect(finalPage).toContain('Receptor');
    expect(finalPage).toContain('12345678Z');
    expect(finalPage.indexOf('TOTAL CON IVA')).toBeLessThan(finalPage.indexOf('Receptor'));
    expect(pages.slice(0, -1).join(' ')).not.toContain('Receptor');
  });

  test('keeps long delivery receipt content and total before closing terms', async () => {
    const buffer = await deliveryReceiptService.generateDeliveryReceipt(buildLongDeliveryReceipt(120));
    const pages = await parsePages(buffer);

    expectReceiptTotalBeforeTerms(pages);
  });
});
