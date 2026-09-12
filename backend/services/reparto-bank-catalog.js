'use strict';

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

const CACHE_TTL_MS = 10 * 60 * 1000;
const ENTITY_CODE_RE = /^\d{4}$/;

const CATALOG_CANDIDATES = Object.freeze([
  Object.freeze({
    schema: 'DSEDAC',
    table: 'ENB',
    code: 'CODIGOENTIDADBANCARIA',
    name: 'DESCRICIONENTIDADBANCARIA',
  }),
  Object.freeze({ schema: 'DSEDAC', table: 'BCO', code: 'BANCO', name: 'DESCRIPCIONBANCO' }),
  Object.freeze({ schema: 'DSEDAC', table: 'EBP', code: 'CODIGOBANCO', name: 'DESCRIPCIONBANCO' }),
]);

let catalogCache = null;
let catalogExpiresAt = 0;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeBankCode(value) {
  const digits = normalizeText(value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

function normalizeBankName(value) {
  return normalizeText(value).replace(/\s+/g, ' ').slice(0, 40);
}

function rowValue(row, key) {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];
  return row[key.toUpperCase()];
}

async function tableHasColumns(schema, table, columns, query = queryWithParams) {
  const placeholders = columns.map(() => '?').join(', ');
  const rows = await query(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND COLUMN_NAME IN (${placeholders})`,
    [schema, table, ...columns],
  );
  const found = new Set((rows || []).map((row) => normalizeText(rowValue(row, 'COLUMN_NAME')).toUpperCase()));
  return columns.every((column) => found.has(column));
}

async function resolveBankCatalog(query = queryWithParams) {
  const now = Date.now();
  if (catalogCache && now < catalogExpiresAt) return catalogCache;

  for (const candidate of CATALOG_CANDIDATES) {
    try {
      const exists = await query(
        `SELECT TABLE_NAME FROM QSYS2.SYSTABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          FETCH FIRST 1 ROW ONLY`,
        [candidate.schema, candidate.table],
      );
      if (!(exists || []).length) continue;
      const hasColumns = await tableHasColumns(
        candidate.schema,
        candidate.table,
        [candidate.code, candidate.name],
        query,
      );
      if (!hasColumns) continue;
      catalogCache = candidate;
      catalogExpiresAt = now + CACHE_TTL_MS;
      logger.info(`[reparto-bank] catalog ${candidate.schema}.${candidate.table}`);
      return catalogCache;
    } catch (error) {
      logger.warn(`[reparto-bank] catalog probe failed for ${candidate.table}: ${error.message}`);
    }
  }

  catalogCache = null;
  catalogExpiresAt = now + CACHE_TTL_MS;
  return null;
}

async function lookupBank({ codigo, nombre, query = queryWithParams } = {}) {
  const code = normalizeBankCode(codigo);
  const name = normalizeBankName(nombre);
  const catalog = await resolveBankCatalog(query);
  if (!catalog) {
    if (!code || !ENTITY_CODE_RE.test(code) || name.length < 3) {
      return { ok: false, reason: 'BANK_IDENTITY_REQUIRED' };
    }
    return { ok: true, codigo: code, nombre: name, validated: false };
  }

  const nameNeedle = name.length >= 3 ? `%${name.toUpperCase()}%` : name.toUpperCase();
  const sql = `
    SELECT TRIM(${catalog.code}) AS CODIGO, TRIM(${catalog.name}) AS NOMBRE
      FROM ${catalog.schema}.${catalog.table}
     WHERE (? <> '' AND TRIM(${catalog.code}) = ?)
        OR (? <> '' AND UPPER(TRIM(${catalog.name})) LIKE ?)
     FETCH FIRST 8 ROWS ONLY
  `;
  const rows = await query(sql, [code, code, nameNeedle === '%' ? '' : name, nameNeedle]);
  const match = (rows || []).find((row) => {
    const rowCode = normalizeBankCode(rowValue(row, 'CODIGO'));
    const rowName = normalizeBankName(rowValue(row, 'NOMBRE')).toUpperCase();
    return (code && rowCode === code)
      || (name && rowName === name.toUpperCase())
      || (name.length >= 3 && rowName.includes(name.toUpperCase()));
  });
  if (!match) {
    return { ok: false, reason: 'BANK_NOT_FOUND' };
  }
  return {
    ok: true,
    codigo: normalizeBankCode(rowValue(match, 'CODIGO')) || code,
    nombre: normalizeBankName(rowValue(match, 'NOMBRE')) || name,
    validated: true,
  };
}

function parseTalonDueDate(value) {
  const raw = normalizeText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slash) {
    return { day: Number(slash[1]), month: Number(slash[2]), year: Number(slash[3]) };
  }
  return null;
}

function isTalonPaymentMethod(value) {
  const method = normalizeText(value).toUpperCase();
  return [
    'TALON', 'TALÓN', 'CHEQUE', 'CH', 'TALON BANCARIO',
    'TRANSFERENCIA', 'TRANSFER', 'TR', 'T0',
  ].includes(method);
}

async function assertTalonPayment(input, { query = queryWithParams } = {}) {
  if (!isTalonPaymentMethod(input?.formaPago)) return null;
  const numeroTalon = normalizeText(input?.numeroTalon).slice(0, 10);
  const due = parseTalonDueDate(input?.fechaVencimientoTalon);
  if (!numeroTalon || !due) {
    const error = new Error('El talón requiere número y fecha de vencimiento');
    error.code = 'TALON_FIELDS_REQUIRED';
    error.statusCode = 422;
    throw error;
  }
  const bank = await lookupBank({
    codigo: input?.codigoEntidadBancaria,
    nombre: input?.nombreBanco,
    query,
  });
  if (!bank.ok) {
    const error = new Error('El banco del talón no está validado');
    error.code = bank.reason || 'BANK_NOT_FOUND';
    error.statusCode = 422;
    throw error;
  }
  return {
    numeroTalon,
    codigoEntidadBancaria: bank.codigo,
    nombreBanco: bank.nombre,
    diaVencimiento: due.day,
    mesVencimiento: due.month,
    anoVencimiento: due.year,
  };
}

function clearBankCatalogCache() {
  catalogCache = null;
  catalogExpiresAt = 0;
}

module.exports = {
  lookupBank,
  assertTalonPayment,
  isTalonPaymentMethod,
  normalizeBankCode,
  parseTalonDueDate,
  clearBankCatalogCache,
};
