'use strict';

const {
  createRepartidorLiquidacionService,
  normalizeDaySnapshot,
} = require('../services/repartidor-liquidacion-service');
const { buildLiquidacionCommand } = require('../services/repartidor-liquidacion-contract');

const validInput = (overrides = {}) => ({
  repartidorId: 'R-17', date: '2026-08-09', idempotencyToken: 'liquidacion-2026-08-09-r17',
  matricula: '1234 ABC', codigoVehiculo: 'FURGON-1', sendEmails: true, ...overrides,
});
const validActor = () => ({ actorId: 'USR-17', actorRole: 'REPARTIDOR' });
const validSnapshot = () => ({
  repartidorId: 'R-17', date: '2026-08-09',
  deliveries: [{ id: 'ENT-1', amount: 25, status: 'PARCIAL', pendingAmount: 2 }],
  payments: [{ id: 'COB-1', amount: 20, paymentMethod: 'EF', collectedAt: '2026-08-09T10:00:00Z' }, { id: 'COB-2', amount: 5, paymentMethod: 'TJ', collectedAt: '2026-08-09T10:02:00Z' }],
  expenses: [{ id: 'GAS-1', amount: 3, category: 'PEAJE' }],
  adjustments: [{ id: 'ADJ-1', amount: 1, signedAmount: -1, reason: 'DIFERENCIA' }],
  bankDeposits: [{ id: 'ING-1', amount: 4 }],
  pending: [{ id: 'PEN-1', amount: 2, reason: 'CLIENTE_AUSENTE' }],
  openingBalance: 4,
  breakdown: { deliveries: 25, payments: 25, expenses: 3, adjustments: -1, bankDeposits: 4, pending: 2 },
  // Solo efectivo (20) arrastra deuda: 4 + 20 - 3 - 1 - 4 = 16
  balance: 16,
});

function transactionalRepository({ replay = null, locked = false, snapshot = validSnapshot(), on = () => {}, capabilityError } = {}) {
  const transaction = {
    getByIdempotencyToken: jest.fn(async (token) => { on('replay', token); return replay; }),
    lockDay: jest.fn(async (input) => { on('lock', input); return locked; }),
    deriveDaySnapshot: jest.fn(async (input) => { on('derive', input); return snapshot; }),
    insertOperation: jest.fn(async (input) => { on('ops', input); return { id: 'OPS-9', numeroLiquidacion: 73 }; }),
    markCobrosLiquidated: jest.fn(async (input) => { on('cobros', input); }),
    markExpensesLiquidated: jest.fn(async (input) => { on('expenses', input); }),
    markAdjustmentsLiquidated: jest.fn(async (input) => { on('adjustments', input); }),
    markBankDepositsLiquidated: jest.fn(async (input) => { on('bankDeposits', input); }),
    updateBalance: jest.fn(async (input) => { on('balance', input); }),
    appendAudit: jest.fn(async (input) => { on('audit', input); }),
    enqueueEmailOutbox: jest.fn(async (input) => { on('outbox', input); }),
  };
  return { transaction, repository: {
    assertCapabilities: jest.fn(async () => { if (capabilityError) throw capabilityError; }),
    withTransaction: jest.fn(async (callback) => callback(transaction)),
  } };
}

function expectError(promise, code, statusCode) {
  return expect(promise).rejects.toMatchObject({ code, statusCode });
}

describe('repartidor-liquidacion-service', () => {
  test('preflight capabilities ocurre antes de abrir la transaccion', async () => {
    const error = Object.assign(new Error('schema missing'), { code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503 });
    const { repository } = transactionalRepository({ capabilityError: error });
    await expect(createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor())).rejects.toBe(error);
    expect(repository.assertCapabilities).toHaveBeenCalledTimes(1);
    expect(repository.withTransaction).not.toHaveBeenCalled();
    expect(repository.assertCapabilities).toHaveBeenCalledWith(expect.objectContaining({
      requiredTransactionMethods: expect.any(Array),
      requiresOutbox: true,
    }));
  });

  test('ejecuta cierre atomico con OPS canonico, marcas exactas, actor y outbox durable', async () => {
    const calls = [];
    const { repository, transaction } = transactionalRepository({ on: (name) => calls.push(name) });
    const result = await createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor());
    expect(calls).toEqual(['replay', 'lock', 'derive', 'ops', 'cobros', 'expenses', 'adjustments', 'bankDeposits', 'balance', 'audit', 'outbox']);
    expect(transaction.insertOperation.mock.calls[0][0]).toMatchObject({ idempotencyToken: validInput().idempotencyToken });
    expect(transaction.markCobrosLiquidated.mock.calls[0][0].cobroIds).toEqual(['COB-1', 'COB-2']);
    expect(transaction.markExpensesLiquidated.mock.calls[0][0].ids).toEqual(['GAS-1']);
    expect(transaction.markAdjustmentsLiquidated.mock.calls[0][0].ids).toEqual(['ADJ-1']);
    expect(transaction.markBankDepositsLiquidated.mock.calls[0][0].ids).toEqual(['ING-1']);
    expect(transaction.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'USR-17', actorRole: 'REPARTIDOR' }));
    expect(transaction.enqueueEmailOutbox).toHaveBeenCalledWith(expect.objectContaining({ liquidacionId: 'OPS-9' }));
    expect(result.outboxIntent).toMatchObject({ type: 'REPARTIDOR_LIQUIDACION_EMAIL', liquidacionId: 'OPS-9' });
  });

  test('persiste los identificadores de cobro que el PDF cerrado debe reproducir', async () => {
    const snapshot = validSnapshot();
    snapshot.payments[0] = {
      ...snapshot.payments[0], codigoCliente: '4300040696',
      nombreCliente: 'LINARES ROMAN CARLOS ANDRES', tipoDocumento: 'FAC', documento: 'F 000 006290',
    };
    const { repository, transaction } = transactionalRepository({ snapshot });

    await createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor());

    expect(transaction.insertOperation).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({ payments: [expect.objectContaining({
        codigoCliente: '4300040696', nombreCliente: 'LINARES ROMAN CARLOS ANDRES',
        tipoDocumento: 'FAC', documento: 'F 000 006290',
      }), expect.any(Object)] }),
    }));
  });

  test('rechaza metadatos de cobro no textuales antes de escribir el cierre', async () => {
    const snapshot = validSnapshot();
    snapshot.payments[0] = { ...snapshot.payments[0], codigoCliente: { unsafe: true } };
    const { repository, transaction } = transactionalRepository({ snapshot });

    await expectError(createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor()), 'INVALID_LIQUIDACION_SNAPSHOT', 503);
    expect(transaction.insertOperation).not.toHaveBeenCalled();
  });

  test('replay valida identidad antes de derivar, no duplica outbox y proyecta solo allowlist', async () => {
    const command = validInput();
    const replay = {
      id: 'OPS-OLD', marker: buildLiquidacionCommand(command).marker, status: 'CLOSED', idempotencyToken: command.idempotencyToken,
      replayIdentity: { repartidorId: 'R-17', date: command.date, matricula: command.matricula, codigoVehiculo: command.codigoVehiculo },
      snapshot: validSnapshot(), internalToken: 'no-expose', rawSnapshot: { dni: 'no-expose' },
    };
    const { repository, transaction } = transactionalRepository({ replay });
    const result = await createRepartidorLiquidacionService({ repository }).closeDay(command, validActor());
    expect(result).toEqual({ created: false, liquidacion: { id: 'OPS-OLD', marker: buildLiquidacionCommand(command).marker, repartidorId: 'R-17', date: command.date, status: 'CLOSED', snapshot: { deliveries: 25, payments: 25, expenses: 3, adjustments: -1, bankDeposits: 4, pending: 2, openingBalance: 4, balance: 16 } }, outboxId: null, outboxIntent: null });
    expect(JSON.stringify(result)).not.toMatch(/COB-1|dni|internalToken|idempotency/i);
    expect(transaction.deriveDaySnapshot).not.toHaveBeenCalled();
    expect(transaction.enqueueEmailOutbox).not.toHaveBeenCalled();
  });

  test.each([
    ['marker mismatch', { marker: 'LQD_OTHER', status: 'CLOSED' }],
    ['marker over DB2 limit', { marker: 'X'.repeat(31), status: 'CLOSED' }],
    ['not final status', { status: 'OPEN' }],
  ])('replay %s fails closed before business mutations', async (_label, override) => {
    const command = validInput();
    const replay = {
      id: 'OPS-OLD', idempotencyToken: command.idempotencyToken,
      marker: buildLiquidacionCommand(command).marker, status: 'CLOSED',
      replayIdentity: { repartidorId: 'R-17', date: command.date, matricula: command.matricula, codigoVehiculo: command.codigoVehiculo },
      ...override,
    };
    const { repository, transaction } = transactionalRepository({ replay });
    await expectError(createRepartidorLiquidacionService({ repository }).closeDay(command, validActor()), 'LIQUIDACION_CAPABILITY_UNAVAILABLE', 503);
    expect(transaction.lockDay).not.toHaveBeenCalled();
    expect(transaction.deriveDaySnapshot).not.toHaveBeenCalled();
  });

  test('token reutilizado con identidad distinta da 409 antes de mutar', async () => {
    const replay = { id: 'OPS-OLD', idempotencyToken: validInput().idempotencyToken, replayIdentity: { repartidorId: 'R-99', date: '2026-08-09', matricula: '1234 ABC', codigoVehiculo: 'FURGON-1' } };
    const { repository, transaction } = transactionalRepository({ replay });
    await expectError(createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor()), 'LIQUIDACION_REPLAY_MISMATCH', 409);
    expect(transaction.lockDay).not.toHaveBeenCalled();
  });

  test('mismo repartidor/dia ya cerrado da 409 antes de derivar', async () => {
    const { repository, transaction } = transactionalRepository({ locked: { id: 'OPS-OLD' } });
    await expectError(createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor()), 'LIQUIDACION_DAY_ALREADY_CLOSED', 409);
    expect(transaction.deriveDaySnapshot).not.toHaveBeenCalled();
  });

  test.each([
    ['actor missing', validSnapshot(), undefined, 'LIQUIDACION_ACTOR_REQUIRED', 401],
    ['actor object', validSnapshot(), { actorId: {}, actorRole: 'REPARTIDOR' }, 'LIQUIDACION_ACTOR_REQUIRED', 401],
    ['missing metadata', { ...validSnapshot(), repartidorId: undefined }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['metadata mismatch', { ...validSnapshot(), date: '2026-08-10' }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['missing expenses', { ...validSnapshot(), expenses: undefined }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['missing adjustments', { ...validSnapshot(), adjustments: undefined }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['missing pending', { ...validSnapshot(), pending: undefined }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['duplicate payment', { ...validSnapshot(), payments: [{ id: 'COB-1', amount: 1, paymentMethod: 'EF', collectedAt: '2026-08-09T10:00:00Z' }, { id: 'COB-1', amount: 2, paymentMethod: 'EF', collectedAt: '2026-08-09T10:02:00Z' }] }, validActor(), 'DUPLICATE_LIQUIDACION_SNAPSHOT_ID', 503],
    ['negative expense', { ...validSnapshot(), expenses: [{ id: 'GAS', amount: -1, category: 'X' }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['null expense', { ...validSnapshot(), expenses: [{ id: 'GAS', amount: null, category: 'X' }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['array payment amount', { ...validSnapshot(), payments: [{ id: 'COB', amount: [25], paymentMethod: 'EF', collectedAt: '2026-08-09T10:00:00Z' }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['array breakdown amount', { ...validSnapshot(), breakdown: { ...validSnapshot().breakdown, payments: [25] } }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['blank payment', { ...validSnapshot(), payments: [{ id: 'COB', amount: ' ', paymentMethod: 'EF', collectedAt: '2026-08-09T10:00:00Z' }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['invalid ISO payment time', { ...validSnapshot(), payments: [{ id: 'COB', amount: 1, paymentMethod: 'EF', collectedAt: '2026-08-09' }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['impossible ISO payment date', { ...validSnapshot(), payments: [{ id: 'COB', amount: 1, paymentMethod: 'EF', collectedAt: '2026-02-30T10:00:00Z' }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['invalid delivery status', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 1, status: 'PENDIENTE', pendingAmount: 0 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['delivered with pending', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 1, status: 'ENTREGADA', pendingAmount: 1 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['delivered without delivered amount', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 0, status: 'ENTREGADA', pendingAmount: 0 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['partial without delivered amount', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 0, status: 'PARCIAL', pendingAmount: 1 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['partial without pending', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 1, status: 'PARCIAL', pendingAmount: 0 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['not delivered with amount', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 1, status: 'NO_REALIZADA', pendingAmount: 1 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['not delivered without pending', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 0, status: 'NO_REALIZADA', pendingAmount: 0 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['rejected with delivered amount', { ...validSnapshot(), deliveries: [{ id: 'ENT', amount: 1, status: 'RECHAZADA', pendingAmount: 1 }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['pending detail mismatch', { ...validSnapshot(), pending: [{ id: 'PEN-1', amount: 3, reason: 'CLIENTE_AUSENTE' }], breakdown: { ...validSnapshot().breakdown, pending: 3 } }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['nonfinite payment', { ...validSnapshot(), payments: [{ id: 'COB', amount: Infinity, paymentMethod: 'EF', collectedAt: 'x' }] }, validActor(), 'INVALID_LIQUIDACION_SNAPSHOT', 503],
    ['object operation id', validSnapshot(), validActor(), 'LIQUIDACION_CAPABILITY_UNAVAILABLE', 503, { id: {} }],
  // Rest parameters intentionally keep Jest from interpreting a sixth callback
  // parameter as its `done` callback when a table row has five data values.
  ])('%s fails before durable mutation', async (...row) => {
    const [_label, snapshot, actor, code, statusCode, operation] = row;
    const { repository, transaction } = transactionalRepository({ snapshot });
    if (operation) transaction.insertOperation.mockResolvedValue(operation);
    await expectError(createRepartidorLiquidacionService({ repository }).closeDay(validInput(), actor), code, statusCode);
    if (actor) {
      if (!operation) expect(transaction.insertOperation).not.toHaveBeenCalled();
      expect(transaction.markCobrosLiquidated).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['array', [25]],
    ['object', { value: 25 }],
    ['null', null],
    ['boolean', true],
    ['blank string', '   '],
  ])('rechaza importe %s del snapshot sin mutaciones durables', async (_label, amount) => {
    const snapshot = {
      ...validSnapshot(),
      expenses: [{ id: 'GAS-INVALID', amount, category: 'PEAJE' }],
    };
    const { repository, transaction } = transactionalRepository({ snapshot });
    await expectError(
      createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor()),
      'INVALID_LIQUIDACION_SNAPSHOT',
      503,
    );
    expect(transaction.insertOperation).not.toHaveBeenCalled();
    expect(transaction.markCobrosLiquidated).not.toHaveBeenCalled();
  });

  test('outbox capability fails in preflight before a transaction starts', async () => {
    const error = Object.assign(new Error('outbox unavailable'), {
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
    });
    const repository = {
      assertCapabilities: jest.fn(async ({ requiresOutbox }) => {
        if (requiresOutbox) throw error;
      }),
      withTransaction: jest.fn(),
    };
    await expect(createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor())).rejects.toBe(error);
    expect(repository.assertCapabilities).toHaveBeenCalledWith(expect.objectContaining({ requiresOutbox: true }));
    expect(repository.withTransaction).not.toHaveBeenCalled();
  });

  test('capacidad outbox ausente falla dentro de tx antes de replay/mutaciones', async () => {
    const { repository, transaction } = transactionalRepository();
    delete transaction.enqueueEmailOutbox;
    await expectError(createRepartidorLiquidacionService({ repository }).closeDay(validInput(), validActor()), 'LIQUIDACION_CAPABILITY_UNAVAILABLE', 503);
    expect(transaction.getByIdempotencyToken).not.toHaveBeenCalled();
  });

  test('sendEmails false no escribe outbox y no exige su puerto', async () => {
    const { repository, transaction } = transactionalRepository();
    delete transaction.enqueueEmailOutbox;
    const result = await createRepartidorLiquidacionService({ repository }).closeDay(validInput({ sendEmails: false }), validActor());
    expect(result.outboxIntent).toBeNull();
    expect(transaction.enqueueEmailOutbox).toBeUndefined();
  });

  test('sendEmails ausente usa el default seguro false', async () => {
    const { repository, transaction } = transactionalRepository();
    delete transaction.enqueueEmailOutbox;
    const input = validInput();
    delete input.sendEmails;
    const result = await createRepartidorLiquidacionService({ repository }).closeDay(input, validActor());
    expect(result.outboxIntent).toBeNull();
    expect(repository.assertCapabilities).toHaveBeenCalledWith(expect.objectContaining({ requiresOutbox: false }));
  });

  test('el saldo baja si se ingresa de mas y sube si se ingresa de menos (solo efectivo)', () => {
    const command = buildLiquidacionCommand(validInput({ sendEmails: false }));
    const under = normalizeDaySnapshot({
      ...validSnapshot(),
      bankDeposits: [{ id: 'ING-1', amount: 1 }],
      breakdown: { deliveries: 25, payments: 25, expenses: 3, adjustments: -1, bankDeposits: 1, pending: 2 },
      balance: 19,
    }, command);
    const over = normalizeDaySnapshot({
      ...validSnapshot(),
      bankDeposits: [{ id: 'ING-1', amount: 40 }],
      breakdown: { deliveries: 25, payments: 25, expenses: 3, adjustments: -1, bankDeposits: 40, pending: 2 },
      balance: -20,
    }, command);
    expect(under.balance).toBe(19);
    expect(over.balance).toBe(-20);
  });

  test('los datos derivados del cliente siguen prohibidos y rollback queda delegado al repositorio', async () => {
    const { repository } = transactionalRepository();
    await expectError(createRepartidorLiquidacionService({ repository }).closeDay({ ...validInput(), totals: { payments: 1 } }, validActor()), 'CLIENT_DERIVED_TOTALS_FORBIDDEN', 422);
    const rootError = new Error('transaction rolled back');
    const failing = { assertCapabilities: jest.fn(async () => {}), withTransaction: jest.fn(async () => { throw rootError; }) };
    await expect(createRepartidorLiquidacionService({ repository: failing }).closeDay(validInput(), validActor())).rejects.toBe(rootError);
  });
});
