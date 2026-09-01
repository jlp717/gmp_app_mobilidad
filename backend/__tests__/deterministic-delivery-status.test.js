'use strict';

const {
  DeliveryStatusResolutionError,
  resolveCanonicalDeliveryStatuses,
} = require('../services/deterministic-delivery-status');

describe('deterministic canonical delivery status resolver', () => {
  test('same status is independent of DB row order and payment fan-out', () => {
    const rows = [
      {
        DOCUMENT_ID: '2026-A-1-42-C1',
        STATUS: 'ENTREGADO',
        ID: 20,
        COBRO_ID: 2,
        IMPORTE_COBRADO: 12,
      },
      {
        DOCUMENT_ID: '2026-A-1-42-C1',
        STATUS: 'ENTREGADO',
        ID: 10,
        COBRO_ID: 1,
        IMPORTE_COBRADO: 12,
      },
    ];

    const first = resolveCanonicalDeliveryStatuses(rows);
    const second = resolveCanonicalDeliveryStatuses(rows.slice().reverse());

    expect(first).toEqual(second);
    expect(first.get('2026-A-1-42-C1')).toMatchObject({ status: 'ENTREGADO', confirmationId: 10 });
  });

  test.each([
    ['ENTREGADO', 'NO_ENTREGADO'],
    ['NO_ENTREGADO', 'ENTREGADO'],
  ])('rejects contradictory states regardless of order: %s/%s', (left, right) => {
    const rows = [
      { DOCUMENT_ID: '2026-A-1-42-C1', STATUS: left, ID: 1 },
      { DOCUMENT_ID: '2026-A-1-42-C1', STATUS: right, ID: 2 },
    ];

    for (const ordered of [rows, rows.slice().reverse()]) {
      expect(() => resolveCanonicalDeliveryStatuses(ordered)).toThrow(
        expect.objectContaining({
          code: 'CONFLICTING_CANONICAL_DELIVERY_STATUS',
          documentId: '2026-A-1-42-C1',
        }),
      );
    }
  });

  test('rejects an unknown persisted state instead of turning it into pending', () => {
    expect(() => resolveCanonicalDeliveryStatuses([
      { DOCUMENT_ID: '2026-A-1-42-C1', STATUS: 'PENDIENTE' },
    ])).toThrow(
      expect.objectContaining({
        code: 'INVALID_CANONICAL_DELIVERY_STATUS',
      }),
    );
  });

  test('keeps an empty overlay as no canonical status', () => {
    expect(resolveCanonicalDeliveryStatuses([]).size).toBe(0);
  });

  test('uses the dedicated typed error', () => {
    try {
      resolveCanonicalDeliveryStatuses([{ DOCUMENT_ID: 'x', STATUS: 'INVALIDO' }]);
    } catch (error) {
      expect(error).toBeInstanceOf(DeliveryStatusResolutionError);
    }
  });
});
