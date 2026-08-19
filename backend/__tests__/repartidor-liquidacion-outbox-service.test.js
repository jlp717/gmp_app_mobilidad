'use strict';

const { processLiquidacionOutboxIntent, processPendingLiquidacionOutbox, redactOutboxError } = require('../services/repartidor-liquidacion-outbox-service');
const { requeueFailedLiquidacionOutbox } = require('../services/repartidor-liquidacion-outbox-service');

const runtimeEnv = {
  NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24', ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER', REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
};
const liquidacion = {
  id: '701', repartidorId: '94', date: '2026-08-09', numero: { display: 'GMP 2026 A 94000701' },
  totals: { totalEfectivo: 10, totalAIngresar: 10, ingresoBanco: 10, diff: 0 }, snapshot: { payments: [] },
};

function outboxQuery({ id = 17, payload = { type: 'REPARTIDOR_LIQUIDACION_EMAIL' } } = {}) {
  const state = { id, status: 'PENDING', payload: JSON.stringify(payload) };
  return jest.fn(async (sql, params = []) => {
    const statement = String(sql);
    if (statement.includes('SELECT PAYLOAD_JSON FROM')) {
      return state.status === 'PENDING' ? [{ PAYLOAD_JSON: state.payload }] : [];
    }
    if (statement.includes("SET STATUS = 'FAILED', PAYLOAD_JSON") && statement.includes("STATUS = 'PENDING'")) {
      if (state.status === 'PENDING') {
        state.status = 'FAILED';
        state.payload = params[0];
      }
      return [];
    }
    if (!statement.includes('SET STATUS = ?') && statement.includes("WHERE ID = ? AND STATUS = 'FAILED'")) {
      return state.status === 'FAILED' ? [{ STATUS: state.status, PAYLOAD_JSON: state.payload }] : [];
    }
    if (statement.includes('SET STATUS = ?, PAYLOAD_JSON = ?')) {
      if (state.status === 'FAILED' && state.payload === params[3]) {
        state.status = params[0];
        state.payload = params[1];
      }
      return [];
    }
    if (statement.includes("WHERE ID = ? AND STATUS = ?")) {
      return state.status === params[1] ? [{ STATUS: state.status, PAYLOAD_JSON: state.payload }] : [];
    }
    return [];
  });
}

describe('repartidor liquidacion outbox delivery', () => {
  test('marks SENT only after every effective recipient succeeds and records a redacted summary', async () => {
    const query = outboxQuery();
    const result = await processLiquidacionOutboxIntent({ liquidacion, repartidorId: '94', outboxId: 17, outboxPayload: { type: 'REPARTIDOR_LIQUIDACION_EMAIL' } }, { query, env: runtimeEnv, sendEmails: jest.fn().mockResolvedValue([{ success: true }, { success: true }]) });
    expect(result.delivery).toEqual({ attempted: 2, sent: 2, failed: 0, allSucceeded: true });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('SET STATUS = ?'));
    expect(update[1][0]).toBe('SENT');
    expect(JSON.parse(update[1][1])).toMatchObject({ type: 'REPARTIDOR_LIQUIDACION_EMAIL', delivery: { attempted: 2, sent: 2, failed: 0, allSucceeded: true, lastError: null } });
    expect(String(update[0])).toContain("STATUS = 'FAILED'");
    const claim = query.mock.calls.find(([sql]) => String(sql).includes("SET STATUS = 'FAILED'"));
    expect(String(claim[0])).toContain("STATUS = 'PENDING'");
  });

  test('marks FAILED on a partial result and never persists recipient addresses in its error summary', async () => {
    const query = outboxQuery({ id: 18, payload: { identity: 'daily-18' } });
    await processLiquidacionOutboxIntent({ liquidacion, repartidorId: '94', outboxId: 18, outboxPayload: { identity: 'daily-18' } }, { query, env: runtimeEnv, sendEmails: jest.fn().mockResolvedValue([{ success: true }, { success: false, error: 'smtp rejected driver@example.test' }]) });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('SET STATUS = ?'));
    expect(update[1][0]).toBe('FAILED');
    expect(JSON.parse(update[1][1])).toMatchObject({ delivery: { attempted: 2, sent: 1, failed: 1, allSucceeded: false, lastError: 'incomplete email delivery' } });
    expect(update[1][1]).not.toContain('driver@example.test');
  });

  test('keeps a pending entry observable as FAILED when the sender rejects and redacts the exception', async () => {
    const claimed = outboxQuery({ id: 19, payload: { type: 'REPARTIDOR_LIQUIDACION_EMAIL' } });
    const query = jest.fn(async (sql, params) => {
      if (String(sql).includes('FROM') && String(sql).includes("WHERE STATUS = 'PENDING'")) return [{ ID: 19, LIQUIDACION_ID: 701, PAYLOAD_JSON: JSON.stringify({ type: 'REPARTIDOR_LIQUIDACION_EMAIL' }) }];
      if (String(sql).includes('FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS')) return [{ ID: 701, CODIGOVENDEDOR: '94', DIALIQUIDACION: 9, MESLIQUIDACION: 8, ANOLIQUIDACION: 2026, NUMEROLIQUIDACION: 701, STATUS: 'CLOSED', REPLAY_IDENTITY_JSON: '{}', SNAPSHOT_JSON: '{}' }];
      return claimed(sql, params);
    });
    const result = await processPendingLiquidacionOutbox({ query, env: runtimeEnv, sendEmails: jest.fn().mockRejectedValue(new Error('smtp secret driver@example.test\nfailed')) });
    expect(result).toEqual({ processed: 1, sent: 0 });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('SET STATUS = ?'));
    expect(update[1][0]).toBe('FAILED');
    const payload = JSON.parse(update[1][1]);
    expect(payload.delivery.lastError).toContain('[redacted-email]');
    expect(payload.delivery.lastError).not.toContain('driver@example.test');
  });

  test('redacts email-bearing errors without claiming exactly-once delivery', () => {
    expect(redactOutboxError('smtp driver@example.test\nfailed')).toBe('smtp [redacted-email] failed');
  });

  test('allows exactly one concurrent failed-outbox requeue winner', async () => {
    const state = { status: 'FAILED', payload: JSON.stringify({ identity: 'daily-71' }) };
    const query = jest.fn(async (sql, params = []) => {
      const statement = String(sql);
      if (statement.includes('JOIN') && statement.includes('IDEMPOTENCY_TOKEN')) {
        return [{ ID: 71, STATUS: state.status, PAYLOAD_JSON: state.payload, CODIGOVENDEDOR: '94' }];
      }
      if (statement.includes("SET STATUS = 'PENDING'")) {
        if (state.status === 'FAILED' && state.payload === params[2]) {
          state.status = 'PENDING';
          state.payload = params[0];
        }
        return [];
      }
      if (statement.includes("WHERE ID = ? AND STATUS = 'PENDING'")) {
        return state.status === 'PENDING' ? [{ STATUS: state.status, PAYLOAD_JSON: state.payload }] : [];
      }
      return [];
    });
    const input = { idempotencyToken: 'liquidacion-route-test-0001', canAccessRepartidor: () => true };
    const results = await Promise.all([
      requeueFailedLiquidacionOutbox(input, { query, env: runtimeEnv }),
      requeueFailedLiquidacionOutbox(input, { query, env: runtimeEnv }),
    ]);
    expect(results.filter((result) => result.requeued)).toHaveLength(1);
    expect(results.filter((result) => result.reason === 'requeue_lost')).toHaveLength(1);
  });

  test('refuses a non-failed outbox without updating or delivering', async () => {
    const query = jest.fn(async () => [{ ID: 72, STATUS: 'SENT', PAYLOAD_JSON: '{}', CODIGOVENDEDOR: '94' }]);
    const result = await requeueFailedLiquidacionOutbox({
      idempotencyToken: 'liquidacion-route-test-0001', canAccessRepartidor: () => true,
    }, { query, env: runtimeEnv });
    expect(result).toEqual({ requeued: false, reason: 'not_failed' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('SET STATUS'))).toBe(false);
  });
});
