'use strict';

const { documentAmountKey, sanitizeErpAmount } = require('./delivery-amount-resolver');

const DEFAULT_CHUNK_SIZE = 25;

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeDocumentIdentity(doc) {
  const ejercicio = Number(doc.ejercicio ?? doc.EJERCICIOALBARAN);
  const serie = String(doc.serie ?? doc.SERIEALBARAN ?? '').trim();
  const terminal = Number(doc.terminal ?? doc.TERMINALALBARAN);
  const numero = Number(doc.numero ?? doc.NUMEROALBARAN);
  const cliente = String(doc.cliente ?? doc.CLIENTE ?? doc.CODIGOCLIENTEALBARAN ?? '').trim();
  if (!Number.isFinite(ejercicio) || !serie || !Number.isFinite(terminal)
    || !Number.isFinite(numero) || !cliente) {
    return null;
  }
  return { ejercicio, serie, terminal, numero, cliente };
}

/**
 * Batch-load LAC qty/price stats for a page of albaranes (no N+1).
 * queryFn(sql, params) must return row arrays.
 */
async function loadDeliveryLineAmountStats(documents, queryFn, {
  chunkSize = DEFAULT_CHUNK_SIZE,
} = {}) {
  if (typeof queryFn !== 'function') {
    throw new TypeError('queryFn is required');
  }
  const identities = [];
  const seen = new Set();
  for (const raw of documents || []) {
    const identity = normalizeDocumentIdentity(raw);
    if (!identity) continue;
    const key = documentAmountKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push(identity);
  }

  const statsByKey = new Map();
  if (!identities.length) return statsByKey;

  for (const chunk of chunkArray(identities, Math.max(1, Math.min(50, chunkSize)))) {
    const clauses = chunk.map(() => (
      '(L.EJERCICIOALBARAN = ? AND TRIM(L.SERIEALBARAN) = ? AND L.TERMINALALBARAN = ?'
      + ' AND L.NUMEROALBARAN = ? AND TRIM(L.CODIGOCLIENTEALBARAN) = ?)'
    )).join(' OR ');
    const params = chunk.flatMap((doc) => [
      doc.ejercicio, doc.serie, doc.terminal, doc.numero, doc.cliente,
    ]);
    const sql = `
      SELECT
        L.EJERCICIOALBARAN,
        TRIM(L.SERIEALBARAN) AS SERIEALBARAN,
        L.TERMINALALBARAN,
        L.NUMEROALBARAN,
        TRIM(L.CODIGOCLIENTEALBARAN) AS CLIENTE,
        COALESCE(SUM(L.IMPORTEVENTA), 0) AS LINE_SUM,
        SUM(
          CASE
            WHEN (COALESCE(L.CANTIDADUNIDADES, 0) > 0 OR COALESCE(L.CANTIDADENVASES, 0) > 0)
              AND COALESCE(L.IMPORTEVENTA, 0) = 0 THEN 1
            ELSE 0
          END
        ) AS ZERO_PRICE_QTY_LINES,
        SUM(
          CASE
            WHEN COALESCE(L.CANTIDADUNIDADES, 0) > 0 OR COALESCE(L.CANTIDADENVASES, 0) > 0 THEN 1
            ELSE 0
          END
        ) AS QTY_LINES
      FROM DSEDAC.LAC L
      WHERE (${clauses})
      GROUP BY
        L.EJERCICIOALBARAN,
        TRIM(L.SERIEALBARAN),
        L.TERMINALALBARAN,
        L.NUMEROALBARAN,
        TRIM(L.CODIGOCLIENTEALBARAN)
    `;

    let rows = [];
    try {
      rows = await queryFn(sql, params) || [];
    } catch (_) {
      // Fail soft: amount resolver still works with CPC/CAC; pricingState stays conservative.
      continue;
    }

    for (const row of rows) {
      const identity = normalizeDocumentIdentity(row);
      if (!identity) continue;
      statsByKey.set(documentAmountKey(identity), Object.freeze({
        lineSum: sanitizeErpAmount(row.LINE_SUM),
        qtyLines: Number(row.QTY_LINES) || 0,
        zeroPriceQtyLines: Number(row.ZERO_PRICE_QTY_LINES) || 0,
      }));
    }
  }

  return statsByKey;
}

function emptyLineStats() {
  return Object.freeze({ lineSum: 0, qtyLines: 0, zeroPriceQtyLines: 0 });
}

module.exports = {
  loadDeliveryLineAmountStats,
  normalizeDocumentIdentity,
  emptyLineStats,
};
