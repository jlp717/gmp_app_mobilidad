/**
 * DB-HELPERS - Shared Data Transformation Utilities
 *
 * Centralizes repeated row-mapping patterns from ALL services.
 * Eliminates 100+ occurrences of duplicated parseFloat/parseInt/String patterns.
 *
 * WHY: Every service had its own copies of:
 *   - parseFloat(String(row.FIELD)) || 0
 *   - parseInt(String(row.FIELD)) || 0
 *   - String(row.FIELD || '').trim()
 *   - formatearFecha(dia, mes, ano)
 *   - sanitizarCodigo(codigo)
 *
 * Now there's ONE source of truth for each pattern.
 */

// ============================================
// ROW VALUE EXTRACTORS
// ============================================

/**
 * Safely extracts a float from a DB row value.
 * Replaces: parseFloat(String(row.FIELD || '0')) || 0
 */
export function toFloat(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  return isNaN(num) ? 0 : num;
}

/**
 * Safely extracts an integer from a DB row value.
 * Replaces: parseInt(String(row.FIELD || '0')) || 0
 */
export function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'number' ? Math.trunc(value) : parseInt(String(value), 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Safely extracts a trimmed string from a DB row value.
 * Replaces: String(row.FIELD || '').trim()
 */
export function toStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// ============================================
// DATE FORMATTING
// ============================================

/**
 * Formats day/month/year integers into DD/MM/YYYY.
 * Replaces 6 identical formatearFecha() methods across services.
 *
 * BEFORE (duplicated in cliente, cobros, facturas, entregas, dashboard, roles):
 *   `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`
 *
 * AFTER:
 *   formatDateDMY(row.DIA, row.MES, row.ANO)
 */
export function formatDateDMY(dia: unknown, mes: unknown, ano: unknown): string {
  const d = toInt(dia);
  const m = toInt(mes);
  const y = toInt(ano);
  if (!d || !m || !y) return '';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/**
 * Converts a numeric date (YYYYMMDD integer) to DD/MM/YYYY string.
 * Used in products.service.ts for ultimaCompra field.
 */
export function formatNumericDate(value: unknown): string | undefined {
  const num = toInt(value);
  if (!num) return undefined;
  const str = String(num);
  if (str.length < 8) return undefined;
  return `${str.substring(6, 8)}/${str.substring(4, 6)}/${str.substring(0, 4)}`;
}

// ============================================
// PAGINATION HELPERS
// ============================================

/**
 * Clamps a pagination limit value to safe bounds.
 * Replaces: Math.min(max, Math.max(1, value || default))
 */
export function clampLimit(value: unknown, defaultVal: number = 50, max: number = 500): number {
  const num = toInt(value);
  if (!num) return defaultVal;
  return Math.min(max, Math.max(1, num));
}

/**
 * Clamps a pagination offset value (minimum 0).
 * Replaces: Math.max(0, offset || 0)
 */
export function clampOffset(value: unknown): number {
  const num = toInt(value);
  return Math.max(0, num);
}

/**
 * Calculates current page number from offset and limit.
 */
export function currentPage(offset: number, limit: number): number {
  return Math.floor(offset / limit) + 1;
}

/**
 * Calculates total pages from total items and page size.
 */
export function totalPages(total: number, limit: number): number {
  return Math.ceil(total / limit);
}
