'use strict';

const { invoiceTools } = require('../src/chatbot/chatbot_tools');

const CURRENT_YEAR = new Date().getFullYear();

describe('chatbot invoice tools RBAC', () => {
  test('getInvoiceDetails returns error when CFC header is missing', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CFC')) {
          return [];
        }
        return [];
      }),
    };

    const result = await invoiceTools.getInvoiceDetails(
      conn,
      'INV-1',
      '80',
      false,
      ['80']
    );

    expect(result.error).toMatch(/no encontrada o sin permiso/i);
    expect(conn.query).toHaveBeenCalled();
  });

  test('getInvoiceDetails returns line items when invoice is in scope', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CFC')) {
          return [{
            SERIE: 'F',
            NUMERO: 2,
            EJERCICIO: CURRENT_YEAR,
            CLIENTE: 'CLI-1',
            IMPORTE: 120.5,
            DIA: 1,
            MES: 6,
            ANO: CURRENT_YEAR,
          }];
        }
        if (sql.includes('FROM DSEDAC.CAC')) {
          return [{
            CODIGO: 'ART1',
            DESCRIPCION: 'Huevos L',
            CANTIDAD: 10,
            PRECIO: 2.5,
            IMPORTE: 25,
            ALBARAN: 'ALB-9',
            ANODOCUMENTO: CURRENT_YEAR,
            MESDOCUMENTO: 6,
            DIADOCUMENTO: 1,
          }];
        }
        if (sql.includes('FROM DSEDAC.CVC')) {
          return [{ PENDIENTE: 20 }];
        }
        return [];
      }),
    };

    const result = await invoiceTools.getInvoiceDetails(
      conn,
      'INV-2',
      '80',
      false,
      ['80']
    );

    expect(result.error).toBeUndefined();
    expect(result.numero).toBe(2);
    expect(result.clientCode).toBe('CLI-1');
    expect(result.lineCount).toBe(1);
    expect(result.lines[0].productCode).toBe('ART1');
    expect(result.pendingAmount).toBe(20);
  });
});
