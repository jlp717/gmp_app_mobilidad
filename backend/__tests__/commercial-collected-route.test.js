'use strict';

const {
  applyCommercialCollectionToHistoryDocument,
  applyCommercialCollectionToRouteItem,
  applyCommercialCollectionToVencimiento,
  commercialCollectionStatus,
  indexCommercialCollections,
  paymentCovers,
} = require('../services/commercial-collected-route');

function coveredOrderIndex() {
  return indexCommercialCollections({
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
}

describe('commercial collection keeps the delivery and drops only the cobro', () => {
  test('an unpaid commercial order stays visible and collectable', () => {
    const index = indexCommercialCollections({ cobros: [], pedidos: [] });
    const status = commercialCollectionStatus({
      PEDIDO_ID: 22,
      CLIENTE: 'C9',
      SERIEALBARAN: 'M',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 3001,
      IMPORTETOTAL: 20.7,
    }, index);
    const item = applyCommercialCollectionToRouteItem({
      id: 'PED-22-C9',
      importe: 20.7,
      puedeCobrarse: true,
      importeDisponibleCobro: 20.7,
    }, status);

    expect(status.covered).toBe(false);
    expect(item.puedeCobrarse).toBe(true);
    expect(item.cobradoPorComercial).toBeUndefined();
    expect(item.importeDisponibleCobro).toBe(20.7);
  });

  test('a fully collected commercial order stays for delivery and is marked collected', () => {
    const index = coveredOrderIndex();
    const anteroom = applyCommercialCollectionToRouteItem({
      id: 'PED-22-C9',
      importe: 20.7,
      puedeCobrarse: true,
      importeDisponibleCobro: 20.7,
      esCTR: true,
    }, commercialCollectionStatus({
      PEDIDO_ID: 22,
      CLIENTE: 'C9',
      SERIEALBARAN: 'M',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 3001,
      IMPORTETOTAL: 20.7,
    }, index));
    const synced = applyCommercialCollectionToRouteItem({
      id: '2026-P-15-2296-C9',
      importe: 20.7,
      puedeCobrarse: true,
    }, commercialCollectionStatus({
      CLIENTE: 'C9',
      SERIEALBARAN: 'P',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 2296,
      IMPORTETOTAL: 20.7,
    }, index));

    expect(anteroom.puedeCobrarse).toBe(false);
    expect(anteroom.cobradoPorComercial).toBe(true);
    expect(anteroom.saldoMotivo).toBe('Ya está cobrado');
    expect(anteroom.importeDisponibleCobro).toBe(0);
    expect(synced.cobradoPorComercial).toBe(true);
    expect(synced.puedeCobrarse).toBe(false);
  });

  test('a fully collected order is absent from pending cobros and pending history', () => {
    const index = coveredOrderIndex();
    const vencimiento = applyCommercialCollectionToVencimiento({
      codigoCliente: 'C9',
      importe: 20.7,
      importePendiente: 20.7,
      keys: { serieDocumento: 'P', terminalDocumento: 15, numeroDocumento: 2296 },
    }, index);
    const history = applyCommercialCollectionToHistoryDocument({
      serie: 'P',
      terminal: 15,
      albaranNumber: 2296,
      amount: 20.7,
      pending: 20.7,
      cobrado: false,
    }, 'C9', index);

    expect(vencimiento.cobradoPorComercial).toBe(true);
    expect(vencimiento.importePendiente).toBe(0);
    expect(history.cobradoPorComercial).toBe(true);
    expect(history.importePendienteCobro).toBe(0);
    expect(history.pending).toBe(0);
    expect(history.puedeCobrarse).toBe(false);
  });

  test('a partial commercial cobro leaves the remaining balance collectable', () => {
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
    const status = commercialCollectionStatus({
      PEDIDO_ID: 9,
      CLIENTE: 'C1',
      SERIEALBARAN: 'M',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 10,
      IMPORTETOTAL: 40,
    }, index);
    const item = applyCommercialCollectionToRouteItem({
      importe: 40,
      puedeCobrarse: true,
      importeDisponibleCobro: 40,
    }, status);

    expect(status.covered).toBe(false);
    expect(status.partial).toBe(true);
    expect(item.cobradoPorComercial).toBe(false);
    expect(item.puedeCobrarse).toBe(true);
    expect(item.cobroParcial).toBe(true);
    expect(item.importeDisponibleCobro).toBe(35);
    expect(item.importePendienteCobro).toBe(35);
  });

  test('a production albaran without an app cobro stays collectable', () => {
    const index = coveredOrderIndex();
    const status = commercialCollectionStatus({
      CLIENTE: 'C8',
      SERIEALBARAN: 'P',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 4400,
      IMPORTETOTAL: 88,
    }, index);
    const item = applyCommercialCollectionToRouteItem({
      importe: 88,
      puedeCobrarse: true,
      importeDisponibleCobro: 88,
    }, status);

    expect(status.covered).toBe(false);
    expect(item.puedeCobrarse).toBe(true);
    expect(item.importeDisponibleCobro).toBe(88);
    expect(paymentCovers(1, 88)).toBe(false);
  });

  test('the cobro-en-mano marker settles the cobro without removing the stop', () => {
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
    const item = applyCommercialCollectionToRouteItem({
      importe: 18,
      puedeCobrarse: true,
    }, commercialCollectionStatus({
      CLIENTE: 'C3',
      SERIEALBARAN: 'A',
      TERMINALALBARAN: 2,
      NUMEROALBARAN: 77,
      IMPORTETOTAL: 18,
    }, index));

    expect(item.cobradoPorComercial).toBe(true);
    expect(item.puedeCobrarse).toBe(false);
    expect(item.saldoMotivo).toBe('Ya está cobrado');
  });
});
