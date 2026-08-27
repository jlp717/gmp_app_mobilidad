'use strict';

const repository = require('../repositories/repartidor-rutero-orden-db2-repository');
const dayMoveRepository = require('../repositories/repartidor-rutero-day-move-db2-repository');
const { parseRouteDate, normalizeOrdenPayload } = require('./repartidor-rutero-orden-service');

function invalid(code, statusCode = 422) {
  return Object.assign(new Error(code), { code, statusCode });
}

function requireDate(value) {
  const date = parseRouteDate(value);
  if (!date) throw invalid('DATE_INVALID');
  return date;
}

async function readOrder(repartidorId, rawDate) {
  return repository.readOrderState(repartidorId, requireDate(rawDate));
}

async function saveOrder(repartidorId, body, updatedBy) {
  const date = requireDate(body.date);
  const parsed = normalizeOrdenPayload(body.orden);
  if (parsed.error) throw invalid(parsed.error);
  // Never manufacture a revision and overwrite another session's work.
  if (typeof body.baseRevision !== 'string' || !body.baseRevision.trim()) {
    throw invalid('RUTERO_ORDER_REVISION_REQUIRED');
  }
  if (body.baseRevision.length > 131072) throw invalid('RUTERO_ORDER_REVISION_INVALID');
  // no_retry_reason: CAS is authoritative. After a lost response, read the
  // saved order before retrying; no idempotency header/ledger exists here.
  return repository.replaceOrder(repartidorId, date, parsed.value, updatedBy, body.baseRevision);
}

function monday(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function validateDayMove(body) {
  const date = requireDate(body.sourceDate ?? body.date);
  const targetDate = requireDate(body.targetDate);
  if (date === targetDate) throw invalid('RUTERO_MOVE_SAME_DAY');
  if (monday(date) !== monday(targetDate)) throw invalid('RUTERO_MOVE_OUTSIDE_WEEK');
  const parsed = normalizeOrdenPayload(body.orden);
  if (parsed.error) throw invalid(parsed.error);
  if (!Number.isInteger(body.position) || body.position < 0 || body.position >= 500) {
    throw invalid('POSICION_INVALID');
  }
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
    throw invalid('RUTERO_MOVE_IDEMPOTENCY_REQUIRED');
  }
  return {
    sourceDate: date,
    targetDate,
    orden: parsed.value,
    position: body.position,
    idempotencyKey,
  };
}

async function moveDay(repartidorId, body, updatedBy) {
  const parsed = validateDayMove(body);
  try {
    return await dayMoveRepository.moveDocuments({
      repartidorId,
      sourceDate: parsed.sourceDate,
      targetDate: parsed.targetDate,
      position: parsed.position,
      documents: parsed.orden,
      updatedBy,
      idempotencyKey: parsed.idempotencyKey,
    });
  } catch (error) {
    if (error?.statusCode) throw error;
    throw invalid('RUTERO_DAY_MOVE_UNAVAILABLE', 503);
  }
}

module.exports = { readOrder, saveOrder, validateDayMove, moveDay };
