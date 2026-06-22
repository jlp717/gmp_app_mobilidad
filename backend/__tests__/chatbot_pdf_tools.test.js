'use strict';

const { invoiceTools, genericAnalyticsTools } = require('../src/chatbot/chatbot_tools');

jest.mock('../services/facturas.service', () => ({
  getFacturaDetail: jest.fn(async () => ({
    header: { serie: 'F', numero: 100, ejercicio: 2026, total: 250.75, clienteNombre: 'Test' },
    lines: [{ descripcion: 'Huevos', cantidad: 2, precio: 10, importe: 20 }],
  })),
}));

jest.mock('../services/pdf.service', () => ({
  generateInvoicePDF: jest.fn(async () => Buffer.from('%PDF-1.4 mock')),
}));

jest.mock('../services/emailPdfService', () => ({
  getCachedPdf: jest.fn(() => null),
  cachePdf: jest.fn(),
}));

jest.mock('pdf-parse', () => jest.fn(async () => ({
  text: 'Factura F/100/2026 Cliente CLI-1 Total 250,75 EUR',
  numpages: 1,
})));

describe('chatbot PDF tools', () => {
  test('getInvoicePdfInfo returns pdf path when CFC header exists', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CFC')) {
          return [{
            SERIE: 'F',
            NUMERO: 100,
            EJERCICIO: 2026,
            CLIENTE: 'CLI-1',
            IMPORTE: 250.75,
            DIA: 19,
            MES: 6,
            ANO: 2026,
          }];
        }
        return [];
      }),
    };

    const result = await invoiceTools.getInvoicePdfInfo(conn, 'F/100/2026');

    expect(result.error).toBeUndefined();
    expect(result.pdfPath).toBe('/api/facturas/F/100/2026/pdf');
    expect(result.amount).toBe(250.75);
    expect(result.clientCode).toBe('CLI-1');
  });

  test('getAlbaranPdfInfo returns pdf path when CAC header exists', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CAC')) {
          return [{
            EJERCICIO: 2026,
            SERIE: 'A',
            TERMINAL: 1,
            NUMERO: 555,
            CLIENTE: 'CLI-2',
            IMPORTE: 88.5,
            ANO: 2026,
            MES: 6,
            DIA: 19,
          }];
        }
        return [];
      }),
    };

    const result = await invoiceTools.getAlbaranPdfInfo(conn, '2026/A/1/555');

    expect(result.error).toBeUndefined();
    expect(result.pdfPath).toBe('/api/repartidor/document/albaran/2026/A/1/555/pdf');
    expect(result.clientCode).toBe('CLI-2');
  });

  test('resolveAlbaranClientCode returns client from CAC', async () => {
    const conn = {
      query: jest.fn(async () => [{ CLIENTE: 'CLI-9' }]),
    };

    const client = await invoiceTools.resolveAlbaranClientCode(conn, '2026/A/1/555');
    expect(client).toBe('CLI-9');
  });

  test('extractPdfContent returns structured data for factura', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CFC')) {
          return [{
            SERIE: 'F',
            NUMERO: 100,
            EJERCICIO: 2026,
            CLIENTE: 'CLI-1',
            IMPORTE: 250.75,
            DIA: 19,
            MES: 6,
            ANO: 2026,
          }];
        }
        if (sql.includes('FROM DSEDAC.CAC')) {
          return [{
            NUMEROALBARAN: 1,
            IMPORTE: 20,
            ANO: 2026,
            MES: 6,
            DIA: 19,
            CODIGO: 'ART-1',
            DESCRIPCION: 'Huevos',
            CANTIDAD: 2,
            PRECIO: 10,
          }];
        }
        return [];
      }),
    };

    const result = await genericAnalyticsTools.extractPdfContent(conn, 'factura', 'F/100/2026');

    expect(result.error).toBeUndefined();
    expect(result.documentType).toBe('factura');
    expect(result.clientCode).toBe('CLI-1');
    expect(result.extractionMethod).toBe('pdf-parse');
    expect(result.pdfText).toContain('Factura');
  });
});
