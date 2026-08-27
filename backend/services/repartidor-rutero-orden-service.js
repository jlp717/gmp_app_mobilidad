'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_ID_RE = /^[\w.\-]{1,80}$/;
const CLIENTE_RE = /^[A-Za-z0-9]{0,20}$/;

const WEEKDAY_CIERRE = [
  'DIACIERREDOMINGOSN',
  'DIACIERRELUNESSN',
  'DIACIERREMARTESSN',
  'DIACIERREMIERCOLESSN',
  'DIACIERREJUEVESSN',
  'DIACIERREVIERNESSN',
  'DIACIERRESABADOSN',
];

function parseRouteDate(raw) {
  const text = String(raw || '').trim();
  // Retain full-ISO timestamp compatibility, reject trailing garbage.
  const ymd = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(text)?.[1] || '';
  if (!DATE_RE.test(ymd)) return null;
  if (text.includes('T') && Number.isNaN(Date.parse(text))) return null;
  const date = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== ymd) return null;
  return ymd;
}

function normalizeOrdenPayload(rawOrden) {
  if (!Array.isArray(rawOrden)) {
    return { error: 'ORDEN_INVALID' };
  }
  if (rawOrden.length === 0) {
    return { error: 'ORDEN_EMPTY' };
  }
  if (rawOrden.length > 500) {
    return { error: 'ORDEN_TOO_LARGE' };
  }
  const seen = new Set();
  const orden = [];
  for (let i = 0; i < rawOrden.length; i += 1) {
    const row = rawOrden[i] || {};
    const documentId = String(row.documentId || '').trim();
    if (!DOC_ID_RE.test(documentId)) {
      return { error: 'DOCUMENT_ID_INVALID' };
    }
    if (seen.has(documentId)) {
      return { error: 'ORDEN_DUPLICATE' };
    }
    seen.add(documentId);
    const cliente = String(row.cliente ?? row.clienteCodigo ?? '').trim();
    if (!CLIENTE_RE.test(cliente)) {
      return { error: 'CLIENTE_INVALID' };
    }
    const posicionRaw = row.posicion;
    const posicion = posicionRaw === undefined || posicionRaw === null
      ? i
      : Number(posicionRaw);
    if (!Number.isInteger(posicion) || posicion < 0 || posicion > 9999) {
      return { error: 'POSICION_INVALID' };
    }
    orden.push({ documentId, cliente: cliente || null, posicion });
  }
  // Normalize positions to dense 0..n-1 by declared posicion order.
  orden.sort((a, b) => a.posicion - b.posicion || a.documentId.localeCompare(b.documentId));
  return {
    value: orden.map((row, index) => ({
      documentId: row.documentId,
      cliente: row.cliente,
      posicion: index,
    })),
  };
}

function buildOrderRankMap(ordenRows) {
  const rank = new Map();
  for (const row of ordenRows || []) {
    const documentId = String(row.documentId || row.DOCUMENT_ID || '').trim();
    const posicion = Number(row.posicion ?? row.ORDEN);
    if (!documentId || !Number.isFinite(posicion)) continue;
    rank.set(documentId, posicion);
  }
  return rank;
}

/** Ordered docs first by saved posicion; unordered keep relative order after. */
function applySavedOrder(items, ordenRows) {
  const rank = buildOrderRankMap(ordenRows);
  if (rank.size === 0) return items;
  return items
    .map((item, index) => ({
      item,
      index,
      rank: rank.has(String(item.id || '').trim())
        ? rank.get(String(item.id || '').trim())
        : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((entry) => entry.item);
}
/**
 * Applies operational day moves after the saved day order.  Moved stops keep
 * their requested target slot; all other stops preserve their relative order.
 */
function applyDayMovePositions(items, moveRows) {
  if (!Array.isArray(items) || !Array.isArray(moveRows) || moveRows.length === 0) {
    return items;
  }
  const positions = new Map();
  for (const row of moveRows) {
    const documentId = String(row?.documentId || row?.DOCUMENT_ID || '').trim();
    const position = Number(row?.targetPosition ?? row?.TARGET_POSITION);
    if (documentId && Number.isInteger(position) && position >= 0) {
      positions.set(documentId, position);
    }
  }
  if (positions.size === 0) return items;
  const moved = [];
  const remaining = [];
  items.forEach((item, index) => {
    const documentId = String(item?.id || '').trim();
    if (!positions.has(documentId)) {
      remaining.push(item);
      return;
    }
    moved.push({ item, index, position: positions.get(documentId) });
  });
  moved.sort((left, right) => (left.position - right.position)
    || (left.index - right.index));
  for (const entry of moved) {
    remaining.splice(Math.min(entry.position, remaining.length), 0, entry.item);
  }
  return remaining;
}

/**
 * Parse messy CRUT hour values: HHMMSS (90000), HHMM (815), HMM (815), etc.
 * Returns minutes from midnight or null.
 */
function parseCrutHour(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const text = String(raw).trim();
  if (!text || /^0+$/.test(text)) return null;
  const asNum = Number(text.replace(',', '.'));
  if (!Number.isFinite(asNum) || asNum <= 0) return null;
  const digits = String(Math.trunc(asNum)).replace(/\D/g, '');
  if (!digits) return null;

  let hours;
  let minutes;
  if (digits.length <= 2) {
    hours = Number(digits);
    minutes = 0;
  } else if (digits.length <= 4) {
    const padded = digits.padStart(4, '0');
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2, 4));
  } else {
    const padded = digits.padStart(6, '0').slice(-6);
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2, 4));
  }
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function formatMinuteLabel(minute) {
  if (minute === null || minute === undefined || !Number.isFinite(minute)) return null;
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Extract preferred open time from OBSERVACIONESREPARTO when numeric hours missing.
 * Examples: "ABRE A LAS 11", "ABRE 8:15", "abre a las 9.30"
 */
function parseOpenTimeFromObs(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const match = /ABRE\s*(?:A\s*LAS\s*)?(\d{1,2})\s*[:.,hH]?\s*(\d{2})?/i.exec(raw);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function weekdayIndexUtc(dateYmd) {
  const date = new Date(`${dateYmd}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCDay(); // 0=Sun .. 6=Sat
}

function isClosedOnDate(windowRow, dateYmd) {
  if (!windowRow || !dateYmd) return false;
  const idx = weekdayIndexUtc(dateYmd);
  if (idx === null) return false;
  const field = WEEKDAY_CIERRE[idx];
  const raw = String(windowRow[field] ?? windowRow[field.toLowerCase()] ?? '').trim().toUpperCase();
  return raw === 'S' || raw === 'Y' || raw === '1' || raw === 'SI' || raw === 'TRUE';
}

/**
 * Preferred delivery/open start minute for sorting.
 * Priority: HORAREPARTODESDE → HORAVISITA → HORALLAMADA → OBSERVACIONESREPARTO.
 */
function preferredStartMinute(windowRow) {
  if (!windowRow) return null;
  const fromReparto = parseCrutHour(windowRow.horaRepartoDesde ?? windowRow.HORAREPARTODESDE);
  if (fromReparto !== null) return fromReparto;
  const fromVisita = parseCrutHour(windowRow.horaVisita ?? windowRow.HORAVISITA);
  if (fromVisita !== null) return fromVisita;
  const fromLlamada = parseCrutHour(windowRow.horaLlamada ?? windowRow.HORALLAMADA);
  if (fromLlamada !== null) return fromLlamada;
  return parseOpenTimeFromObs(
    windowRow.observacionesReparto ?? windowRow.OBSERVACIONESREPARTO,
  );
}

function buildWindowLabel(windowRow) {
  if (!windowRow) return null;
  const desde = parseCrutHour(windowRow.horaRepartoDesde ?? windowRow.HORAREPARTODESDE);
  const hasta = parseCrutHour(windowRow.horaRepartoHasta ?? windowRow.HORAREPARTOHASTA);
  if (desde !== null && hasta !== null) {
    return `${formatMinuteLabel(desde)}–${formatMinuteLabel(hasta)}`;
  }
  if (desde !== null) return `Desde ${formatMinuteLabel(desde)}`;
  const preferred = preferredStartMinute(windowRow);
  if (preferred !== null) return `Pref. ${formatMinuteLabel(preferred)}`;
  return null;
}

const UNKNOWN_PREFERRED = (24 * 60) + 1;

/**
 * Score early→late by preferred start; closed-day penalty; stable sort.
 * Never deletes stops.
 */
function optimizeStops(stops, dateYmd, windowsByCliente = new Map()) {
  const list = Array.isArray(stops) ? stops : [];
  const scored = list.map((stop, index) => {
    const documentId = String(stop.documentId || stop.id || '').trim();
    const cliente = String(stop.cliente || stop.clienteCodigo || stop.codigoCliente || '').trim();
    const windowRow = windowsByCliente.get(cliente) || stop.window || null;
    const closedDay = isClosedOnDate(windowRow, dateYmd);
    const preferred = preferredStartMinute(windowRow);
    const observaciones = String(
      (windowRow && (windowRow.observacionesReparto || windowRow.OBSERVACIONESREPARTO))
      || stop.observaciones
      || '',
    ).trim();
    return {
      documentId,
      cliente: cliente || null,
      originalIndex: index,
      closedDay,
      preferredMinute: preferred,
      windowLabel: buildWindowLabel(windowRow),
      observaciones: observaciones || null,
      scoreClosed: closedDay ? 1 : 0,
      scorePreferred: preferred === null ? UNKNOWN_PREFERRED : preferred,
    };
  });

  scored.sort((a, b) => (
    (a.scoreClosed - b.scoreClosed)
    || (a.scorePreferred - b.scorePreferred)
    || (a.originalIndex - b.originalIndex)
  ));

  return scored.map((row, posicion) => ({
    documentId: row.documentId,
    cliente: row.cliente,
    posicion,
    preferredMinute: row.preferredMinute,
    windowLabel: row.windowLabel,
    observaciones: row.observaciones,
    closedDay: row.closedDay,
  }));
}

function normalizeOptimizeStopsPayload(body) {
  const date = parseRouteDate(body?.date);
  if (!date) return { error: 'DATE_INVALID' };
  const rawStops = Array.isArray(body?.stops)
    ? body.stops
    : Array.isArray(body?.documentIds)
      ? body.documentIds.map((id, index) => ({
        documentId: id,
        cliente: Array.isArray(body?.clientes) ? body.clientes[index] : null,
      }))
      : null;
  if (!rawStops) return { error: 'STOPS_INVALID' };
  const parsed = normalizeOrdenPayload(
    rawStops.map((row, index) => ({
      documentId: row?.documentId || row?.id,
      cliente: row?.cliente || row?.clienteCodigo || row?.codigoCliente,
      posicion: index,
    })),
  );
  if (parsed.error) return { error: parsed.error };
  return { date, stops: parsed.value };
}

module.exports = {
  parseRouteDate,
  normalizeOrdenPayload,
  buildOrderRankMap,
  applySavedOrder,
  applyDayMovePositions,
  parseCrutHour,
  parseOpenTimeFromObs,
  preferredStartMinute,
  isClosedOnDate,
  buildWindowLabel,
  formatMinuteLabel,
  optimizeStops,
  normalizeOptimizeStopsPayload,
};
