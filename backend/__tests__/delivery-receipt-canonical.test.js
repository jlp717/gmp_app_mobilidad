'use strict';

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const { saveReceipt } = require('../app/services/deliveryReceiptService');

describe('canonical delivery receipt service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does not re-query DSEDAC and returns a stable in-memory preview name', async () => {
    const projection = {
      canonicalProjection: true,
      confirmationId: '77',
      confirmationVersion: '2026-08-03T10:00:00Z',
      albaranNum: 'A-1-42',
      clientCode: 'C1',
      clientName: 'Cliente',
      confirmedAt: '2026-08-03T10:00:00Z',
      fecha: '2026-08-03T10:00:00Z',
      receiverName: 'Ana',
      receiverSurnames: 'Lopez',
      receiverDni: '00000000T',
      items: [{
        SECUENCIA: 1,
        ARTICULO: 'A',
        DESCRIPCION: 'Parcial',
        CANTIDAD_ENTREGADA: 2,
        BULTOS: 2,
        IMPORTE: 10,
      }],
      subtotal: 10,
      total: 10,
    };

    const first = await saveReceipt(projection, null);
    const second = await saveReceipt(projection, null);

    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(first.fileName).toBe(second.fileName);
    expect(first.fileName).toBe('RECIBO_77_2026-08-03T10_00_00Z.pdf');
    expect(first).toEqual(expect.objectContaining({
      disposition: 'inline-preview',
      persisted: false,
      relativePath: null,
      buffer: expect.any(Buffer),
    }));
  });
});

