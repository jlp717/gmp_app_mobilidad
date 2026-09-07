'use strict';

const MADRID_TZ = 'Europe/Madrid';

function madridCalendarParts(at = new Date()) {
  const instant = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError('madridCalendarParts requires a valid Date');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return Object.freeze({
    year: get('year'),
    month: get('month'),
    day: get('day'),
  });
}

function madridIsoDate(at = new Date()) {
  const { year, month, day } = madridCalendarParts(at);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function previousMadridIsoDate(at = new Date()) {
  const { year, month, day } = madridCalendarParts(at);
  const previous = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000);
  const y = previous.getUTCFullYear();
  const m = String(previous.getUTCMonth() + 1).padStart(2, '0');
  const d = String(previous.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  MADRID_TZ,
  madridCalendarParts,
  madridIsoDate,
  previousMadridIsoDate,
};
