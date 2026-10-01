'use strict';

const MADRID = 'Europe/Madrid';

/**
 * Photos may be added through the same weekday of the following week,
 * inclusive, until 23:59:59 Europe/Madrid.
 *
 * DST follows the EU rule for Europe/Madrid:
 * - Spring forward: last Sunday of March, 02:00 CET becomes 03:00 CEST
 *   (UTC+1 -> UTC+2). The local hour 02:00-02:59 does not exist.
 *   23:59:59 still exists and is CEST (UTC+2).
 * - Fall back: last Sunday of October, 03:00 CEST becomes 02:00 CET
 *   (UTC+2 -> UTC+1). The local hour 02:00-02:59 happens twice.
 *   23:59:59 happens once, after the fallback, in CET (UTC+1).
 *
 * The deadline is that Madrid civil timestamp, not deliveryAt + 168 hours.
 * A week that contains the spring transition is 167 hours long; a week that
 * contains the fall transition is 169 hours long.
 */

const CLOSED_MESSAGE = 'La foto está fuera de plazo. Puedes añadir fotos hasta el mismo día de la semana siguiente, inclusive, a las 23:59:59 (hora de Madrid). La entrega no se ha cerrado.';

function madridParts(instant) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: MADRID,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  let year = Number(parts.year);
  let month = Number(parts.month);
  let day = Number(parts.day);
  let hour = Number(parts.hour);
  if (hour === 24) {
    hour = 0;
    const next = addCalendarDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function madridOffsetMinutes(instant) {
  const parts = madridParts(instant);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

function madridLocalToUtc(year, month, day, hour, minute, second) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = madridOffsetMinutes(new Date(utc));
    const next = Date.UTC(year, month - 1, day, hour, minute, second) - (offset * 60000);
    if (next === utc) return new Date(utc);
    utc = next;
  }
  return new Date(utc);
}

function addCalendarDays(year, month, day, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function parseInstant(value, code, message) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 422;
    throw error;
  }
  return parsed;
}

function photoEvidenceDeadline(deliveryAt) {
  const delivery = parseInstant(
    deliveryAt,
    'EVIDENCE_DELIVERY_AT_INVALID',
    'La fecha de la entrega no es válida. Indica el día del reparto e inténtalo de nuevo.',
  );
  const parts = madridParts(delivery);
  const deadlineDay = addCalendarDays(parts.year, parts.month, parts.day, 7);
  return madridLocalToUtc(deadlineDay.year, deadlineDay.month, deadlineDay.day, 23, 59, 59);
}

function evaluatePhotoWindow({ deliveryAt, now }) {
  if (deliveryAt == null || String(deliveryAt).trim() === '') {
    return {
      ok: false,
      code: 'EVIDENCE_DELIVERY_AT_REQUIRED',
      statusCode: 422,
      message: 'Indica la fecha de la entrega para adjuntar la foto. La entrega no se ha cerrado.',
    };
  }
  let deadline;
  try {
    deadline = photoEvidenceDeadline(deliveryAt);
  } catch (error) {
    return {
      ok: false,
      code: error.code || 'EVIDENCE_DELIVERY_AT_INVALID',
      statusCode: 422,
      message: error.message,
    };
  }
  const instant = parseInstant(now, 'EVIDENCE_DELIVERY_AT_INVALID', 'El reloj de la evidencia no es válido');
  // 23:59:59.000 through 23:59:59.999 local are inside. The next civil second is not.
  if (instant.getTime() > deadline.getTime() + 999) {
    return {
      ok: false,
      code: 'EVIDENCE_WINDOW_CLOSED',
      statusCode: 422,
      message: CLOSED_MESSAGE,
      deadline: deadline.toISOString(),
    };
  }
  return { ok: true, deadline: deadline.toISOString() };
}

module.exports = {
  CLOSED_MESSAGE,
  evaluatePhotoWindow,
  photoEvidenceDeadline,
};
