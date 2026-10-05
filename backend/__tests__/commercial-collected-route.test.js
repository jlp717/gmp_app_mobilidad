'use strict';

const {
  indexCommercialCollections,
  paymentCovers,
  shouldHideCommercialCollectedRow,
} = require('../services/commercial-collected-route');

describe('commercial collected orders stay off the driver route', () => {
  test('a covered app cobro hides the anteroom pedido and its synced albaran', () => {
    const index = indexCommercialCollections({
      cobros: [{ REFERENCIA: 'PEDIDO:22:M-15-3001', CLIENTE: 'C9', IMPORTE: 20.7 }],
      pedidos: [{
        ID: 22,
        CLIENTE: 'C9',
        IMPORTE_TOTAL: 20.7,
        SERIE: 'M',
        TERMINAL: 15,
        NUMERO: 3001,
        SYSTEM_SERIE: 'P',
        SYSTEM_TERMINAL: 15,
        SYSTEM_NUMERO: 2296,
      }],
    });

    expect(shouldHideCommercialCollectedRow({
      PEDIDO_ID: 22,
      CLIENTE: 'C9',
      SERIEALBARAN: 'M',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 3001,
      IMPORTETOTAL: 20.7,
      CODIGO_REPARTIDOR: '94',
    }, index)).toBe(true);

    expect(shouldHideCommercialCollectedRow({
      CLIENTE: 'C9',
      SERIEALBARAN: 'P',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 2296,
      IMPORTETOTAL: 20.7,
    }, index)).toBe(true);
  });

  test('an unpaid production albaran stays visible', () => {
    const index = indexCommercialCollections({
      cobros: [{ REFERENCIA: 'PEDIDO:22:M-15-3001', CLIENTE: 'C9', IMPORTE: 20.7 }],
      pedidos: [{
        ID: 22,
        CLIENTE: 'C9',
        IMPORTE_TOTAL: 20.7,
        SERIE: 'M',
        TERMINAL: 15,
        NUMERO: 3001,
        SYSTEM_SERIE: 'P',
        SYSTEM_TERMINAL: 15,
        SYSTEM_NUMERO: 2296,
      }],
    });

    expect(shouldHideCommercialCollectedRow({
      CLIENTE: 'C8',
      SERIEALBARAN: 'P',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 4400,
      IMPORTETOTAL: 88,
    }, index)).toBe(false);
    expect(paymentCovers(1, 88)).toBe(false);
  });

  test('a partial commercial cobro does not hide the stop', () => {
    const index = indexCommercialCollections({
      cobros: [{ REFERENCIA: 'PEDIDO:9:M-15-10', CLIENTE: 'C1', IMPORTE: 5 }],
      pedidos: [{
        ID: 9,
        CLIENTE: 'C1',
        IMPORTE_TOTAL: 40,
        SERIE: 'M',
        TERMINAL: 15,
        NUMERO: 10,
      }],
    });
    expect(shouldHideCommercialCollectedRow({
      PEDIDO_ID: 9,
      CLIENTE: 'C1',
      SERIEALBARAN: 'M',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 10,
      IMPORTETOTAL: 40,
    }, index)).toBe(false);
  });

  test('the cobro-en-mano marker hides the order even without a cobro row', () => {
    const index = indexCommercialCollections({
      cobros: [],
      pedidos: [{
        ID: 4,
        CLIENTE: 'C3',
        IMPORTE_TOTAL: 18,
        SERIE: 'M',
        TERMINAL: 15,
        NUMERO: 8,
        SYSTEM_SERIE: 'A',
        SYSTEM_TERMINAL: 2,
        SYSTEM_NUMERO: 77,
        OBSERVACIONES: 'urgente [COBRO_COMERCIAL]',
      }],
    });
    expect(shouldHideCommercialCollectedRow({
      CLIENTE: 'C3',
      SERIEALBARAN: 'A',
      TERMINALALBARAN: 2,
      NUMEROALBARAN: 77,
      IMPORTETOTAL: 18,
    }, index)).toBe(true);
  });
});
