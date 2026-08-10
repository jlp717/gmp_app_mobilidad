'use strict';

const crypto = require('crypto');

const LIQUIDACION_MARKER_MAX_LENGTH = 30;
const IDEMPOTENCY_TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const REPARTIDOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const VEHICLE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,10}$/;
const MATRICULA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{2,18}[A-Za-z0-9]$/;
const ALLOWED_FIELDS = new Set([
  'repartidorId',
  'date',
  'idempotencyToken',
  'matricula',
  'codigoVehiculo',
  'sendEmails',
]);
const DERIVED_FIELD_PATTERN = /(total|gasto|ajuste|efectivo|cheque|tarjeta|postdat|saldo|importe|cantidad|precio|client.?derived|entrega|ingreso|cobro)/i;

class LiquidacionContractError extends Error {
  constructor(message, { code = 'INVALID_LIQUIDACION_PAYLOAD', statusCode = 422, details } = {}) {
    super(message);
    this.name = 'LiquidacionContractError';
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePattern(value, { field, code, pattern }) {
  const normalized = normalizeText(value).toUpperCase();
  if (!pattern.test(normalized)) {
    throw new LiquidacionContractError(`${field} invalido`, { code });
  }
  return normalized;
}

function normalizeBusinessDate(value) {
  const date = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new LiquidacionContractError('date debe tener formato YYYY-MM-DD', {
      code: 'INVALID_LIQUIDACION_DATE',
    });
  }
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new LiquidacionContractError('date no es una fecha de negocio valida', {
      code: 'INVALID_LIQUIDACION_DATE',
    });
  }
  return date;
}

function normalizeIdempotencyToken(value) {
  const token = normalizeText(value);
  if (!token) {
    throw new LiquidacionContractError('idempotencyToken es obligatorio', {
      code: 'IDEMPOTENCY_TOKEN_REQUIRED',
      statusCode: 400,
    });
  }
  if (!IDEMPOTENCY_TOKEN_PATTERN.test(token)) {
    throw new LiquidacionContractError('idempotencyToken invalido', {
      code: 'INVALID_IDEMPOTENCY_TOKEN',
    });
  }
  return token;
}

function rejectUnknownOrDerivedFields(input) {
  for (const key of Object.keys(input)) {
    if (ALLOWED_FIELDS.has(key)) continue;
    if (Array.isArray(input[key]) || DERIVED_FIELD_PATTERN.test(key)) {
      throw new LiquidacionContractError('Los totales y operaciones se derivan exclusivamente en el servidor', {
        code: 'CLIENT_DERIVED_TOTALS_FORBIDDEN',
      });
    }
    throw new LiquidacionContractError(`Campo no permitido: ${key}`, {
      code: 'UNKNOWN_LIQUIDACION_FIELD',
    });
  }
}

function buildReplayIdentity(command) {
  return {
    repartidorId: command.repartidorId,
    date: command.date,
    matricula: command.matricula,
    codigoVehiculo: command.codigoVehiculo,
  };
}

function buildLiquidacionMarker({ repartidorId, date, idempotencyToken }) {
  const digest = crypto
    .createHash('sha256')
    .update(`${repartidorId}\u0000${date}\u0000${idempotencyToken}`, 'utf8')
    .digest('hex');
  return `LQD_${digest.slice(0, LIQUIDACION_MARKER_MAX_LENGTH - 4)}`;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function buildLiquidacionCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new LiquidacionContractError('Payload de liquidacion invalido');
  }
  rejectUnknownOrDerivedFields(input);

  const command = {
    repartidorId: normalizePattern(input.repartidorId, {
      field: 'repartidorId', code: 'INVALID_REPARTIDOR_ID', pattern: REPARTIDOR_ID_PATTERN,
    }),
    date: normalizeBusinessDate(input.date),
    idempotencyToken: normalizeIdempotencyToken(input.idempotencyToken),
    matricula: input.matricula === undefined ? undefined : normalizePattern(input.matricula, {
      field: 'matricula', code: 'INVALID_MATRICULA', pattern: MATRICULA_PATTERN,
    }),
    codigoVehiculo: input.codigoVehiculo === undefined ? undefined : normalizePattern(input.codigoVehiculo, {
      field: 'codigoVehiculo', code: 'INVALID_CODIGO_VEHICULO', pattern: VEHICLE_CODE_PATTERN,
    }),
    sendEmails: input.sendEmails === undefined ? true : input.sendEmails,
  };

  if (typeof command.sendEmails !== 'boolean') {
    throw new LiquidacionContractError('sendEmails debe ser booleano', {
      code: 'INVALID_SEND_EMAILS',
    });
  }
  command.marker = buildLiquidacionMarker(command);
  command.replayIdentity = buildReplayIdentity(command);
  return deepFreeze(command);
}

function replayComparable(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiquidacionContractError('Identidad de replay invalida', {
      code: 'INVALID_LIQUIDACION_REPLAY_IDENTITY',
    });
  }
  const identity = value.replayIdentity;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new LiquidacionContractError('Identidad de replay incompleta', {
      code: 'INVALID_LIQUIDACION_REPLAY_IDENTITY',
    });
  }
  const expectedKeys = ['repartidorId', 'date', 'matricula', 'codigoVehiculo'];
  if (Object.keys(identity).some((key) => !expectedKeys.includes(key))) {
    throw new LiquidacionContractError('Identidad de replay contiene campos no permitidos', {
      code: 'INVALID_LIQUIDACION_REPLAY_IDENTITY',
    });
  }

  return {
    idempotencyToken: normalizeIdempotencyToken(value.idempotencyToken),
    repartidorId: normalizePattern(identity.repartidorId, {
      field: 'repartidorId', code: 'INVALID_LIQUIDACION_REPLAY_IDENTITY', pattern: REPARTIDOR_ID_PATTERN,
    }),
    date: normalizeBusinessDate(identity.date),
    matricula: identity.matricula === undefined ? undefined : normalizePattern(identity.matricula, {
      field: 'matricula', code: 'INVALID_LIQUIDACION_REPLAY_IDENTITY', pattern: MATRICULA_PATTERN,
    }),
    codigoVehiculo: identity.codigoVehiculo === undefined ? undefined : normalizePattern(identity.codigoVehiculo, {
      field: 'codigoVehiculo', code: 'INVALID_LIQUIDACION_REPLAY_IDENTITY', pattern: VEHICLE_CODE_PATTERN,
    }),
  };
}

function assertReplayCompatible(existing, incoming) {
  const left = replayComparable(existing);
  const right = replayComparable(incoming);
  const matches = left.idempotencyToken === right.idempotencyToken
    && left.repartidorId === right.repartidorId
    && left.date === right.date
    && left.matricula === right.matricula
    && left.codigoVehiculo === right.codigoVehiculo;
  if (!matches) {
    throw new LiquidacionContractError('La clave de idempotencia ya pertenece a otra liquidacion', {
      code: 'LIQUIDACION_REPLAY_MISMATCH',
      statusCode: 409,
    });
  }
  return true;
}

module.exports = {
  LiquidacionContractError,
  LIQUIDACION_MARKER_MAX_LENGTH,
  buildLiquidacionCommand,
  buildLiquidacionMarker,
  buildReplayIdentity,
  assertReplayCompatible,
};
