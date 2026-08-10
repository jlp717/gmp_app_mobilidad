'use strict';

const { createRepartidorLiquidacionService } = require('../services/repartidor-liquidacion-service');

const expense = (overrides = {}) => ({
  repartidorId: '94', date: '2026-08-09', amount: 12.5, category: 'PEAJE',
  idempotencyToken: 'expense-20260809-94-0001', observation: 'AP-7', ...overrides,
});
const actor = (overrides = {}) => ({ actorId: '94', actorRole: 'REPARTIDOR', ...overrides });

function fixture({ replay = null, closed = false } = {}) {
  const tx = {
    lockBalance: jest.fn(async () => ({ saldo: 0 })),
    getStructuredEntryByToken: jest.fn(async () => replay),
    isDayClosed: jest.fn(async () => closed),
    insertStructuredEntry: jest.fn(async (input) => ({
      id: '501', type: input.type, repartidorId: input.repartidorId, date: input.date,
      amount: input.amount, category: input.category, reference: input.reference,
      reason: input.reason, observation: input.observation, status: 'PENDING',
      createdAt: '2026-08-09T10:00:00.000Z',
    })),
    listStructuredEntries: jest.fn(async () => ({
      closed: false,
      expenses: [{ id: '501', repartidorId: '94', date: '2026-08-09', amount: 12.5,
        category: 'PEAJE', observation: 'AP-7', status: 'PENDING', createdAt: '2026-08-09T10:00:00.000Z' }],
      adjustments: [{ id: '601', repartidorId: '94', date: '2026-08-09', amount: -2,
        reason: 'DIFERENCIA', status: 'PENDING', createdAt: '2026-08-09T10:01:00.000Z' }],
      bankDeposits: [{ id: '701', repartidorId: '94', date: '2026-08-09', amount: 5,
        reference: 'TRX-9', status: 'PENDING', createdAt: '2026-08-09T10:02:00.000Z' }],
    })),
  };
  const repository = {
    assertCapabilities: jest.fn(async () => undefined),
    withTransaction: jest.fn(async (work) => work(tx)),
  };
  return { tx, repository, service: createRepartidorLiquidacionService({ repository }) };
}

describe('canonical structured liquidation entry service', () => {
  test('creates an owner expense append-only and returns no actor or token', async () => {
    const { service, tx } = fixture();
    const result = await service.createExpense(expense(), actor());
    expect(result).toEqual({ created: true, entry: {
      id: '501', type: 'EXPENSE', repartidorId: '94', date: '2026-08-09', amount: 12.5,
      category: 'PEAJE', observation: 'AP-7', status: 'PENDING', createdAt: '2026-08-09T10:00:00.000Z',
    } });
    expect(tx.insertStructuredEntry).toHaveBeenCalledWith(expect.objectContaining({
      type: 'EXPENSE', actorId: '94', actorRole: 'REPARTIDOR', idempotencyToken: expense().idempotencyToken,
    }));
    expect(JSON.stringify(result)).not.toMatch(/idempotencyToken|actorId|actorRole/i);
  });

  test('replays an exact expense and rejects token reuse with different identity', async () => {
    const persisted = {
      id: '501', type: 'EXPENSE', repartidorId: '94', date: '2026-08-09', amount: 12.5,
      category: 'PEAJE', observation: 'AP-7', status: 'PENDING', createdAt: '2026-08-09T10:00:00.000Z',
    };
    const exact = fixture({ replay: persisted });
    await expect(exact.service.createExpense(expense(), actor())).resolves.toEqual({ created: false, entry: persisted });
    expect(exact.tx.isDayClosed).not.toHaveBeenCalled();
    expect(exact.tx.insertStructuredEntry).not.toHaveBeenCalled();

    const mismatch = fixture({ replay: persisted });
    await expect(mismatch.service.createExpense(expense({ amount: 13 }), actor())).rejects.toMatchObject({
      code: 'LIQUIDACION_ENTRY_REPLAY_MISMATCH', statusCode: 409,
    });
    expect(mismatch.tx.insertStructuredEntry).not.toHaveBeenCalled();
  });

  test('serializes through the balance row and rejects new entries after CLOSED', async () => {
    const { service, tx } = fixture({ closed: true });
    await expect(service.createBankDeposit({
      repartidorId: '94', date: '2026-08-09', amount: 5, reference: 'TRX-9',
      idempotencyToken: 'deposit-20260809-94-0001',
    }, actor())).rejects.toMatchObject({ code: 'LIQUIDACION_DAY_ALREADY_CLOSED', statusCode: 409 });
    expect(tx.lockBalance.mock.invocationCallOrder[0])
      .toBeLessThan(tx.isDayClosed.mock.invocationCallOrder[0]);
    expect(tx.insertStructuredEntry).not.toHaveBeenCalled();
  });

  test('enforces owner scope and restricts signed adjustments to JEFE/ADMIN', async () => {
    const foreign = fixture();
    await expect(foreign.service.createExpense(expense({ repartidorId: '95' }), actor())).rejects.toMatchObject({
      code: 'LIQUIDACION_ENTRY_FORBIDDEN', statusCode: 403,
    });
    expect(foreign.repository.withTransaction).not.toHaveBeenCalled();

    const driver = fixture();
    await expect(driver.service.createAdjustment({
      repartidorId: '94', date: '2026-08-09', amount: -2, reason: 'DIFERENCIA',
      idempotencyToken: 'adjustment-20260809-94-01',
    }, actor())).rejects.toMatchObject({ code: 'LIQUIDACION_ADJUSTMENT_ROLE_REQUIRED', statusCode: 403 });
    expect(driver.repository.withTransaction).not.toHaveBeenCalled();

    const boss = fixture();
    await expect(boss.service.createAdjustment({
      repartidorId: '94', date: '2026-08-09', amount: -2, reason: 'DIFERENCIA',
      idempotencyToken: 'adjustment-20260809-94-01',
    }, actor({ actorId: '7', actorRole: 'JEFE_VENTAS' }))).resolves.toMatchObject({ created: true });
  });

  test.each([
    ['zero adjustment', 'createAdjustment', { repartidorId: '94', date: '2026-08-09', amount: 0, reason: 'X', idempotencyToken: 'adjustment-invalid-0001' }],
    ['impossible date', 'createExpense', expense({ date: '2026-02-30' })],
    ['numeric string', 'createExpense', expense({ amount: '12.5' })],
    ['blank category', 'createExpense', expense({ category: ' ' })],
    ['long token', 'createExpense', expense({ idempotencyToken: 'x'.repeat(129) })],
    ['unknown field', 'createExpense', expense({ extra: true })],
  ])('rejects strict input: %s', async (_label, method, input) => {
    const { service, repository } = fixture();
    await expect(service[method](input, actor({ actorRole: 'ADMIN' }))).rejects.toMatchObject({
      code: 'INVALID_LIQUIDACION_ENTRY', statusCode: 422,
    });
    expect(repository.withTransaction).not.toHaveBeenCalled();
  });

  test('returns a daily server-side breakdown without tokens, actors or PII', async () => {
    const { service } = fixture();
    const result = await service.getDayEntries({ repartidorId: '94', date: '2026-08-09' }, actor());
    expect(result).toMatchObject({
      repartidorId: '94', date: '2026-08-09', status: 'OPEN',
      totals: { expenses: 12.5, adjustments: -2, bankDeposits: 5 },
    });
    expect(JSON.stringify(result)).not.toMatch(/idempotency|actor|createdBy/i);
  });
});
