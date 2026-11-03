'use strict';

const ORIGINAL_ENV = { ...process.env };
const { PROFILE_ASSIGNMENTS } = require('../config/app-profile');

function installProductionProfile() {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: 'production',
    ...PROFILE_ASSIGNMENTS.production,
  };
  process.env.APP_ENV = 'production';
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('production app-buffer routing', () => {
  test('timeline checks the normal production alias and never falls back to TEST', async () => {
    installProductionProfile();
    jest.resetModules();
    const {
      STATE_EVENTS_TABLE,
      readOrderStateTimeline,
    } = require('../services/pedidos/order-state-events');
    const queryFn = jest.fn().mockResolvedValue([]);

    const result = await readOrderStateTimeline(queryFn, 42);

    expect(STATE_EVENTS_TABLE).toBe('JAVIER.PEDIDO_STATE_EVENTS');
    expect(result).toEqual({
      status: 'unavailable',
      code: 'ORDER_TIMELINE_CAPABILITY_UNAVAILABLE',
      events: [],
    });
    expect(queryFn).toHaveBeenCalledTimes(5);
    for (const [sql, params] of queryFn.mock.calls) {
      expect(sql).toContain('QSYS2.');
      expect(sql).not.toContain('TEST_PEDIDO_STATE_EVENTS');
      expect(params).toContain('PEDIDO_STATE_EVENTS');
      expect(params).not.toContain('TEST_PEDIDO_STATE_EVENTS');
    }
  });

  test('production state-event writes remain closed before any query', async () => {
    installProductionProfile();
    jest.resetModules();
    const { appendOrderStateEvent } = require('../services/pedidos/order-state-events');
    const queryFn = jest.fn();

    await expect(appendOrderStateEvent(queryFn, {
      pedidoId: 42,
      fromState: 'BORRADOR',
      toState: 'CONFIRMADO',
      actorId: '73',
      idempotencyKey: 'production-write-must-stay-closed',
      payload: {},
    })).rejects.toMatchObject({
      code: 'ORDER_STATE_AUDIT_TARGET_UNAVAILABLE',
      status: 503,
    });
    expect(queryFn).not.toHaveBeenCalled();
  });

  test('an invalid production profile is rejected before catalog access', async () => {
    installProductionProfile();
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    jest.resetModules();
    const { readOrderStateTimeline } = require('../services/pedidos/order-state-events');
    const queryFn = jest.fn();

    const result = await readOrderStateTimeline(queryFn, 42);

    expect(result).toEqual({
      status: 'unavailable',
      code: 'ORDER_TIMELINE_UNSUPPORTED_PROFILE',
      events: [],
    });
    expect(queryFn).not.toHaveBeenCalled();
  });
});
