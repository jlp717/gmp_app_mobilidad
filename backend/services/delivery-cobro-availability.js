'use strict';

// CVC is an ERP read model. Keep this module pure apart from producing the
// parameterized statement so the route can cache the batch lookup and tests can
// prove that the financial identity is never reduced to client code alone.

const CVC_DOCUMENT_FIELDS = Object.freeze([
  ['SUBEMPRESA', 'SUBEMPRESADOCUMENTO'],
  ['EJERCICIO', 'EJERCICIODOCUMENTO'],
  ['SERIE', 'SERIEDOCUMENTO'],
  ['TERMINAL', 'TERMINALDOCUMENTO'],
  ['NUMERO', 'NUMERODOCUMENTO'],
  ['CLIENTE', 'CODIGOCLIENTEALBARAN'],
]);

function value(row, key) {
  return row?.[key] ?? row?.[key.toLowerCase()] ?? row?.[key.toUpperCase()];
}

function text(raw) {
  return String(raw ?? '').trim();
}

function integer(raw) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeDocument(source) {
  const document = {
    subempresa: text(value(source, 'SUBEMPRESAALBARAN') ?? value(source, 'SUBEMPRESA')),
    ejercicio: integer(value(source, 'EJERCICIOALBARAN') ?? value(source, 'EJERCICIO')),
    serie: text(value(source, 'SERIEALBARAN') ?? value(source, 'SERIE')),
    terminal: integer(value(source, 'TERMINALALBARAN') ?? value(source, 'TERMINAL')),
    numero: integer(value(source, 'NUMEROALBARAN') ?? value(source, 'NUMERO')),
    cliente: text(value(source, 'CLIENTE') ?? value(source, 'CODIGOCLIENTEALBARAN')),
  };
  if (!document.subempresa || document.ejercicio == null || !document.serie
      || document.terminal == null || document.numero == null || !document.cliente) {
    return null;
  }
  return Object.freeze(document);
}

function documentKey(document) {
  const normalized = normalizeDocument(document);
  if (!normalized) return null;
  return [
    normalized.subempresa,
    normalized.ejercicio,
    normalized.serie,
    normalized.terminal,
    normalized.numero,
    normalized.cliente,
  ].join('|');
}

function buildCvcAvailabilityQuery(sources) {
  const documents = [];
  const seen = new Set();
  for (const source of Array.isArray(sources) ? sources : []) {
    const normalized = normalizeDocument(source);
    const key = normalized && documentKey(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    documents.push(normalized);
  }
  if (!documents.length) return null;

  const clauses = documents.map(() => `(
      TRIM(CVC.SUBEMPRESADOCUMENTO) = ?
      AND CVC.EJERCICIODOCUMENTO = ?
      AND TRIM(CVC.SERIEDOCUMENTO) = ?
      AND CVC.TERMINALDOCUMENTO = ?
      AND CVC.NUMERODOCUMENTO = ?
      AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?
    )`).join(' OR ');
  const params = documents.flatMap((document) => [
    document.subempresa,
    document.ejercicio,
    document.serie,
    document.terminal,
    document.numero,
    document.cliente,
  ]);
  const groupBy = CVC_DOCUMENT_FIELDS.map(([, field], index) =>
    [0, 2, 5].includes(index) ? 'TRIM(CVC.' + field + ')' : 'CVC.' + field,
  ).join(', ');
  return Object.freeze({
    sql: `
      SELECT
        TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESA,
        CVC.EJERCICIODOCUMENTO AS EJERCICIO,
        TRIM(CVC.SERIEDOCUMENTO) AS SERIE,
        CVC.TERMINALDOCUMENTO AS TERMINAL,
        CVC.NUMERODOCUMENTO AS NUMERO,
        TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
        COUNT(*) AS CVC_ROW_COUNT,
        COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS IMPORTEPENDIENTE
      FROM DSEDAC.CVC CVC
      WHERE COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
        AND CVC.IMPORTEPENDIENTE > 0
        AND (${clauses})
      GROUP BY ${groupBy}
    `,
    params: Object.freeze(params),
    documents: Object.freeze(documents),
  });
}

function mapCvcAvailabilityRows(rows, documents) {
  const result = new Map();
  for (const document of Array.isArray(documents) ? documents : []) {
    result.set(documentKey(document), Object.freeze({
      state: 'MISSING',
      importeDisponibleCobro: 0,
    }));
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const document = normalizeDocument(row);
    const key = document && documentKey(document);
    if (!key || !result.has(key)) continue;
    const count = Number(value(row, 'CVC_ROW_COUNT'));
    const pending = Number(value(row, 'IMPORTEPENDIENTE'));
    if (!Number.isFinite(count) || count < 1 || !Number.isFinite(pending) || pending <= 0) {
      result.set(key, Object.freeze({ state: 'MISSING', importeDisponibleCobro: 0 }));
      continue;
    }
    result.set(key, Object.freeze({
      state: count === 1 ? 'AVAILABLE' : 'AMBIGUOUS',
      importeDisponibleCobro: count === 1 ? Math.round(pending * 100) / 100 : 0,
    }));
  }
  return result;
}

function roundCollectable(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

// Document-scoped cobro in rutero must never exceed the albarán/factura being
// delivered. CVC.IMPORTEPENDIENTE can be a grouped invoice or leftover client
// effect that matches the same identity; that remaining stays on the ERP write
// path, but the amount offered/accepted for THIS stop is min(CVC, documento).
// Client-level debt lives in VISTA_DEUDA_BASE / DSEDAC.CVC by cliente — do not
// mix it into importeDisponibleCobro.
function resolveDocumentCollectable({
  cvcState,
  cvcPending,
  documentAmount,
} = {}) {
  const normalizedState = String(cvcState || 'MISSING').trim().toUpperCase();
  const document = roundCollectable(documentAmount);
  const pending = roundCollectable(cvcPending);
  if (normalizedState === 'AMBIGUOUS') {
    return Object.freeze({
      state: 'AMBIGUOUS',
      importeDisponibleCobro: 0,
      importeDocumento: document,
      importeCvcPendiente: pending,
      capped: false,
    });
  }
  if (normalizedState !== 'AVAILABLE' || pending <= 0.004) {
    return Object.freeze({
      state: 'MISSING',
      importeDisponibleCobro: 0,
      importeDocumento: document,
      importeCvcPendiente: pending,
      capped: false,
    });
  }
  if (document <= 0.004) {
    return Object.freeze({
      state: 'MISSING',
      importeDisponibleCobro: 0,
      importeDocumento: document,
      importeCvcPendiente: pending,
      capped: pending > 0.004,
    });
  }
  const capped = pending > document + 0.004;
  return Object.freeze({
    state: 'AVAILABLE',
    importeDisponibleCobro: capped ? document : pending,
    importeDocumento: document,
    importeCvcPendiente: pending,
    capped,
  });
}

module.exports = {
  buildCvcAvailabilityQuery,
  documentKey,
  mapCvcAvailabilityRows,
  normalizeDocument,
  resolveDocumentCollectable,
};
