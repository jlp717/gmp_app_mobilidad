'use strict';

jest.mock('../utils/db2-schemas', () => ({
  db2AppTable: (name) => `JAVIER.TEST_${name}`,
}));

const {
  localDocumentIdentity,
  lockLocalCancellationGuards,
  lockLocalOrderCoordinator,
} = require('../adapters/pedidos-local-order-state-guard');

function queryDouble({
  state = 'CONFIRMADO',
  blockers = {},
  commercialReferences = [],
} = {}) {
  const calls = [];
  const query = jest.fn((sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM JAVIER\.TEST_PEDIDOS_CAB/i.test(sql)) {
      return Promise.resolve([{
        ID: 81,
        ESTADO: state,
        CODIGOCLIENTE: '4300032888',
        SERIEPEDIDO: 'M',
        NUMEROPEDIDO: 1001,
      }]);
    }
    if (/FROM JAVIER\.TEST_REPARTO_CONFIRMACIONES/i.test(sql)) {
      return Promise.resolve(blockers.confirmation ? [{ ID: 1 }] : []);
    }
    if (/FROM JAVIER\.TEST_REPARTO_EVIDENCIAS/i.test(sql)) {
      return Promise.resolve(blockers.evidence ? [{ ID: 2 }] : []);
    }
    if (/FROM JAVIER\.TEST_REPARTIDOR_COBROS/i.test(sql)) {
      return Promise.resolve(blockers.driverPayment ? [{ ID: 3 }] : []);
    }
    if (/FROM JAVIER\.TEST_COBROS/i.test(sql)) {
      const matchedReference = params.slice(1).some((value) =>
        commercialReferences.includes(value));
      return Promise.resolve(
        blockers.commercialPayment || matchedReference ? [{ ID: 4 }] : [],
      );
    }
    return Promise.resolve([]);
  });
  return { calls, query };
}

describe('local order DB2 coordinator', () => {
  test('parses only canonical local PED document ids', () => {
    expect(localDocumentIdentity('PED-81-4300032888')).toEqual({
      pedidoId: 81,
      clientCode: '4300032888',
    });
    expect(localDocumentIdentity('P-73-81')).toBeNull();
  });

  test('ERP document is a no-op and takes no local lock', async () => {
    const query = jest.fn();
    await expect(lockLocalOrderCoordinator(query, 'P-073-000081'))
      .resolves.toEqual({ local: false, documentId: 'P-073-000081' });
    expect(query).not.toHaveBeenCalled();
  });

  test('locks stock then CAB and verifies the same local order', async () => {
    const { calls, query } = queryDouble();
    await expect(lockLocalOrderCoordinator(query, 'PED-81-4300032888'))
      .resolves.toMatchObject({
        local: true,
        pedidoId: 81,
        state: 'CONFIRMADO',
        stablePaymentReference: 'PEDIDO:81:M-1001',
      });
    expect(calls[0].sql).toMatch(/LOCK TABLE JAVIER\.TEST_PEDIDOS_STOCK_RESERVE/i);
    expect(calls[1].sql).toMatch(/LOCK TABLE JAVIER\.TEST_PEDIDOS_CAB/i);
    expect(calls[2].params).toEqual([81]);
  });

  test.each([
    ['CANCELADO', 'LOCAL_ORDER_CANCELLED'],
    ['BORRADOR', 'LOCAL_ORDER_NOT_CONFIRMED'],
  ])('rejects delivery for local order state %s', async (state, code) => {
    const { query } = queryDouble({ state });
    await expect(lockLocalOrderCoordinator(query, 'PED-81-4300032888'))
      .rejects.toMatchObject({ code });
  });

  test('fails closed when client identity differs', async () => {
    const { query } = queryDouble();
    await expect(lockLocalOrderCoordinator(query, 'PED-81-WRONG'))
      .rejects.toMatchObject({ code: 'LOCAL_ORDER_DOCUMENT_MISMATCH' });
  });

  test('cancellation takes driver-first financial locks after delivery locks', async () => {
    const { calls, query } = queryDouble();
    await lockLocalCancellationGuards(query, 'PED-81-4300032888');
    const sql = calls.map(({ sql: value }) => value).join('\n');
    expect(sql.indexOf('TEST_REPARTO_CONFIRMACIONES')).toBeLessThan(sql.indexOf('TEST_REPARTIDOR_COBROS'));
    expect(sql.indexOf('TEST_REPARTIDOR_COBROS')).toBeLessThan(sql.indexOf('TEST_COBROS'));
  });

  test.each([
    ['confirmation', 'DELIVERY_CONFIRMATION'],
    ['evidence', 'DELIVERY_EVIDENCE'],
    ['driverPayment', 'DRIVER_COLLECTION'],
    ['commercialPayment', 'COMMERCIAL_COLLECTION'],
  ])('blocks cancellation when %s exists', async (kind, expectedBlocker) => {
    const { query } = queryDouble({ blockers: { [kind]: true } });
    await expect(lockLocalCancellationGuards(query, 'PED-81-4300032888'))
      .rejects.toMatchObject({
        code: 'ORDER_CANCELLATION_HAS_DOWNSTREAM_ACTIVITY',
        blockers: expect.arrayContaining([expectedBlocker]),
      });
  });

  test('matches the exact stable commercial reference without an order-id prefix collision', async () => {
    const wrongOrder = queryDouble({
      commercialReferences: ['PEDIDO:8:M-1001'],
    });
    await expect(lockLocalCancellationGuards(wrongOrder.query, 'PED-81-4300032888'))
      .resolves.toMatchObject({ stablePaymentReference: 'PEDIDO:81:M-1001' });

    const exactOrder = queryDouble({
      commercialReferences: ['PEDIDO:81:M-1001'],
    });
    await expect(lockLocalCancellationGuards(exactOrder.query, 'PED-81-4300032888'))
      .rejects.toMatchObject({
        code: 'ORDER_CANCELLATION_HAS_DOWNSTREAM_ACTIVITY',
        blockers: ['COMMERCIAL_COLLECTION'],
      });
    const commercialCall = exactOrder.calls.find(({ sql }) =>
      /FROM JAVIER\.TEST_COBROS/i.test(sql));
    expect(commercialCall.params).toEqual([
      '4300032888',
      'PEDIDO:81:M-1001',
      'M-1001',
      'PED-81-4300032888',
    ]);
  });
});
