/**
 * COMMISSIONS SERVICE - Refactored from legacy commissions.js
 *
 * Handles commission calculation for commercial vendors:
 * - Config loading from JAVIER.COMM_CONFIG
 * - Excluded vendors from JAVIER.COMMISSION_EXCEPTIONS
 * - Per-vendor commission calculation with inherited objectives
 * - Payment recording and history
 *
 * SECURITY: All queries use parameterized placeholders (?).
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { toFloat, toInt } from '../utils/db-helpers';
import { sanitizeCode } from '../utils/validators';
import { queryCache, TTL } from '../utils/query-cache';
import {
  CommissionConfig,
  DEFAULT_COMMISSION_CONFIG,
  LACLAE_SALES_FILTER,
  calculateCommission,
  calculateWorkingDays,
  calculateDaysPassed,
  getVendorCurrentClients,
  getClientsMonthlySales,
  getBSales,
  getVendorName,
  buildVendedorFilterLACLAE,
} from '../utils/vendor-helpers';

// ============================================
// TYPES
// ============================================

interface MonthData {
  month: number;
  prevSales: number;
  target: number;
  actual: number;
  workingDays: number;
  daysPassed: number;
  proRatedTarget: number;
  dailyTarget: number;
  dailyActual: number;
  isFuture: boolean;
  complianceCtx: {
    pct: number;
    increment: number;
    tier: number;
    rate: number;
    commission: number;
    isExcluded: boolean;
  };
  dailyComplianceCtx: {
    pct: number;
    tier: number;
    rate: number;
    isGreen: boolean;
    provisionalCommission: number;
    increment: number;
  };
}

interface QuarterData {
  id: number;
  name: string;
  months: number[];
  target: number;
  actual: number;
  commission: number;
  additionalPayment: number;
  complianceCtx: {
    pct: number;
    increment: number;
    tier: number;
    rate: number;
  };
}

interface VendorPayments {
  monthly: Record<number, number>;
  quarterly: Record<number, number>;
  total: number;
  details: Record<number, {
    totalPaid: number;
    ventaComision: number;
    objetivoReal: number;
    observaciones: string[];
    ultimaFecha: string;
  }>;
}

interface VendorCommissionData {
  vendedorCode: string;
  vendorName: string;
  months: MonthData[];
  quarters: QuarterData[];
  grandTotalCommission: number;
  isExcluded: boolean;
  payments: VendorPayments;
}

interface CommissionSummaryResult {
  config: CommissionConfig;
  grandTotalCommission: number;
  totals: { commission: number };
  months: MonthData[];
  quarters: QuarterData[];
  vendor?: string;
  breakdown: VendorCommissionData[];
  isExcluded?: boolean;
  payments: VendorPayments | { total: number; monthly: Record<number, number>; quarterly: Record<number, number> };
}

// ============================================
// EXCLUDED VENDORS CACHE
// ============================================

const DEFAULT_EXCLUDED = ['3', '13', '93', '80'];
let _excludedVendors: string[] = [...DEFAULT_EXCLUDED];
let _excludedLastLoad = 0;
const EXCLUDED_CACHE_TTL = 5 * 60 * 1000;

async function loadExcludedVendors(): Promise<string[]> {
  try {
    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT TRIM(CODIGOVENDEDOR) AS CODE
      FROM JAVIER.COMMISSION_EXCEPTIONS
      WHERE EXCLUIDO_COMISIONES = 'Y'
    `);

    if (rows && rows.length > 0) {
      const dbCodes = rows.map(r => String(r.CODE).trim());
      const normalized = rows.map(r => String(r.CODE).trim().replace(/^0+/, ''));
      _excludedVendors = [...new Set([...DEFAULT_EXCLUDED, ...dbCodes, ...normalized])];
    } else {
      _excludedVendors = [...DEFAULT_EXCLUDED];
    }
    _excludedLastLoad = Date.now();
    return _excludedVendors;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`[COMMISSIONS] Error loading excluded vendors: ${msg}`);
    return _excludedVendors;
  }
}

async function ensureExcludedVendorsLoaded(): Promise<string[]> {
  if (Date.now() - _excludedLastLoad > EXCLUDED_CACHE_TTL || _excludedVendors.length === 0) {
    await loadExcludedVendors();
  }
  return _excludedVendors;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Load commission config from DB, fallback to defaults.
 */
async function loadCommissionConfig(year: number): Promise<CommissionConfig> {
  const cacheKey = `gmp:comm:config:${year}`;
  return queryCache.getOrSet(cacheKey, async () => {
    try {
      const rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT * FROM JAVIER.COMM_CONFIG WHERE YEAR = ? FETCH FIRST 1 ROWS ONLY
      `, [year]);

      if (rows && rows.length > 0) {
        const row = rows[0];
        return {
          ipc: toFloat(row.IPC_PCT) || 3.0,
          TIER1_MAX: toFloat(row.TIER1_MAX) || 103,
          TIER1_PCT: toFloat(row.TIER1_PCT) || 1.0,
          TIER2_MAX: toFloat(row.TIER2_MAX) || 106,
          TIER2_PCT: toFloat(row.TIER2_PCT) || 1.3,
          TIER3_MAX: toFloat(row.TIER3_MAX) || 110,
          TIER3_PCT: toFloat(row.TIER3_PCT) || 1.6,
          TIER4_PCT: toFloat(row.TIER4_PCT) || 2.0,
        };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[COMMISSIONS] Error loading config for year ${year}: ${msg}`);
    }
    return { ...DEFAULT_COMMISSION_CONFIG };
  }, TTL.LONG);
}

/**
 * Get payment history for a vendor in a given year.
 */
async function getVendorPayments(vendorCode: string, year: number): Promise<VendorPayments> {
  const payments: VendorPayments = { monthly: {}, quarterly: {}, total: 0, details: {} };
  if (!vendorCode) return payments;

  const safeCode = sanitizeCode(vendorCode);
  const normalizedCode = safeCode.replace(/^0+/, '') || safeCode;

  try {
    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT MES, IMPORTE_PAGADO, COMISION_GENERADA, VENTAS_REAL,
             OBJETIVO_MES, OBSERVACIONES, FECHA_PAGO
      FROM JAVIER.COMMISSION_PAYMENTS
      WHERE (VENDEDOR_CODIGO = ? OR VENDEDOR_CODIGO = ?)
        AND ANIO = ?
      ORDER BY MES, FECHA_PAGO
    `, [safeCode, normalizedCode, year]);

    for (const r of rows) {
      const amount = toFloat(r.IMPORTE_PAGADO);
      const mes = toInt(r.MES);
      payments.total += amount;

      if (mes > 0) {
        payments.monthly[mes] = (payments.monthly[mes] || 0) + amount;
        if (!payments.details[mes]) {
          payments.details[mes] = {
            totalPaid: 0,
            ventaComision: toFloat(r.VENTAS_REAL),
            objetivoReal: toFloat(r.OBJETIVO_MES),
            observaciones: [],
            ultimaFecha: String(r.FECHA_PAGO || ''),
          };
        }
        payments.details[mes].totalPaid += amount;
        const obs = String(r.OBSERVACIONES || '').trim();
        if (obs) payments.details[mes].observaciones.push(obs);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug(`[COMMISSIONS] Payment lookup error for ${vendorCode}: ${msg}`);
  }
  return payments;
}

/**
 * Get fixed commission base from COMMERCIAL_TARGETS if configured.
 */
async function getFixedCommissionBase(vendorCode: string, year: number): Promise<number | null> {
  try {
    const safeCode = sanitizeCode(vendorCode);
    const currentMonth = new Date().getMonth() + 1;
    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT IMPORTE_BASE_COMISION
      FROM JAVIER.COMMERCIAL_TARGETS
      WHERE CODIGOVENDEDOR = ?
        AND ANIO = ?
        AND (MES = ? OR MES IS NULL)
        AND ACTIVO = 1
      ORDER BY MES DESC
      FETCH FIRST 1 ROWS ONLY
    `, [safeCode, year, currentMonth]);

    if (rows && rows.length > 0) {
      const val = toFloat(rows[0].IMPORTE_BASE_COMISION);
      return val > 0 ? val : null;
    }
  } catch {
    // Table might not exist
  }
  return null;
}

/**
 * Get vendor active route days from LACLAE data.
 */
async function getVendorActiveDays(vendorCode: string): Promise<string[]> {
  const defaultDays = ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V'];
  try {
    const safeCode = sanitizeCode(vendorCode);
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
  } catch {
    return defaultDays;
  }
}

// ============================================
// CORE CALCULATION
// ============================================

/**
 * Calculate full commission data for a single vendor.
 */
async function calculateVendorData(
  vendedorCode: string,
  selectedYear: number,
  config: CommissionConfig,
  excludedVendors: string[],
): Promise<VendorCommissionData> {
  const prevYear = selectedYear - 1;
  const normalizedCode = vendedorCode.trim().replace(/^0+/, '') || vendedorCode.trim();
  const isExcluded = excludedVendors.includes(normalizedCode);

  // Get active days, sales data, B-sales, and fixed commission base in parallel
  const [activeDays, fixedCommissionBase, bSalesCurrYear, bSalesPrevYear] = await Promise.all([
    getVendorActiveDays(vendedorCode),
    getFixedCommissionBase(vendedorCode, selectedYear),
    getBSales(vendedorCode, selectedYear),
    getBSales(vendedorCode, prevYear),
  ]);

  // Get sales from LACLAE
  const { clause: vendorClause, params: vendorParams } = buildVendedorFilterLACLAE(vendedorCode);
  const salesRows = await odbcPool.query<Record<string, unknown>[]>(`
    SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH, SUM(L.LCIMVT) AS SALES
    FROM DSED.LACLAE L
    WHERE L.LCAADC IN (?, ?)
      AND ${LACLAE_SALES_FILTER}
      ${vendorClause}
    GROUP BY L.LCAADC, L.LCMMDC
    ORDER BY L.LCAADC, L.LCMMDC
  `, [selectedYear, prevYear, ...vendorParams]);

  // Check for inherited objectives
  let inheritedMonthlySales: Record<number, number> = {};
  const monthsWithData = salesRows.filter(r => toInt(r.YEAR) === prevYear).map(r => toInt(r.MONTH));
  const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

  if (missingMonths.length > 0) {
    const currentClients = await getVendorCurrentClients(vendedorCode, selectedYear);
    if (currentClients.length > 0) {
      const clientSales = await getClientsMonthlySales(currentClients, prevYear);
      for (const [m, data] of Object.entries(clientSales)) {
        inheritedMonthlySales[Number(m)] = data.sales;
      }
    }
  }

  // Build month-by-month data
  const months: MonthData[] = [];
  const quarters: QuarterData[] = [
    { id: 1, name: 'Primer Cuatrimestre', months: [1, 2, 3, 4], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: { pct: 0, increment: 0, tier: 0, rate: 0 } },
    { id: 2, name: 'Segundo Cuatrimestre', months: [5, 6, 7, 8], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: { pct: 0, increment: 0, tier: 0, rate: 0 } },
    { id: 3, name: 'Tercer Cuatrimestre', months: [9, 10, 11, 12], target: 0, actual: 0, commission: 0, additionalPayment: 0, complianceCtx: { pct: 0, increment: 0, tier: 0, rate: 0 } },
  ];

  let grandTotalCommission = 0;
  const now = new Date();

  for (let m = 1; m <= 12; m++) {
    const prevRow = salesRows.find(r => toInt(r.YEAR) === prevYear && toInt(r.MONTH) === m);
    const currRow = salesRows.find(r => toInt(r.YEAR) === selectedYear && toInt(r.MONTH) === m);

    let prevSales = prevRow ? toFloat(prevRow.SALES) : 0;
    let currentSales = currRow ? toFloat(currRow.SALES) : 0;

    // Add B-sales
    prevSales += (bSalesPrevYear[m] || 0);
    currentSales += (bSalesCurrYear[m] || 0);

    // Inherited objectives
    if (prevSales === 0 && inheritedMonthlySales[m]) {
      prevSales = inheritedMonthlySales[m];
    }

    // Target calculation
    let target: number;
    if (fixedCommissionBase && fixedCommissionBase > 0) {
      target = fixedCommissionBase;
    } else {
      target = prevSales * (1 + config.ipc / 100);
    }

    const result = calculateCommission(currentSales, target, config);
    const commValue = isExcluded ? 0 : result.commission;
    grandTotalCommission += commValue;

    // Add to quarter
    const qIdx = Math.floor((m - 1) / 4);
    quarters[qIdx].target += target;
    quarters[qIdx].actual += currentSales;
    if (!isExcluded) quarters[qIdx].commission += commValue;

    // Working days
    const workingDays = calculateWorkingDays(selectedYear, m, activeDays);
    const isFuture = selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && m > now.getMonth() + 1);
    const isCurrentMonth = selectedYear === now.getFullYear() && m === now.getMonth() + 1;
    const daysPassed = isCurrentMonth
      ? calculateDaysPassed(selectedYear, m, activeDays)
      : isFuture ? 0 : workingDays;

    const proRatedTarget = workingDays > 0 ? (target / workingDays) * daysPassed : 0;
    const dailyTarget = workingDays > 0 ? target / workingDays : 0;
    const dailyActual = daysPassed > 0 ? currentSales / daysPassed : 0;
    const isOnTrack = currentSales >= proRatedTarget;

    const provisionalResult = calculateCommission(currentSales, proRatedTarget, config);
    const provisionalCommission = isExcluded ? 0 : provisionalResult.commission;

    months.push({
      month: m,
      prevSales, target, actual: currentSales,
      workingDays, daysPassed, proRatedTarget, dailyTarget, dailyActual, isFuture,
      complianceCtx: {
        pct: target > 0 ? (currentSales / target) * 100 : 0,
        increment: result.increment, tier: result.tier, rate: result.rate,
        commission: commValue, isExcluded,
      },
      dailyComplianceCtx: {
        pct: proRatedTarget > 0 ? (currentSales / proRatedTarget) * 100 : 0,
        tier: provisionalResult.tier, rate: provisionalResult.rate,
        isGreen: isOnTrack, provisionalCommission, increment: provisionalResult.increment,
      },
    });
  }

  // Quarterly catch-up
  for (const q of quarters) {
    const result = calculateCommission(q.actual, q.target, config);
    const potentialTotal = isExcluded ? 0 : result.commission;
    const diff = potentialTotal - q.commission;
    if (diff > 0.01) {
      q.additionalPayment = diff;
      grandTotalCommission += diff;
    }
    q.complianceCtx = {
      pct: q.target > 0 ? (q.actual / q.target) * 100 : 0,
      increment: result.increment, tier: result.tier, rate: result.rate,
    };
  }

  const [vendorName, payments] = await Promise.all([
    getVendorName(vendedorCode),
    getVendorPayments(vendedorCode, selectedYear),
  ]);

  return {
    vendedorCode, vendorName, months, quarters,
    grandTotalCommission, isExcluded, payments,
  };
}

// ============================================
// SERVICE CLASS
// ============================================

class CommissionsService {
  /**
   * GET /commissions/summary
   * Main endpoint: full commission breakdown for vendor(s) and year(s).
   */
  async getSummary(vendorCode: string, years: number[]): Promise<CommissionSummaryResult> {
    await ensureExcludedVendorsLoaded();
    const config = await loadCommissionConfig(years[0]);
    const isAll = vendorCode.toUpperCase() === 'ALL';

    let aggregatedResult: CommissionSummaryResult | null = null;

    for (const yr of years) {
      let yearResult: CommissionSummaryResult;

      if (isAll) {
        yearResult = await this._calculateAllVendors(yr, config);
      } else {
        const data = await calculateVendorData(sanitizeCode(vendorCode), yr, config, _excludedVendors);
        yearResult = {
          config,
          grandTotalCommission: data.grandTotalCommission,
          totals: { commission: data.grandTotalCommission },
          months: data.months,
          quarters: data.quarters,
          vendor: data.vendedorCode,
          breakdown: [],
          isExcluded: data.isExcluded,
          payments: data.payments,
        };
      }

      aggregatedResult = aggregatedResult
        ? this._mergeResults(aggregatedResult, yearResult)
        : yearResult;
    }

    return aggregatedResult!;
  }

  /**
   * Calculate commissions for ALL vendors (team view).
   */
  private async _calculateAllVendors(year: number, config: CommissionConfig): Promise<CommissionSummaryResult> {
    const vendorRows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT DISTINCT TRIM(L.LCCDVD) AS VENDOR_CODE
      FROM DSED.LACLAE L
      WHERE L.LCAADC IN (?, ?)
        AND L.LCCDVD IS NOT NULL
        AND TRIM(L.LCCDVD) <> ''
    `, [year, year - 1]);

    const vendorCodes = vendorRows.map(r => String(r.VENDOR_CODE).trim()).filter(c => c && c !== '0');
    const settled = await Promise.allSettled(
      vendorCodes.map(code => calculateVendorData(code, year, config, _excludedVendors)),
    );

    const results = settled.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<VendorCommissionData>).value);
    const failed = settled.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn(`[COMMISSIONS] ${failed.length} vendor(s) failed in ALL mode`);
    }

    results.sort((a, b) => (b.grandTotalCommission || 0) - (a.grandTotalCommission || 0));
    const globalTotal = results.reduce((s, r) => s + r.grandTotalCommission, 0);
    const totalPaid = results.reduce((s, r) => s + (r.payments?.total || 0), 0);

    // Aggregate months/quarters
    const aggMonths: MonthData[] = [];
    for (let m = 1; m <= 12; m++) {
      let tT = 0, tA = 0, tC = 0;
      for (const r of results) {
        const md = r.months.find(x => x.month === m);
        if (md) { tT += md.target; tA += md.actual; tC += md.complianceCtx.commission; }
      }
      aggMonths.push({
        month: m, target: tT, actual: tA, prevSales: 0,
        workingDays: 0, daysPassed: 0, proRatedTarget: 0, dailyTarget: 0, dailyActual: 0, isFuture: false,
        complianceCtx: { pct: tT > 0 ? (tA / tT) * 100 : 0, increment: tA - tT, tier: 0, rate: 0, commission: tC, isExcluded: false },
        dailyComplianceCtx: { pct: 0, tier: 0, rate: 0, isGreen: false, provisionalCommission: 0, increment: 0 },
      });
    }

    const aggQuarters = [1, 2, 3].map(q => {
      let tT = 0, tA = 0, tC = 0;
      for (const r of results) {
        const qd = r.quarters.find(x => x.id === q);
        if (qd) { tT += qd.target; tA += qd.actual; tC += (qd.commission + qd.additionalPayment); }
      }
      return {
        id: q, name: '', months: [], target: tT, actual: tA, commission: tC, additionalPayment: 0,
        complianceCtx: { pct: tT > 0 ? (tA / tT) * 100 : 0, increment: tA - tT, tier: 0, rate: 0 },
      };
    });

    return {
      config, grandTotalCommission: globalTotal,
      totals: { commission: globalTotal },
      breakdown: results, months: aggMonths, quarters: aggQuarters,
      payments: { total: totalPaid, monthly: {}, quarterly: {} },
    };
  }

  /**
   * POST /commissions/pay
   * Record a commission payment.
   */
  async recordPayment(params: {
    vendedorCode: string; year: number; month: number;
    amount: number; generatedAmount: number;
    observaciones?: string; adminCode: string;
    objetivoMes?: number; ventasSobreObjetivo?: number;
  }): Promise<{ success: boolean; message: string }> {
    const {
      vendedorCode, year, month, amount, generatedAmount,
      observaciones, adminCode, objetivoMes, ventasSobreObjetivo,
    } = params;

    // Validate partial payment requires observaciones
    if (amount < generatedAmount && (!observaciones || observaciones.trim() === '')) {
      throw new Error('Debes indicar una observación explicando por qué se paga menos de lo correspondiente');
    }

    // Get current sales snapshot for the month
    let ventaComision = 0;
    if (month > 0) {
      try {
        const safeCode = sanitizeCode(vendedorCode);
        const { clause, params: vParams } = buildVendedorFilterLACLAE(vendedorCode);
        const salesRows = await odbcPool.query<Record<string, unknown>[]>(`
          SELECT SUM(L.LCIMVT) AS SALES
          FROM DSED.LACLAE L
          WHERE L.LCAADC = ? AND L.LCMMDC = ?
            AND ${LACLAE_SALES_FILTER}
            ${clause}
        `, [year, month, ...vParams]);

        if (salesRows.length > 0) {
          ventaComision = toFloat(salesRows[0].SALES);
        }
        const bSales = await getBSales(vendedorCode, year);
        ventaComision += (bSales[month] || 0);
      } catch {
        // Non-critical
      }
    }

    const safeVendor = sanitizeCode(vendedorCode);
    const safeObs = (observaciones || '').substring(0, 1000);
    const safeAdmin = sanitizeCode(adminCode || 'UNKNOWN');

    await odbcPool.query(`
      INSERT INTO JAVIER.COMMISSION_PAYMENTS
      (VENDEDOR_CODIGO, ANIO, MES, VENTAS_REAL, OBJETIVO_MES,
       VENTAS_SOBRE_OBJETIVO, COMISION_GENERADA, IMPORTE_PAGADO,
       FECHA_PAGO, OBSERVACIONES, CREADO_POR)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    `, [
      safeVendor, year, month || 0,
      ventaComision, objetivoMes || 0, ventasSobreObjetivo || 0,
      generatedAmount || 0, amount,
      safeObs, safeAdmin,
    ]);

    logger.info(`[COMMISSIONS] Payment registered: ${safeVendor} ${amount}€ by ${safeAdmin}`);
    return { success: true, message: 'Pago registrado correctamente' };
  }

  /**
   * Verify admin authorization for payment operations.
   */
  async verifyAdminAuth(adminCode: string): Promise<boolean> {
    if (!adminCode) return false;
    const safeCode = sanitizeCode(adminCode);
    const normalizedCode = safeCode.replace(/^0+/, '') || safeCode;

    try {
      const rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT TIPOVENDEDOR
        FROM DSEDAC.VDC
        WHERE TRIM(CODIGOVENDEDOR) = ?
          AND SUBEMPRESA = 'GMP'
        FETCH FIRST 1 ROWS ONLY
      `, [safeCode]);

      const tipo = rows.length > 0 ? String(rows[0].TIPOVENDEDOR || '').trim() : '';
      return tipo === 'ADMIN' || normalizedCode === '98';
    } catch {
      return false;
    }
  }

  /**
   * GET /commissions/excluded-vendors
   */
  async getExcludedVendors(): Promise<string[]> {
    await loadExcludedVendors();
    return _excludedVendors;
  }

  /**
   * Merge multi-year results into a single aggregated result.
   */
  private _mergeResults(a: CommissionSummaryResult, b: CommissionSummaryResult): CommissionSummaryResult {
    return {
      config: a.config,
      isExcluded: a.isExcluded || b.isExcluded,
      grandTotalCommission: a.grandTotalCommission + b.grandTotalCommission,
      totals: { commission: (a.totals?.commission || 0) + (b.totals?.commission || 0) },
      breakdown: this._mergeBreakdowns(a.breakdown, b.breakdown),
      months: this._mergeTimeUnits(a.months, b.months),
      quarters: this._mergeTimeUnits(a.quarters as any[], b.quarters as any[]) as any[],
      payments: {
        total: (a.payments?.total || 0) + (b.payments?.total || 0),
        monthly: { ...(a.payments as any)?.monthly },
        quarterly: { ...(a.payments as any)?.quarterly },
      },
    };
  }

  private _mergeBreakdowns(listA: VendorCommissionData[], listB: VendorCommissionData[]): VendorCommissionData[] {
    if (!listA?.length) return listB || [];
    if (!listB?.length) return listA || [];

    const map = new Map<string, VendorCommissionData>();
    for (const item of [...listA, ...listB]) {
      if (!map.has(item.vendedorCode)) {
        map.set(item.vendedorCode, { ...item });
      } else {
        const existing = map.get(item.vendedorCode)!;
        existing.grandTotalCommission += item.grandTotalCommission;
      }
    }
    return Array.from(map.values());
  }

  private _mergeTimeUnits(listA: any[], listB: any[]): any[] {
    if (!listA?.length) return listB || [];
    if (!listB?.length) return listA || [];

    const merged: any[] = [];
    const maxId = Math.max(
      ...listA.map(i => i.month || i.id || 0),
      ...listB.map(i => i.month || i.id || 0),
    );

    for (let i = 1; i <= maxId; i++) {
      const dA = listA.find(x => (x.month || x.id) === i);
      const dB = listB.find(x => (x.month || x.id) === i);
      if (!dA && !dB) continue;

      const base = dA ? { ...dA } : { ...dB };
      if (dA && dB) {
        base.target = (dA.target || 0) + (dB.target || 0);
        base.actual = (dA.actual || 0) + (dB.actual || 0);
        if (base.complianceCtx) {
          base.complianceCtx.commission = (dA.complianceCtx?.commission || 0) + (dB.complianceCtx?.commission || 0);
        }
      }
      merged.push(base);
    }
    return merged;
  }
}

export const commissionsService = new CommissionsService();
