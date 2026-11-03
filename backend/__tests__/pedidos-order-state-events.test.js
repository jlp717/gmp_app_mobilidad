'use strict';

process.env.APP_ENV = 'test';
process.env.REPARTO_TABLE_SET = 'isolated_test';
process.env.DB2_WRITE_SCHEMA = 'JAVIER';

jest.mock('../utils/db2-schemas', () => ({
  db2AppTable: (name) => `JAVIER.TEST_${name}`,
}));

const {
  appendOrderStateEvent,
  canonicalPayload,
  normalizeDeviceId,
  normalizeOriginalClientAt,
  normalizeState,
  payloadHash,
  sanitizeAuditValue,
} = require('../services/pedidos/order-state-events');

describe('immutable pedido state events', () => {
  test.each([
    'BORRADOR', 'CONFIRMANDO', 'CONFIRMADO', 'CANCELANDO', 'CANCELADO',
  ])('accepts canonical state %s', (state) => {
    expect(normalizeState(state)).toBe(state);
  });

  test('fails closed for an unknown state', () => {
    expect(() => normalizeState('FACTURADO')).toThrow(
      expect.objectContaining({ code: 'INVALID_ORDER_STATE' }),
    );
  });

  test('accepts only UTC ISO original timestamps and canonicalizes precision', () => {
    expect(normalizeOriginalClientAt('2026-11-02T08:09:10.123Z'))
      .toBe('2026-11-02T08:09:10.123000Z');
    expect(normalizeOriginalClientAt('2026-11-02T08:09:10.123456Z'))
      .toBe('2026-11-02T08:09:10.123456Z');
    expect(() => normalizeOriginalClientAt('2026-11-02 08:09:10'))
      .toThrow(expect.objectContaining({ code: 'INVALID_ORIGINAL_CLIENT_AT' }));
    expect(() => normalizeOriginalClientAt('2026-02-31T08:09:10.000000Z'))
      .toThrow(expect.objectContaining({ code: 'INVALID_ORIGINAL_CLIENT_AT' }));
  });

  test('stores only a genuine device identifier and maps client sentinels to null', () => {
    expect(normalizeDeviceId('tablet-73-01')).toBe('tablet-73-01');
    expect(normalizeDeviceId('unknown')).toBeNull();
    expect(normalizeDeviceId(' UNAVAILABLE ')).toBeNull();
    expect(normalizeDeviceId('')).toBeNull();
  });

  test('canonical payload is stable across object key order', () => {
    const first = canonicalPayload({ z: 1, a: { y: 2, x: 3 } });
    const second = canonicalPayload({ a: { x: 3, y: 2 }, z: 1 });
    expect(first).toBe(second);
    expect(payloadHash(first)).toBe(payloadHash(second));
  });

  test('removes tokens, credentials and authorization recursively', () => {
    const sanitized = sanitizeAuditValue({
      authorization: 'Bearer secret',
      nested: { password: 'secret', token: 'secret', safe: 3, deviceId: 'unknown' },
      lines: [{ codigo: '2974', cookie: 'session' }],
    });
    expect(sanitized).toEqual({
      lines: [{ codigo: '2974' }],
      nested: { deviceId: null, safe: 3 },
    });
  });

  test('inserts a parameterized event with payload hash and original client time', async () => {
    const calls = [];
    const queryFn = jest.fn((sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve(/^SELECT PAYLOAD_HASH/i.test(sql.trim()) ? [] : { count: 1 });
    });
    const result = await appendOrderStateEvent(queryFn, {
      pedidoId: 81,
      fromState: null,
      toState: 'BORRADOR',
      actorId: '73',
      actorRole: 'COMERCIAL',
      deviceId: 'tablet-1',
      idempotencyKey: 'pedido-81-created-key0001',
      originalClientAt: '2026-11-02T08:09:10.123Z',
      payload: { lines: [{ codigo: '2974', precio: 29.28 }] },
    });
    expect(result.created).toBe(true);
    expect(calls[1].sql).toMatch(/INSERT INTO JAVIER\.TEST_PEDIDO_STATE_EVENTS/i);
    expect(calls[1].params[10]).toBe('2026-11-02 08:09:10.123000');
    expect(calls[1].params[8]).toContain('2974');
    expect(calls[1].params[9]).toHaveLength(64);
  });

  test('returns an exact replay without another insert', async () => {
    const payload = { event: 'ORDER_CONFIRMED', total: 29.28 };
    const json = canonicalPayload(payload);
    const queryFn = jest.fn().mockResolvedValue([{
      PAYLOAD_HASH: payloadHash(json),
      FROM_STATE: 'CONFIRMANDO',
      TO_STATE: 'CONFIRMADO',
    }]);
    const result = await appendOrderStateEvent(queryFn, {
      pedidoId: 81,
      fromState: 'CONFIRMANDO',
      toState: 'CONFIRMADO',
      actorId: '73',
      idempotencyKey: 'pedido-81-confirmed',
      payload,
    });
    expect(result).toEqual({ created: false, payloadHash: payloadHash(json) });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  test('binds NULL instead of a fabricated unknown device sentinel', async () => {
    const calls = [];
    const queryFn = jest.fn((sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve(/^SELECT PAYLOAD_HASH/i.test(sql.trim()) ? [] : { count: 1 });
    });
    await appendOrderStateEvent(queryFn, {
      pedidoId: 81,
      fromState: 'BORRADOR',
      toState: 'CONFIRMANDO',
      actorId: '73',
      deviceId: 'unknown',
      idempotencyKey: 'pedido-81-confirming-null-device',
      payload: { event: 'ORDER_CONFIRMING' },
    });
    expect(calls[1].params[5]).toBeNull();
  });

  test('rejects replay with a different immutable payload', async () => {
    const queryFn = jest.fn().mockResolvedValue([{
      PAYLOAD_HASH: '0'.repeat(64),
      FROM_STATE: 'CONFIRMANDO',
      TO_STATE: 'CONFIRMADO',
    }]);
    await expect(appendOrderStateEvent(queryFn, {
      pedidoId: 81,
      fromState: 'CONFIRMANDO',
      toState: 'CONFIRMADO',
      actorId: '73',
      idempotencyKey: 'pedido-81-confirmed',
      payload: { total: 30 },
    })).rejects.toMatchObject({ code: 'STATE_EVENT_IDEMPOTENCY_CONFLICT' });
  });

  test('requires a cancellation reason', async () => {
    const queryFn = jest.fn();
    await expect(appendOrderStateEvent(queryFn, {
      pedidoId: 81,
      fromState: 'CANCELANDO',
      toState: 'CANCELADO',
      actorId: '73',
      idempotencyKey: 'pedido-81-cancelled',
      payload: {},
    })).rejects.toMatchObject({ code: 'CANCELLATION_REASON_REQUIRED' });
    expect(queryFn).not.toHaveBeenCalled();
  });
});
