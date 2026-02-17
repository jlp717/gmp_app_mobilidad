/**
 * VENDOR HELPERS - Shared Business Logic for Commissions & Objectives
 *
 * Extracted from legacy commissions.js and objectives.js to eliminate
 * code duplication. Both modules used identical helper functions for:
 *   - getVendorCurrentClients (duplicated ~50 lines)
 *   - getClientsMonthlySales (duplicated ~30 lines)
 *   - calculateWorkingDays (duplicated ~30 lines)
 *   - calculateCommission tier logic
 *
 * SECURITY: All queries use parameterized placeholders (?).
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { toFloat, toInt } from '../utils/db-helpers';
import { sanitizeCode, buildInClause } from '../utils/validators';
import { queryCache, TTL } from '../utils/query-cache';

// ============================================
// CONSTANTS
// ============================================

/** LACLAE sales filter - only count actual sales lines (VT type, T line) */
export const LACLAE_SALES_FILTER = "L.LCTPLN = 'T' AND L.LCCLLG = 'VT'";

/** Standard Spanish holidays (MM-DD format) */
const HOLIDAYS = ['1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25'];

/** Day column names for vendor route matching */
const JS_DAY_TO_COL: Record<number, string> = {
  0: 'VIS_D', 1: 'VIS_L', 2: 'VIS_M', 3: 'VIS_X',
  4: 'VIS_J', 5: 'VIS_V', 6: 'VIS_S',
};

/** Default commission tiers (IPC 3%) */
export const DEFAULT_COMMISSION_CONFIG = {
  ipc: 3.0,
  TIER1_MAX: 103.00, TIER1_PCT: 1.0,
  TIER2_MAX: 106.00, TIER2_PCT: 1.3,
  TIER3_MAX: 110.00, TIER3_PCT: 1.6,
  TIER4_PCT: 2.0,
};

export interface CommissionConfig {
  ipc: number;
  TIER1_MAX: number; TIER1_PCT: number;
  TIER2_MAX: number; TIER2_PCT: number;
  TIER3_MAX: number; TIER3_PCT: number;
  TIER4_PCT: number;
}

export interface CommissionResult {
  commission: number;
  tier: number;
  rate: number;
  percentOver: number;
  increment: number;
  compliancePct: number;
}

// ============================================
// CLIENT & SALES HELPERS
// ============================================

/**
 * Get all clients currently managed by a vendor.
 * Falls back to previous year if no current year data.
 * Used by both commissions and objectives for inherited targets.
 */
export async function getVendorCurrentClients(vendorCode: string, currentYear: number): Promise<string[]> {
  const safeCode = sanitizeCode(vendorCode);
  const cacheKey = `gmp:vendor:clients:${safeCode}:${currentYear}`;

  return queryCache.getOrSet(cacheKey, async () => {
    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT DISTINCT TRIM(L.LCCDCL) AS CLIENT_CODE
      FROM DSED.LACLAE L
      WHERE TRIM(L.LCCDVD) = ?
        AND L.LCAADC = ?
        AND ${LACLAE_SALES_FILTER}
    `, [safeCode, currentYear]);

    if (rows.length > 0) {
      return rows.map(r => String(r.CLIENT_CODE).trim());
    }

    // Fallback to previous year
    const prevRows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT DISTINCT TRIM(L.LCCDCL) AS CLIENT_CODE
      FROM DSED.LACLAE L
      WHERE TRIM(L.LCCDVD) = ?
        AND L.LCAADC = ?
        AND ${LACLAE_SALES_FILTER}
    `, [safeCode, currentYear - 1]);

    return prevRows.map(r => String(r.CLIENT_CODE).trim());
  }, TTL.MEDIUM);
}

/**
 * Get monthly sales for a set of clients in a given year (by ALL vendors).
 * Used for inherited objectives calculation.
 */
export async function getClientsMonthlySales(
  clientCodes: string[],
  year: number,
): Promise<Record<number, { sales: number; cost: number; clients: number }>> {
  if (!clientCodes || clientCodes.length === 0) return {};

  const safeCodes = clientCodes.map(c => sanitizeCode(c));
  const { clause, params } = buildInClause('TRIM(L.LCCDCL)', safeCodes);

  const rows = await odbcPool.query<Record<string, unknown>[]>(`
    SELECT
      L.LCMMDC AS MONTH,
      SUM(L.LCIMVT) AS SALES,
      SUM(L.LCIMCT) AS COST,
      COUNT(DISTINCT L.LCCDCL) AS CLIENTS
    FROM DSED.LACLAE L
    WHERE ${clause}
      AND L.LCAADC = ?
      AND ${LACLAE_SALES_FILTER}
    GROUP BY L.LCMMDC
  `, [...params, year]);

  const monthlyMap: Record<number, { sales: number; cost: number; clients: number }> = {};
  for (const r of rows) {
    const month = toInt(r.MONTH);
    monthlyMap[month] = {
      sales: toFloat(r.SALES),
      cost: toFloat(r.COST),
      clients: toInt(r.CLIENTS),
    };
  }
  return monthlyMap;
}

/**
 * Get B-Sales from JAVIER.VENTAS_B for a vendor/year.
 * Returns monthly map: { month: amount }.
 */
export async function getBSales(vendorCode: string, year: number): Promise<Record<number, number>> {
  const safeCode = sanitizeCode(vendorCode);
  const cacheKey = `gmp:bsales:${safeCode}:${year}`;

  return queryCache.getOrSet(cacheKey, async () => {
    const result: Record<number, number> = {};
    try {
      const rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT MES, IMPORTE
        FROM JAVIER.VENTAS_B
        WHERE TRIM(CODIGOVENDEDOR) = ?
          AND ANIO = ?
      `, [safeCode, year]);

      for (const r of rows) {
        const month = toInt(r.MES);
        if (month >= 1 && month <= 12) {
          result[month] = (result[month] || 0) + toFloat(r.IMPORTE);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug(`[VENDOR-HELPERS] VENTAS_B lookup error: ${msg}`);
    }
    return result;
  }, TTL.MEDIUM);
}

// ============================================
// WORKING DAYS CALCULATION
// ============================================

/**
 * Calculates total working days in a month based on vendor's active route days.
 * Excludes standard Spanish holidays.
 */
export function calculateWorkingDays(year: number, month: number, activeWeekDays?: string[]): number {
  const effectiveDays = (activeWeekDays && activeWeekDays.length > 0)
    ? activeWeekDays
    : ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V'];

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  let count = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getMonth() + 1}-${d.getDate()}`;
    if (HOLIDAYS.includes(dateStr)) continue;

    const colName = JS_DAY_TO_COL[d.getDay()];
    if (effectiveDays.includes(colName)) {
      count++;
    }
  }
  return count;
}

/**
 * Calculates working days passed so far in the current month.
 */
export function calculateDaysPassed(year: number, month: number, activeWeekDays?: string[]): number {
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === (now.getMonth() + 1);
  const isFuture = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);

  if (isFuture) return 0;
  if (!isCurrentMonth) return calculateWorkingDays(year, month, activeWeekDays);

  // Current month: count days up to today
  const effectiveDays = (activeWeekDays && activeWeekDays.length > 0)
    ? activeWeekDays
    : ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V'];

  const start = new Date(year, month - 1, 1);
  let count = 0;

  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getMonth() + 1}-${d.getDate()}`;
    if (HOLIDAYS.includes(dateStr)) continue;

    const colName = JS_DAY_TO_COL[d.getDay()];
    if (effectiveDays.includes(colName)) {
      count++;
    }
  }
  return count;
}

// ============================================
// COMMISSION CALCULATION
// ============================================

/**
 * Core commission calculation: determines tier and commission amount
 * based on compliance percentage (actual / target).
 */
export function calculateCommission(actual: number, target: number, config: CommissionConfig): CommissionResult {
  if (target <= 0) {
    return { commission: 0, tier: 0, rate: 0, percentOver: 0, increment: 0, compliancePct: 0 };
  }

  const compliancePct = (actual / target) * 100;
  const increment = actual - target;

  let rate = 0;
  let tier = 0;

  if (compliancePct > config.TIER3_MAX) {
    rate = config.TIER4_PCT;
    tier = 4;
  } else if (compliancePct > config.TIER2_MAX) {
    rate = config.TIER3_PCT;
    tier = 3;
  } else if (compliancePct > config.TIER1_MAX) {
    rate = config.TIER2_PCT;
    tier = 2;
  } else if (compliancePct > 100) {
    rate = config.TIER1_PCT;
    tier = 1;
  }

  let commission = 0;
  if (increment > 0 && rate > 0) {
    commission = increment * (rate / 100);
  }

  return { commission, tier, rate, percentOver: compliancePct - 100, increment, compliancePct };
}

/**
 * Gets vendor name from CLI or VDC table.
 */
export async function getVendorName(vendorCode: string): Promise<string> {
  const safeCode = sanitizeCode(vendorCode);
  const cacheKey = `gmp:vendor:name:${safeCode}`;

  return queryCache.getOrSet(cacheKey, async () => {
    try {
      const rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT TRIM(NOMBREVENDEDOR) AS NOMBRE
        FROM DSEDAC.VDC
        WHERE TRIM(CODIGOVENDEDOR) = ?
          AND SUBEMPRESA = 'GMP'
        FETCH FIRST 1 ROWS ONLY
      `, [safeCode]);

      if (rows.length > 0 && rows[0].NOMBRE) {
        return String(rows[0].NOMBRE).trim();
      }
      return safeCode;
    } catch {
      return safeCode;
    }
  }, TTL.LONG);
}

/**
 * Builds LACLAE vendor filter using parameterized query.
 * Returns { clause, params } for safe WHERE inclusion.
 */
export function buildVendedorFilterLACLAE(
  vendorCode: string,
  alias: string = 'L',
): { clause: string; params: string[] } {
  if (!vendorCode || vendorCode.toUpperCase() === 'ALL') {
    return { clause: '', params: [] };
  }

  const codes = vendorCode.split(',').map(c => sanitizeCode(c));
  if (codes.length === 1) {
    return {
      clause: `AND TRIM(${alias}.LCCDVD) = ?`,
      params: [codes[0]],
    };
  }

  const placeholders = codes.map(() => '?').join(', ');
  return {
    clause: `AND TRIM(${alias}.LCCDVD) IN (${placeholders})`,
    params: codes,
  };
}

/**
 * Builds LAC (DSEDAC.LAC) vendor filter using parameterized query.
 * Handles 'ALL', 'UNK' (null/empty vendor), and multi-vendor codes.
 */
export function buildVendedorFilterLAC(
  vendorCode: string,
  alias: string = '',
): { clause: string; params: string[] } {
  if (!vendorCode || vendorCode.toUpperCase() === 'ALL') {
    return { clause: '', params: [] };
  }

  const prefix = alias ? `${alias}.` : '';
  const codes = vendorCode.split(',').map(c => sanitizeCode(c));
  const hasUNK = codes.includes('UNK');
  const normalCodes = codes.filter(c => c !== 'UNK');

  if (hasUNK && normalCodes.length > 0) {
    const placeholders = normalCodes.map(() => '?').join(', ');
    return {
      clause: `AND (TRIM(${prefix}CODIGOVENDEDOR) IN (${placeholders}) OR ${prefix}CODIGOVENDEDOR IS NULL OR TRIM(${prefix}CODIGOVENDEDOR) = '')`,
      params: normalCodes,
    };
  } else if (hasUNK) {
    return {
      clause: `AND (${prefix}CODIGOVENDEDOR IS NULL OR TRIM(${prefix}CODIGOVENDEDOR) = '')`,
      params: [],
    };
  } else if (normalCodes.length === 1) {
    return {
      clause: `AND TRIM(${prefix}CODIGOVENDEDOR) = ?`,
      params: [normalCodes[0]],
    };
  }

  const placeholders = normalCodes.map(() => '?').join(', ');
  return {
    clause: `AND TRIM(${prefix}CODIGOVENDEDOR) IN (${placeholders})`,
    params: normalCodes,
  };
}

/**
 * Get vendor active route days from LACLAE data.
 * Returns VIS_X format array (e.g., ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V']).
 */
export async function getVendorActiveDays(vendorCode: string): Promise<string[]> {
  const defaultDays = ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V'];
  try {
    const safeCode = sanitizeCode(vendorCode);
    const cacheKey = `gmp:vendor:activeDays:${safeCode}`;
    return queryCache.getOrSet(cacheKey, async () => {
      const rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT DISTINCT L.LCDDSE AS DIA_SEMANA
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = ?
          AND L.LCAADC = YEAR(CURRENT_DATE)
          AND ${LACLAE_SALES_FILTER}
      `, [safeCode]);

      if (rows.length === 0) return defaultDays;

      const dayMap: Record<string, string> = {
        '1': 'VIS_L', '2': 'VIS_M', '3': 'VIS_X',
        '4': 'VIS_J', '5': 'VIS_V', '6': 'VIS_S', '7': 'VIS_D',
      };
      const days = rows.map(r => dayMap[String(r.DIA_SEMANA).trim()] || '').filter(d => d);
      return days.length > 0 ? days : defaultDays;
    }, TTL.LONG);
  } catch {
    return defaultDays;
  }
}

/**
 * Get target percentage configuration for a vendor from OBJ_CONFIG.
 * Defaults to 10% if not configured.
 */
export async function getVendorTargetConfig(vendorCode?: string): Promise<number> {
  if (!vendorCode || vendorCode === 'ALL') return 10.0;

  const safeCode = sanitizeCode(vendorCode.split(',')[0]);
  const cacheKey = `gmp:vendor:targetConfig:${safeCode}`;

  return queryCache.getOrSet(cacheKey, async () => {
    try {
      const rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT TARGET_PERCENTAGE
        FROM JAVIER.OBJ_CONFIG
        WHERE CODIGOVENDEDOR = ?
      `, [safeCode]);

      if (rows.length > 0) {
        return toFloat(rows[0].TARGET_PERCENTAGE) || 10.0;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug(`[VENDOR-HELPERS] OBJ_CONFIG lookup error: ${msg}`);
    }
    return 10.0;
  }, TTL.MEDIUM);
}

/**
 * Get fixed monthly target from COMMERCIAL_TARGETS.
 * Returns target amount or null if not configured.
 */
export async function getFixedMonthlyTarget(
  vendorCode: string,
  year: number,
  month: number,
): Promise<{ objetivo: number | null; baseComision: number | null; porcentaje: number }> {
  const safeCode = sanitizeCode(vendorCode);
  try {
    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION, PORCENTAJE_MEJORA
      FROM JAVIER.COMMERCIAL_TARGETS
      WHERE CODIGOVENDEDOR = ?
        AND ANIO = ?
        AND (MES = ? OR MES IS NULL)
        AND ACTIVO = 1
      ORDER BY MES DESC
      FETCH FIRST 1 ROWS ONLY
    `, [safeCode, year, month]);

    if (rows && rows.length > 0) {
      return {
        objetivo: toFloat(rows[0].IMPORTE_OBJETIVO) || null,
        baseComision: toFloat(rows[0].IMPORTE_BASE_COMISION) || null,
        porcentaje: toFloat(rows[0].PORCENTAJE_MEJORA) || 10,
      };
    }
  } catch {
    // Table might not exist
  }
  return { objetivo: null, baseComision: null, porcentaje: 10 };
}
