'use strict';

const COMMERCIAL_ROLES = new Set(['COMERCIAL', 'JEFE_VENTAS', 'ADMIN']);
const COMMERCIAL_PAYMENT_METHODS = new Set(['CONTADO', 'TJ', 'TR']);
const MAX_PAYMENT_CENTS = 99_999_999_999;

class CommercialPaymentValidationError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'CommercialPaymentValidationError';
    this.code = code;
    this.status = status;
  }
}

function normalizeText(value) {
  return value == null ? '' : String(value).trim();
}

function fail(code, message, status = 400) {
  throw new CommercialPaymentValidationError(code, message, status);
}

function normalizeCommercialActor({ userId, userRole } = {}) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    fail('AUTHENTICATION_REQUIRED', 'Autenticacion requerida', 401);
  }

  const normalizedRole = normalizeText(userRole).toUpperCase();
  if (!COMMERCIAL_ROLES.has(normalizedRole)) {
    fail('FORBIDDEN_COMMERCIAL_ROLE', 'El perfil no puede registrar cobros comerciales', 403);
  }
  return { userId: normalizedUserId, userRole: normalizedRole };
}

function parseAmountCents(value) {
  if (value == null || value === '') {
    fail('INVALID_PAYMENT_AMOUNT', 'El importe debe ser positivo y tener como maximo dos decimales');
  }
  const raw = typeof value === 'number' ? value.toString() : normalizeText(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    fail('INVALID_PAYMENT_AMOUNT', 'El importe debe ser positivo y tener como maximo dos decimales');
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    fail('INVALID_PAYMENT_AMOUNT', 'El importe debe ser positivo y tener como maximo dos decimales');
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_PAYMENT_CENTS) {
    fail('INVALID_PAYMENT_AMOUNT', 'El importe supera el maximo admitido');
  }
  return cents;
}

function normalizePaymentMethod(value) {
  const requested = normalizeText(value).toUpperCase();
  const normalized = requested === 'T0' ? 'TR' : requested;
  if (!COMMERCIAL_PAYMENT_METHODS.has(normalized)) {
    fail('INVALID_PAYMENT_METHOD', 'Forma de cobro invalida: usa Efectivo, Tarjeta o Transferencia');
  }
  return normalized;
}

function normalizeCommercialPaymentInput({
  clientCode,
  reference,
  amount,
  paymentMethod,
  observations,
} = {}) {
  const normalizedClient = normalizeText(clientCode);
  const normalizedReference = normalizeText(reference);
  if (!normalizedClient || !normalizedReference) {
    fail('INVALID_PAYMENT_PAYLOAD', 'Cliente y referencia son obligatorios');
  }

  const normalizedObservations = normalizeText(observations);
  if (!normalizedObservations || normalizedObservations.length > 255) {
    fail('INVALID_PAYMENT_OBSERVATIONS', 'Las observaciones son obligatorias y admiten hasta 255 caracteres');
  }

  const amountCents = parseAmountCents(amount);
  return {
    clientCode: normalizedClient,
    reference: normalizedReference,
    amountCents,
    amount: amountCents / 100,
    paymentMethod: normalizePaymentMethod(paymentMethod),
    observations: normalizedObservations,
  };
}

module.exports = {
  COMMERCIAL_ROLES,
  MAX_PAYMENT_CENTS,
  CommercialPaymentValidationError,
  normalizeCommercialActor,
  normalizeCommercialPaymentInput,
};
