'use strict';

/**
 * Paginacion acotada para listados calientes (DB2 OFFSET/FETCH).
 * Los enteros ya van clampados: interpolarlos en OFFSET/FETCH es seguro.
 */

function toInt(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePage(query = {}, {
  defaultLimit = 50,
  maxLimit = 200,
  maxOffset = 100000,
} = {}) {
  const limit = Math.min(maxLimit, Math.max(1, toInt(query.limit, defaultLimit)));
  let offset = toInt(query.offset, Number.NaN);
  if (!Number.isFinite(offset)) {
    const page = Math.max(1, toInt(query.page, 1));
    offset = (page - 1) * limit;
  }
  offset = Math.min(maxOffset, Math.max(0, offset));
  return {
    limit,
    offset,
    page: Math.floor(offset / limit) + 1,
  };
}

function paginationContract(page, rowCount) {
  const returned = Array.isArray(rowCount) ? rowCount.length : Number(rowCount) || 0;
  return {
    limit: page.limit,
    offset: page.offset,
    page: page.page,
    returned,
    hasMore: returned === page.limit,
  };
}

function db2OffsetFetch(page) {
  return `OFFSET ${page.offset} ROWS FETCH FIRST ${page.limit} ROWS ONLY`;
}

module.exports = {
  parsePage,
  paginationContract,
  db2OffsetFetch,
};
