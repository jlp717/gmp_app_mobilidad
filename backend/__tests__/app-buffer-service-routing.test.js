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

function approveProductionWrites({ apply = true } = {}) {
  process.env.REPARTO_WRITES_ENABLED = 'true';
  process.env.REPARTO_PRODUCTION_WRITES_APPROVED = 'true';
  if (apply) require('../config/app-profile').applyAppProfile();
}

const auditEvent = {
  pedidoId: 42,
  toState: 'BORRADOR',
  actorId: '73',
  idempotencyKey: 'production-order-created',
  payload: {},
};

const settlement = {
  vendorCodes: ['80'],
  date: '2026-11-04',
  ingresoBanco: 10,
  entregado: 0,
  idempotencyToken: 'production-settlement-test',
};

afterEach(() => {
  jest.restoreAllMocks();
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

  test('production writes require an applied profile before accessing DB2', async () => {
    installProductionProfile();
    jest.resetModules();
    approveProductionWrites({ apply: false });
    const { appendOrderStateEvent } = require('../services/pedidos/order-state-events');
    const { saveLiquidacion } = require('../services/comercial-devoluciones-service');
    const query = jest.fn();
    const openDedicatedConnection = jest.fn();

    await expect(appendOrderStateEvent(query, auditEvent))
      .rejects.toMatchObject({ code: 'APP_BUFFER_PRODUCTION_WRITES_DISABLED' });
    await expect(saveLiquidacion(settlement, { catalogQuery: query, openDedicatedConnection }))
      .rejects.toMatchObject({ code: 'APP_BUFFER_PRODUCTION_WRITES_DISABLED' });
    expect(query).not.toHaveBeenCalled();
    expect(openDedicatedConnection).not.toHaveBeenCalled();
  });

  test('production audit and settlement fail closed when their buffers are absent', async () => {
    installProductionProfile();
    jest.resetModules();
    approveProductionWrites();
    const { appendOrderStateEvent } = require('../services/pedidos/order-state-events');
    const { saveLiquidacion } = require('../services/comercial-devoluciones-service');
    const query = jest.fn().mockResolvedValue([]);
    const openDedicatedConnection = jest.fn();

    await expect(appendOrderStateEvent(query, auditEvent))
      .rejects.toMatchObject({ code: 'APP_BUFFER_CAPABILITY_UNAVAILABLE' });
    await expect(saveLiquidacion(settlement, { catalogQuery: query, openDedicatedConnection }))
      .rejects.toMatchObject({ code: 'APP_BUFFER_CAPABILITY_UNAVAILABLE' });
    expect(query).toHaveBeenCalledTimes(10);
    for (const [sql] of query.mock.calls) expect(sql).toContain('QSYS2.');
    expect(openDedicatedConnection).not.toHaveBeenCalled();
  });

  test('records production audit only after checking the scoped catalog on the same transaction', async () => {
    installProductionProfile();
    jest.resetModules();
    approveProductionWrites();
    const capability = require('../utils/db2-app-buffer-capability');
    const verify = jest.spyOn(capability, 'requireProductionAppBufferWrites').mockResolvedValue();
    const { appendOrderStateEvent } = require('../services/pedidos/order-state-events');
    const query = jest.fn(async (sql) => /^\s*SELECT/i.test(sql) ? [] : { count: 1 });

    await appendOrderStateEvent(query, auditEvent);
    await appendOrderStateEvent(query, {
      ...auditEvent,
      fromState: 'BORRADOR',
      toState: 'CONFIRMANDO',
      idempotencyKey: 'production-order-confirming',
    });

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith({ family: 'audit', catalogQuery: query });
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]);
    expect(query.mock.calls.filter(([sql]) => /INSERT INTO JAVIER\.PEDIDO_STATE_EVENTS/i.test(sql)))
      .toHaveLength(2);
    expect(query.mock.calls.every(([sql]) => !/TEST_PEDIDO_STATE_EVENTS/i.test(sql))).toBe(true);
  });

  test('saves a production settlement only in the JAVIER overlay', async () => {
    installProductionProfile();
    jest.resetModules();
    approveProductionWrites();
    const capability = require('../utils/db2-app-buffer-capability');
    const verify = jest.spyOn(capability, 'requireProductionAppBufferWrites').mockResolvedValue();
    const { saveLiquidacion } = require('../services/comercial-devoluciones-service');
    const catalogQuery = jest.fn();
    let persisted;
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      close: jest.fn().mockResolvedValue(),
      query: jest.fn(async (sql) => {
        if (/INSERT INTO JAVIER\.LIQUIDACION_COMERCIAL/i.test(sql)) {
          persisted = {
            VENDEDOR: '80', FECHA: settlement.date, INGRESO_BANCO: 10,
            ENTREGADO: 0, TOTAL_ESPERADO: 10, TOKEN: settlement.idempotencyToken,
            REVISION: '2026-11-04-13.00.00.000000',
          };
        }
        if (/FROM JAVIER\.LIQUIDACION_COMERCIAL/i.test(sql)) return persisted ? [persisted] : [];
        if (/FROM JAVIER\.COBROS/i.test(sql)) return [{ FORMA_PAGO: 'EF', TOTAL: 10, FILAS: 1 }];
        return [];
      }),
    };
    const openDedicatedConnection = jest.fn().mockResolvedValue(conn);

    const result = await saveLiquidacion(settlement, { catalogQuery, openDedicatedConnection });

    expect(result.idempotent).toBe(false);
    expect(verify).toHaveBeenCalledWith({ family: 'commercialFinance', catalogQuery });
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(openDedicatedConnection.mock.invocationCallOrder[0]);
    expect(conn.query.mock.calls.filter(([sql]) => /INSERT INTO JAVIER\.LIQUIDACION_COMERCIAL/i.test(sql)))
      .toHaveLength(1);
    expect(conn.query.mock.calls.some(([sql]) => /FROM DSEDAC\.LQD/i.test(sql))).toBe(true);
    expect(conn.query.mock.calls.some(([sql]) => /(?:INSERT INTO|UPDATE|DELETE FROM) DSEDAC\./i.test(sql))).toBe(false);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});
