'use strict';

const {
  LIQUIDACION_MARKER_MAX_LENGTH,
  buildLiquidacionCommand,
  assertReplayCompatible,
} = require('./repartidor-liquidacion-contract');
const {
  computeClosingBalance,
  sumCashPayments,
} = require('./liquidacion-pdf-service');

class LiquidacionApplicationError extends Error {
  constructor(message, { code = 'LIQUIDACION_APPLICATION_ERROR', statusCode = 409, details } = {}) {
    super(message);
    this.name = 'LiquidacionApplicationError';
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

const REQUIRED_TRANSACTION_METHODS = Object.freeze([
  'getByIdempotencyToken', 'lockDay', 'deriveDaySnapshot', 'insertOperation',
  'markCobrosLiquidated', 'markExpensesLiquidated', 'markAdjustmentsLiquidated',
  'markBankDepositsLiquidated', 'updateBalance', 'appendAudit',
]);
const ENTRY_TRANSACTION_METHODS = Object.freeze([
  'lockBalance', 'getStructuredEntryByToken', 'isDayClosed',
  'insertStructuredEntry', 'listStructuredEntries',
]);
const MANAGER_ROLES = new Set(['JEFE_VENTAS', 'ADMIN']);
const ENTRY_CONFIG = Object.freeze({
  EXPENSE: Object.freeze({ detail: 'category', maxLength: 40, positive: true }),
  ADJUSTMENT: Object.freeze({ detail: 'reason', maxLength: 120, positive: false }),
  BANK_DEPOSIT: Object.freeze({ detail: 'reference', maxLength: 80, positive: true }),
});

function capabilityError(message, details) {
  return new LiquidacionApplicationError(message, {
    code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503, details,
  });
}

function invalidSnapshot(message, details) {
  return new LiquidacionApplicationError(message, {
    code: 'INVALID_LIQUIDACION_SNAPSHOT', statusCode: 503, details,
  });
}

function invalidEntry(message, details) {
  return new LiquidacionApplicationError(message, {
    code: 'INVALID_LIQUIDACION_ENTRY', statusCode: 422, details,
  });
}

function assertRepository(repository) {
  if (!repository || typeof repository.withTransaction !== 'function'
      || typeof repository.assertCapabilities !== 'function') {
    throw capabilityError('El repositorio transaccional de liquidacion no esta disponible');
  }
}

function assertTransaction(transaction, { requiresOutbox }) {
  const required = requiresOutbox
    ? [...REQUIRED_TRANSACTION_METHODS, 'enqueueEmailOutbox']
    : REQUIRED_TRANSACTION_METHODS;
  const missing = required.filter((name) => typeof transaction?.[name] !== 'function');
  if (missing.length) {
    throw capabilityError('Faltan capacidades transaccionales para liquidacion', { missing });
  }
}

function assertEntryTransaction(transaction) {
  const missing = ENTRY_TRANSACTION_METHODS
    .filter((name) => typeof transaction?.[name] !== 'function');
  if (missing.length) {
    throw capabilityError('Faltan capacidades transaccionales para entradas de liquidacion', { missing });
  }
}

function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function strictEntryAmount(value, { positive }) {
  const cents = typeof value === 'number' && Number.isFinite(value)
    ? value * 100 : Number.NaN;
  if (!Number.isFinite(cents) || Math.abs(value) > 99999999
      || Math.abs(cents - Math.round(cents)) > 0.000001
      || (positive ? value <= 0 : value === 0)) {
    throw invalidEntry(positive
      ? 'amount debe ser un numero positivo con maximo dos decimales'
      : 'amount debe ser un numero firmado no cero con maximo dos decimales');
  }
  return value;
}

function strictEntryText(value, field, maxLength, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw invalidEntry(`${field} debe ser texto no vacio de hasta ${maxLength} caracteres`);
  }
  return value.trim();
}

function normalizeEntryInput(type, input) {
  const config = ENTRY_CONFIG[type];
  if (!config || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidEntry('La entrada de liquidacion no es valida');
  }
  const allowed = new Set([
    'repartidorId', 'date', 'amount', 'idempotencyToken', config.detail, 'observation',
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw invalidEntry('La entrada contiene campos no permitidos', { fields: unknown });
  if (typeof input.repartidorId !== 'string' || !/^\d{1,20}$/.test(input.repartidorId.trim())) {
    throw invalidEntry('repartidorId debe ser un codigo numerico');
  }
  if (!realDate(input.date)) throw invalidEntry('date debe ser una fecha real YYYY-MM-DD');
  if (typeof input.idempotencyToken !== 'string'
      || !/^[A-Za-z0-9_.:-]{8,128}$/.test(input.idempotencyToken.trim())) {
    throw invalidEntry('idempotencyToken debe tener entre 8 y 128 caracteres seguros');
  }
  return Object.freeze({
    type,
    repartidorId: input.repartidorId.trim(),
    date: input.date,
    amount: strictEntryAmount(input.amount, config),
    [config.detail]: strictEntryText(input[config.detail], config.detail, config.maxLength),
    observation: strictEntryText(input.observation, 'observation', 250, { optional: true }),
    idempotencyToken: input.idempotencyToken.trim(),
  });
}

function normalizeDayEntryQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['repartidorId', 'date'].includes(key))) {
    throw invalidEntry('La consulta diaria de liquidacion no es valida');
  }
  const rawSelector = typeof input.repartidorId === 'string' ? input.repartidorId.trim() : '';
  const repartidorIds = rawSelector.split(',').map((item) => item.trim()).filter(Boolean);
  if (!repartidorIds.length || repartidorIds.length > 100
      || repartidorIds.some((item) => !/^\d{1,20}$/.test(item))) {
    throw invalidEntry('repartidorId debe contener codigos numericos concretos');
  }
  if (!realDate(input.date)) throw invalidEntry('date debe ser una fecha real YYYY-MM-DD');
  return Object.freeze({
    repartidorId: [...new Set(repartidorIds)].join(','),
    date: input.date,
  });
}

function comparableCode(value) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

function authorizeEntry(command, actor, { adjustment = false } = {}) {
  const role = actor.actorRole.trim().toUpperCase();
  if (adjustment && !MANAGER_ROLES.has(role)) {
    throw new LiquidacionApplicationError('Solo JEFE_VENTAS o ADMIN puede crear ajustes', {
      code: 'LIQUIDACION_ADJUSTMENT_ROLE_REQUIRED', statusCode: 403,
    });
  }
  if (MANAGER_ROLES.has(role)) return Object.freeze({ ...actor, actorRole: role });
  if (role !== 'REPARTIDOR'
      || comparableCode(actor.actorId) !== comparableCode(command.repartidorId)) {
    throw new LiquidacionApplicationError('No tienes permisos sobre este repartidor', {
      code: 'LIQUIDACION_ENTRY_FORBIDDEN', statusCode: 403,
    });
  }
  return Object.freeze({ ...actor, actorRole: role });
}

function scalarId(value) {
  if (value == null) return '';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.toString === 'function') {
      const text = value.toString();
      if (text && text !== '[object Object]') return text.trim();
    }
    if (value.low != null) return String(value.low);
    return '';
  }
  return String(value).trim();
}

function normalizedIdentifier(value, field) {
  const normalized = scalarId(value);
  if (!normalized) throw invalidSnapshot(`${field} es obligatorio en el snapshot del servidor`);
  return normalized;
}

function normalizedText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw invalidSnapshot(`${field} es obligatorio`);
  return value.trim();
}

function normalizedAmount(value, field, { nonNegative = false } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string')
      || value == null || typeof value === 'boolean'
      || (typeof value === 'string' && !value.trim())) {
    throw invalidSnapshot(`${field} debe ser un importe finito${nonNegative ? ' no negativo' : ''}`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || (nonNegative && amount < 0)) {
    throw invalidSnapshot(`${field} debe ser un importe finito${nonNegative ? ' no negativo' : ''}`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function uniqueEntries(value, field, normalize) {
  if (!Array.isArray(value)) throw invalidSnapshot(`${field} debe ser una lista derivada por el servidor`);
  const identifiers = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidSnapshot(`${field}[${index}] es invalido`);
    }
    const id = normalizedIdentifier(entry.id, `${field}[${index}].id`);
    if (identifiers.has(id)) {
      throw new LiquidacionApplicationError(`${field} contiene identificadores duplicados`, {
        code: 'DUPLICATE_LIQUIDACION_SNAPSHOT_ID', statusCode: 503, details: { field, id },
      });
    }
    identifiers.add(id);
    return Object.freeze(normalize(entry, id, index));
  });
}

function total(entries, field = 'amount') {
  return Math.round((entries.reduce((sum, entry) => sum + entry[field], 0) + Number.EPSILON) * 100) / 100;
}

function equalMoney(left, right) {
  return Math.abs(left - right) < 0.00001;
}

function normalizeDeliveryStatus(value, field) {
  const status = normalizedText(value, field).toUpperCase();
  if (!['ENTREGADA', 'PARCIAL', 'NO_REALIZADA', 'RECHAZADA'].includes(status)) {
    throw invalidSnapshot(`${field} no es un estado de reparto permitido`);
  }
  return status;
}

function normalizeIsoDateTime(value, field) {
  const text = normalizedText(value, field);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
  if (!match) {
    throw invalidSnapshot(`${field} debe ser una fecha ISO-8601 con zona horaria`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '0', offsetSign, offsetHourText = '0', offsetMinuteText = '0'] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText,
  ].map(Number);
  const millisecond = Number(fraction.padEnd(3, '0'));
  const civil = new Date(0);
  civil.setUTCFullYear(year, month - 1, day);
  civil.setUTCHours(hour, minute, second, millisecond);
  const impossibleCivilDate = civil.getUTCFullYear() !== year
    || civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day
    || civil.getUTCHours() !== hour || civil.getUTCMinutes() !== minute
    || civil.getUTCSeconds() !== second || civil.getUTCMilliseconds() !== millisecond;
  const impossibleOffset = offsetMinute > 59 || offsetHour > 14
    || (offsetHour === 14 && offsetMinute !== 0) || (!offsetSign && text.slice(-1) !== 'Z');
  if (impossibleCivilDate || impossibleOffset || Number.isNaN(Date.parse(text))) {
    throw invalidSnapshot(`${field} debe ser una fecha ISO-8601 real con zona horaria`);
  }
  return text;
}

function normalizeOptionalPaymentMetadata(value, field, maxLength) {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw invalidSnapshot(`${field} debe ser texto cuando se informe`);
  }
  const text = value.trim();
  if (!text) return '';
  if (text.length > maxLength || /[\u0000-\u001F\u007F]/.test(text)) {
    throw invalidSnapshot(`${field} excede el formato permitido`);
  }
  return text;
}

function normalizeDaySnapshot(snapshot, command) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw invalidSnapshot('El snapshot de liquidacion no esta disponible');
  }
  if (normalizedIdentifier(snapshot.repartidorId, 'snapshot.repartidorId') !== command.repartidorId
      || normalizedText(snapshot.date, 'snapshot.date') !== command.date) {
    throw invalidSnapshot('El snapshot no pertenece al repartidor y fecha solicitados');
  }

  const deliveries = uniqueEntries(snapshot.deliveries, 'deliveries', (entry, id, index) => {
    const amount = normalizedAmount(entry.amount, `deliveries[${index}].amount`, { nonNegative: true });
    const status = normalizeDeliveryStatus(entry.status, `deliveries[${index}].status`);
    const pendingAmount = normalizedAmount(entry.pendingAmount, `deliveries[${index}].pendingAmount`, { nonNegative: true });
    const validAmounts = (status === 'ENTREGADA' && amount > 0 && pendingAmount === 0)
      || (status === 'PARCIAL' && amount > 0 && pendingAmount > 0)
      || (['NO_REALIZADA', 'RECHAZADA'].includes(status) && amount === 0 && pendingAmount > 0);
    if (!validAmounts) {
      throw invalidSnapshot(`deliveries[${index}] no es coherente con su estado final`);
    }
    return { id, amount, status, pendingAmount };
  });
  const payments = uniqueEntries(snapshot.payments, 'payments', (entry, id, index) => ({
    id,
    amount: normalizedAmount(entry.amount, `payments[${index}].amount`, { nonNegative: true }),
    paymentMethod: normalizedText(entry.paymentMethod, `payments[${index}].paymentMethod`),
    collectedAt: normalizeIsoDateTime(entry.collectedAt, `payments[${index}].collectedAt`),
    codigoCliente: normalizeOptionalPaymentMetadata(entry.codigoCliente, `payments[${index}].codigoCliente`, 30),
    nombreCliente: normalizeOptionalPaymentMetadata(entry.nombreCliente, `payments[${index}].nombreCliente`, 160),
    tipoDocumento: normalizeOptionalPaymentMetadata(entry.tipoDocumento, `payments[${index}].tipoDocumento`, 20),
    documento: normalizeOptionalPaymentMetadata(entry.documento, `payments[${index}].documento`, 120),
  }));
  const expenses = uniqueEntries(snapshot.expenses, 'expenses', (entry, id, index) => ({
    id,
    amount: normalizedAmount(entry.amount, `expenses[${index}].amount`, { nonNegative: true }),
    category: normalizedText(entry.category, `expenses[${index}].category`),
  }));
  const adjustments = uniqueEntries(snapshot.adjustments, 'adjustments', (entry, id, index) => {
    const amount = normalizedAmount(entry.amount, `adjustments[${index}].amount`, { nonNegative: true });
    const signedAmount = normalizedAmount(entry.signedAmount, `adjustments[${index}].signedAmount`);
    if (!equalMoney(Math.abs(signedAmount), amount) || signedAmount === 0) {
      throw invalidSnapshot(`adjustments[${index}] debe expresar un importe firmado exacto`);
    }
    return { id, amount, signedAmount, reason: normalizedText(entry.reason, `adjustments[${index}].reason`) };
  });
  const bankDeposits = uniqueEntries(snapshot.bankDeposits, 'bankDeposits', (entry, id, index) => ({
    id,
    amount: normalizedAmount(entry.amount, `bankDeposits[${index}].amount`, { nonNegative: true }),
  }));
  const pending = uniqueEntries(snapshot.pending, 'pending', (entry, id, index) => ({
    id,
    amount: normalizedAmount(entry.amount, `pending[${index}].amount`, { nonNegative: true }),
    reason: normalizedText(entry.reason, `pending[${index}].reason`),
  }));

  if (!snapshot.breakdown || typeof snapshot.breakdown !== 'object' || Array.isArray(snapshot.breakdown)) {
    throw invalidSnapshot('snapshot.breakdown es obligatorio');
  }
  const deliveryPending = total(deliveries, 'pendingAmount');
  const pendingDetail = total(pending);
  if (!equalMoney(deliveryPending, pendingDetail)) {
    throw invalidSnapshot('pending no coincide con las cantidades pendientes de las entregas');
  }
  const totals = Object.freeze({
    deliveries: total(deliveries), payments: total(payments), expenses: total(expenses),
    adjustments: total(adjustments, 'signedAmount'), bankDeposits: total(bankDeposits),
    pending: deliveryPending,
  });
  for (const [key, amount] of Object.entries(totals)) {
    if (!equalMoney(normalizedAmount(snapshot.breakdown[key], `breakdown.${key}`), amount)) {
      throw invalidSnapshot(`breakdown.${key} no coincide con el detalle derivado`);
    }
  }
  const openingBalance = normalizedAmount(snapshot.openingBalance, 'snapshot.openingBalance');
  const balance = normalizedAmount(snapshot.balance, 'snapshot.balance');
  const cashPayments = sumCashPayments(payments);
  const expectedBalance = computeClosingBalance({
    openingBalance,
    cashPayments,
    expenses: totals.expenses,
    adjustments: totals.adjustments,
    bankDeposits: totals.bankDeposits,
  });
  if (!equalMoney(balance, expectedBalance)) {
    throw invalidSnapshot('snapshot.balance no coincide con el detalle derivado');
  }
  return Object.freeze({
    repartidorId: command.repartidorId,
    date: command.date,
    deliveries: Object.freeze(deliveries), payments: Object.freeze(payments),
    expenses: Object.freeze(expenses), adjustments: Object.freeze(adjustments),
    bankDeposits: Object.freeze(bankDeposits), pending: Object.freeze(pending),
    openingBalance, breakdown: totals, balance,
  });
}

function assertMarker(marker) {
  if (typeof marker !== 'string' || marker.length === 0 || marker.length > LIQUIDACION_MARKER_MAX_LENGTH) {
    throw capabilityError('El marcador de liquidacion excede el limite DB2');
  }
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw new LiquidacionApplicationError('Se requiere un actor autenticado', {
      code: 'LIQUIDACION_ACTOR_REQUIRED', statusCode: 401,
    });
  }
  if ((typeof actor.actorId !== 'string' && typeof actor.actorId !== 'number')
      || (typeof actor.actorId === 'number' && !Number.isFinite(actor.actorId))
      || !String(actor.actorId).trim()
      || String(actor.actorId).trim().length > 40
      || typeof actor.actorRole !== 'string' || !actor.actorRole.trim()
      || actor.actorRole.trim().length > 30) {
    throw new LiquidacionApplicationError('Se requiere un actor autenticado valido', {
      code: 'LIQUIDACION_ACTOR_REQUIRED', statusCode: 401,
    });
  }
  const actorId = String(actor.actorId).trim();
  const actorRole = actor.actorRole.trim();
  return Object.freeze({ actorId, actorRole });
}

function dayConflict() {
  return new LiquidacionApplicationError('El repartidor ya tiene una liquidacion para este dia', {
    code: 'LIQUIDACION_DAY_ALREADY_CLOSED', statusCode: 409,
  });
}

function validOperationId(value) {
  try {
    return normalizedIdentifier(value, 'operationId');
  } catch (_error) {
    throw capabilityError('No se obtuvo un identificador valido de la operacion de liquidacion');
  }
}

function assertReplayState(replay, command) {
  if (typeof replay.marker !== 'string'
      || replay.marker.length === 0
      || replay.marker.length > LIQUIDACION_MARKER_MAX_LENGTH
      || replay.marker !== command.marker
      || replay.status !== 'CLOSED') {
    throw capabilityError('El replay de liquidacion no representa un cierre final verificable');
  }
  return normalizeDaySnapshot(replay.snapshot, command);
}

function numericSummary(snapshot) {
  return Object.freeze({
    deliveries: snapshot.breakdown.deliveries,
    payments: snapshot.breakdown.payments,
    expenses: snapshot.breakdown.expenses,
    adjustments: snapshot.breakdown.adjustments,
    bankDeposits: snapshot.breakdown.bankDeposits,
    pending: snapshot.breakdown.pending,
    openingBalance: snapshot.openingBalance,
    balance: snapshot.balance,
  });
}

function projectLiquidacion({ id, marker, replayIdentity, status, snapshot }) {
  return Object.freeze({
    id: validOperationId(id), marker,
    repartidorId: replayIdentity.repartidorId,
    date: replayIdentity.date, status,
    snapshot: numericSummary(snapshot),
  });
}

function projectStructuredEntry(entry, type) {
  const config = ENTRY_CONFIG[type];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw capabilityError('La entrada persistida no tiene una estructura valida');
  }
  const id = validOperationId(entry.id);
  const repartidorId = String(entry.repartidorId || '').trim();
  const date = String(entry.date || '').trim();
  const amount = Number(entry.amount);
  const status = String(entry.status || '').trim().toUpperCase();
  const createdAt = String(entry.createdAt || '').trim();
  const detail = String(entry[config.detail] || '').trim();
  const observation = entry.observation == null ? undefined : String(entry.observation).trim();
  if (!repartidorId || !realDate(date) || !Number.isFinite(amount) || !detail
      || !['PENDING', 'LIQUIDATED'].includes(status)
      || !createdAt || Number.isNaN(Date.parse(createdAt))) {
    throw capabilityError('La entrada persistida esta corrupta');
  }
  return Object.freeze({
    id, type, repartidorId, date, amount, [config.detail]: detail,
    ...(observation ? { observation } : {}), status, createdAt,
  });
}

function sameEntryIdentity(entry, command) {
  const detail = ENTRY_CONFIG[command.type].detail;
  return entry.repartidorId === command.repartidorId
    && entry.date === command.date
    && entry.amount === command.amount
    && entry[detail] === command[detail]
    && (entry.observation || undefined) === command.observation;
}

function buildOutboxIntent(command, liquidacion) {
  if (!command.sendEmails) return null;
  return Object.freeze({
    type: 'REPARTIDOR_LIQUIDACION_EMAIL', liquidacionId: liquidacion.id,
    status: 'PENDING',
  });
}

async function seedIsolatedTestFinanceCopy({ repartidorId, date }) {
  if (process.env.JEST_WORKER_ID) return;
  try {
    const financeService = require('./repartidor-finance-service');
    if (typeof financeService.ensureIsolatedTestFinanceSeed === 'function') {
      await financeService.ensureIsolatedTestFinanceSeed({ repartidorId, date });
    }
  } catch (_error) {
    // Overlay read remains available if the durable copy fails.
  }
}

function createRepartidorLiquidacionService({ repository } = {}) {
  assertRepository(repository);

  async function createStructuredEntry(type, input, actor) {
    const command = normalizeEntryInput(type, input);
    const authenticatedActor = authorizeEntry(command, normalizeActor(actor), {
      adjustment: type === 'ADJUSTMENT',
    });
    await seedIsolatedTestFinanceCopy({
      repartidorId: command.repartidorId, date: command.date,
    });
    await repository.assertCapabilities({ requiredTransactionMethods: ENTRY_TRANSACTION_METHODS });
    return repository.withTransaction(async (transaction) => {
      assertEntryTransaction(transaction);
      const replay = await transaction.getStructuredEntryByToken({
        type, idempotencyToken: command.idempotencyToken,
      });
      if (replay) {
        const entry = projectStructuredEntry(replay, type);
        if (!sameEntryIdentity(entry, command)) {
          throw new LiquidacionApplicationError('El token pertenece a otra entrada de liquidacion', {
            code: 'LIQUIDACION_ENTRY_REPLAY_MISMATCH', statusCode: 409,
          });
        }
        return Object.freeze({ created: false, entry });
      }

      // The balance row is the per-driver serialization point shared with
      // closeDay. It prevents a PENDING append from slipping behind a CLOSED snapshot.
      await transaction.lockBalance({ repartidorId: command.repartidorId });
      const replayAfterLock = await transaction.getStructuredEntryByToken({
        type, idempotencyToken: command.idempotencyToken,
      });
      if (replayAfterLock) {
        const entry = projectStructuredEntry(replayAfterLock, type);
        if (!sameEntryIdentity(entry, command)) {
          throw new LiquidacionApplicationError('El token pertenece a otra entrada de liquidacion', {
            code: 'LIQUIDACION_ENTRY_REPLAY_MISMATCH', statusCode: 409,
          });
        }
        return Object.freeze({ created: false, entry });
      }
      if (await transaction.isDayClosed(command)) throw dayConflict();
      const persisted = await transaction.insertStructuredEntry({
        ...command, actorId: authenticatedActor.actorId, actorRole: authenticatedActor.actorRole,
      });
      return Object.freeze({ created: true, entry: projectStructuredEntry(persisted, type) });
    });
  }

  async function getDayEntries(input, actor) {
    const query = normalizeDayEntryQuery(input);
    authorizeEntry(query, normalizeActor(actor));
    await repository.assertCapabilities({ requiredTransactionMethods: ['listStructuredEntries'] });
    return repository.withTransaction(async (transaction) => {
      if (typeof transaction?.listStructuredEntries !== 'function') {
        throw capabilityError('Falta la lectura diaria estructurada de liquidacion');
      }
      const repartidorIds = Object.freeze(query.repartidorId.split(','));
      const ledger = await transaction.listStructuredEntries({
        repartidorId: query.repartidorId, repartidorIds, date: query.date,
      });
      if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
        throw capabilityError('El desglose diario persistido no es valido');
      }
      const map = (value, type, field) => {
        if (!Array.isArray(value)) throw capabilityError(`${field} persistido no es una lista`);
        return Object.freeze(value.flatMap((entry) => {
          try {
            return [projectStructuredEntry(entry, type)];
          } catch (_error) {
            return [];
          }
        }));
      };
      const expenses = map(ledger.expenses, 'EXPENSE', 'expenses');
      const adjustments = map(ledger.adjustments, 'ADJUSTMENT', 'adjustments');
      const bankDeposits = map(ledger.bankDeposits, 'BANK_DEPOSIT', 'bankDeposits');
      const sum = (entries) => Math.round((entries.reduce((acc, entry) => acc + entry.amount, 0)
        + Number.EPSILON) * 100) / 100;
      return Object.freeze({
        ...query, status: ledger.closed ? 'CLOSED' : 'OPEN',
        expenses, adjustments, bankDeposits,
        totals: Object.freeze({
          expenses: sum(expenses), adjustments: sum(adjustments), bankDeposits: sum(bankDeposits),
        }),
      });
    });
  }

  async function closeDay(input, actor) {
    const command = buildLiquidacionCommand({ sendEmails: false, ...input });
    const authenticatedActor = normalizeActor(actor);
    assertMarker(command.marker);
    await repository.assertCapabilities({
      requiredTransactionMethods: REQUIRED_TRANSACTION_METHODS,
      requiresOutbox: command.sendEmails,
    });
    await seedIsolatedTestFinanceCopy({
      repartidorId: command.repartidorId, date: command.date,
    });

    const result = await repository.withTransaction(async (transaction) => {
      assertTransaction(transaction, { requiresOutbox: command.sendEmails });
      const replay = await transaction.getByIdempotencyToken(command.idempotencyToken);
      if (replay) {
        assertReplayCompatible(replay, command);
        const snapshot = assertReplayState(replay, command);
        return Object.freeze({
          created: false,
          liquidacion: projectLiquidacion({ ...replay, snapshot }),
        });
      }
      const locked = await transaction.lockDay({ repartidorId: command.repartidorId, date: command.date });
      if (locked) throw dayConflict();
      const snapshot = normalizeDaySnapshot(await transaction.deriveDaySnapshot({
        repartidorId: command.repartidorId, date: command.date,
      }), command);
      // Apply only to new closes: an existing immutable replay remains valid.
      if (snapshot.payments.length === 0) {
        throw new LiquidacionApplicationError(
          'No se puede cerrar la liquidación: no hay cobros en el periodo seleccionado.',
          { code: 'LIQUIDACION_NO_COBROS', statusCode: 409 },
        );
      }
      const cobroIds = Object.freeze(snapshot.payments.map(({ id }) => id));
      const expenseIds = Object.freeze(snapshot.expenses.map(({ id }) => id));
      const adjustmentIds = Object.freeze(snapshot.adjustments.map(({ id }) => id));
      const bankDepositIds = Object.freeze(snapshot.bankDeposits.map(({ id }) => id));
      const operation = await transaction.insertOperation({
        repartidorId: command.repartidorId, date: command.date,
        idempotencyToken: command.idempotencyToken, marker: command.marker,
        replayIdentity: command.replayIdentity, matricula: command.matricula,
        codigoVehiculo: command.codigoVehiculo, snapshot,
        actorId: authenticatedActor.actorId, actorRole: authenticatedActor.actorRole,
      });
      const operationId = validOperationId(operation?.id ?? operation);
      await transaction.markCobrosLiquidated({
        repartidorId: command.repartidorId, date: command.date, cobroIds,
        marker: command.marker, operationId, numeroLiquidacion: operation.numeroLiquidacion,
      });
      await transaction.markExpensesLiquidated({ repartidorId: command.repartidorId, date: command.date,
        ids: expenseIds, marker: command.marker, operationId });
      await transaction.markAdjustmentsLiquidated({ repartidorId: command.repartidorId, date: command.date,
        ids: adjustmentIds, marker: command.marker, operationId });
      await transaction.markBankDepositsLiquidated({ repartidorId: command.repartidorId, date: command.date,
        ids: bankDepositIds, marker: command.marker, operationId });
      await transaction.updateBalance({ repartidorId: command.repartidorId, date: command.date, operationId, snapshot });
      await transaction.appendAudit({
        event: 'REPARTIDOR_LIQUIDACION_CLOSED', repartidorId: command.repartidorId,
        date: command.date, operationId, marker: command.marker,
        actorId: authenticatedActor.actorId, actorRole: authenticatedActor.actorRole,
      });
      const liquidacion = projectLiquidacion({ id: operationId, marker: command.marker,
        replayIdentity: command.replayIdentity, status: 'CLOSED', snapshot });
      let outboxId = null;
      if (command.sendEmails) {
        outboxId = await transaction.enqueueEmailOutbox(buildOutboxIntent(command, liquidacion));
      }
      return Object.freeze({ created: true, liquidacion, outboxId });
    }, { requiresOutbox: command.sendEmails });
    const outboxIntent = result.created ? buildOutboxIntent(command, result.liquidacion) : null;
    return Object.freeze({
      ...result,
      outboxIntent: outboxIntent
        ? Object.freeze({ ...outboxIntent, outboxId: result.outboxId ?? null })
        : null,
      outboxId: result.outboxId ?? null,
    });
  }
  return Object.freeze({
    closeDay,
    createExpense: (input, actor) => createStructuredEntry('EXPENSE', input, actor),
    createAdjustment: (input, actor) => createStructuredEntry('ADJUSTMENT', input, actor),
    createBankDeposit: (input, actor) => createStructuredEntry('BANK_DEPOSIT', input, actor),
    getDayEntries,
  });
}

module.exports = {
  LiquidacionApplicationError, REQUIRED_TRANSACTION_METHODS, ENTRY_TRANSACTION_METHODS,
  createRepartidorLiquidacionService, normalizeDaySnapshot,
};
