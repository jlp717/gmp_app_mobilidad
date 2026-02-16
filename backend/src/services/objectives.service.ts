/**
 * OBJECTIVES SERVICE - Refactored from legacy objectives.js (1929 lines)
 *
 * Handles sales objectives, targets and performance tracking:
 *   - Summary: quota vs actual for a vendor/month
 *   - Evolution: monthly evolution across years with seasonal targets
 *   - Matrix: product-level analysis for a specific client (5-level FI hierarchy)
 *   - Populations: distinct cities for dropdown filters
 *   - By-Client: per-client objective progress
 *
 * SECURITY: All queries use parameterized placeholders (?).
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { toFloat, toInt, toStr } from '../utils/db-helpers';
import { sanitizeCode, sanitizeSearch, buildInClause } from '../utils/validators';
import { queryCache, TTL } from '../utils/query-cache';
import {
  LACLAE_SALES_FILTER,
  calculateWorkingDays,
  calculateDaysPassed,
  getVendorCurrentClients,
  getClientsMonthlySales,
  getBSales,
  buildVendedorFilterLACLAE,
  buildVendedorFilterLAC,
  getVendorActiveDays,
  getVendorTargetConfig,
  getFixedMonthlyTarget,
} from '../utils/vendor-helpers';

// ============================================
// CONSTANTS
// ============================================

const SEASONAL_AGGRESSIVENESS = 0.5;
const MIN_YEAR = new Date().getFullYear() - 2;

const MONTH_QUOTA_MAP: Record<number, string> = {
  1: 'CUOTAENERO', 2: 'CUOTAFEBRERO', 3: 'CUOTAMARZO', 4: 'CUOTAABRIL',
  5: 'CUOTAMAYO', 6: 'CUOTAJUNIO', 7: 'CUOTAJULIO', 8: 'CUOTAAGOSTO',
  9: 'CUOTASEPTIEMBRE', 10: 'CUOTAOCTUBRE', 11: 'CUOTANOVIEMBRE', 12: 'CUOTADICIEMBRE',
};

// ============================================
// TYPES
// ============================================

interface FilterNames {
  family: Record<string, string>;
  fi1: Record<string, string>;
  fi2: Record<string, string>;
  fi3: Record<string, string>;
  fi4: Record<string, string>;
  fi5: Record<string, string>;
}

interface LevelData {
  code: string;
  name: string;
  level: number;
  totalSales: number; totalCost: number; totalUnits: number;
  prevYearSales: number; prevYearCost: number; prevYearUnits: number;
  monthlyData: Record<string, Record<string, { sales: number; cost: number; units: number }>>;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Loads filter/family names from DSEDAC tables with caching.
 */
async function loadFilterNames(): Promise<FilterNames> {
  const cacheKey = 'gmp:metadata:filterNames';
  return queryCache.getOrSet(cacheKey, async () => {
    const result: FilterNames = { family: {}, fi1: {}, fi2: {}, fi3: {}, fi4: {}, fi5: {} };
    try {
      const [famRows, fi1Rows, fi2Rows, fi3Rows, fi4Rows, fi5Rows] = await Promise.all([
        odbcPool.query<Record<string, unknown>[]>('SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA FROM DSEDAC.FAM'),
        odbcPool.query<Record<string, unknown>[]>('SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI1'),
        odbcPool.query<Record<string, unknown>[]>('SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI2'),
        odbcPool.query<Record<string, unknown>[]>('SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI3'),
        odbcPool.query<Record<string, unknown>[]>('SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI4'),
        odbcPool.query<Record<string, unknown>[]>('SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.FI5'),
      ]);

      for (const r of famRows) result.family[toStr(r.CODIGOFAMILIA).trim()] = toStr(r.DESCRIPCIONFAMILIA).trim();
      for (const r of fi1Rows) { const c = toStr(r.CODIGOFILTRO).trim(); if (c) result.fi1[c] = toStr(r.DESCRIPCIONFILTRO).trim(); }
      for (const r of fi2Rows) { const c = toStr(r.CODIGOFILTRO).trim(); if (c) result.fi2[c] = toStr(r.DESCRIPCIONFILTRO).trim(); }
      for (const r of fi3Rows) { const c = toStr(r.CODIGOFILTRO).trim(); if (c) result.fi3[c] = toStr(r.DESCRIPCIONFILTRO).trim(); }
      for (const r of fi4Rows) { const c = toStr(r.CODIGOFILTRO).trim(); if (c) result.fi4[c] = toStr(r.DESCRIPCIONFILTRO).trim(); }
      for (const r of fi5Rows) { const c = toStr(r.CODIGOFILTRO).trim(); if (c) result.fi5[c] = toStr(r.DESCRIPCIONFILTRO).trim(); }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[OBJECTIVES] Could not load filter names: ${msg}`);
    }
    return result;
  }, TTL.LONG);
}

/**
 * Formats level monthly data for response (FI hierarchy levels).
 */
function formatLevelMonthly(
  monthlyData: Record<string, Record<string, { sales: number; cost: number; units: number }>>,
  yearsArray: number[],
): Record<string, unknown> {
  const isSelectedYear = (y: number) => yearsArray.includes(y);
  const isPrevYear = (y: number) => yearsArray.some(s => s - 1 === y);
  const output: Record<string, unknown> = {};

  for (let m = 1; m <= 12; m++) {
    const mStr = m.toString();
    let selectedSales = 0, selectedUnits = 0, selectedCost = 0;
    let prevSales = 0, prevUnits = 0, prevCost = 0;

    for (const [yearStr, mData] of Object.entries(monthlyData)) {
      const y = parseInt(yearStr);
      const md = mData[mStr];
      if (!md) continue;
      if (isSelectedYear(y)) { selectedSales += md.sales; selectedUnits += md.units; selectedCost += md.cost; }
      else if (isPrevYear(y)) { prevSales += md.sales; prevUnits += md.units; prevCost += md.cost; }
    }

    let mTrend = 'neutral';
    let mVar = 0;
    if (prevSales > 0) {
      mVar = ((selectedSales - prevSales) / prevSales) * 100;
      if (mVar > 5) mTrend = 'up'; else if (mVar < -5) mTrend = 'down';
    } else if (selectedSales > 0) {
      mTrend = 'new';
    }

    output[mStr] = {
      sales: parseFloat(selectedSales.toFixed(2)),
      cost: parseFloat(selectedCost.toFixed(2)),
      units: parseFloat(selectedUnits.toFixed(2)),
      prevSales: parseFloat(prevSales.toFixed(2)),
      prevCost: parseFloat(prevCost.toFixed(2)),
      yoyTrend: mTrend,
      yoyVariation: parseFloat(mVar.toFixed(1)),
    };
  }
  return output;
}

/**
 * Formats level summary (margin, YoY, trend) for FI hierarchy nodes.
 */
function formatLevelSummary(level: LevelData, yearsArray: number[]) {
  const margin = level.totalSales - level.totalCost;
  const marginPercent = level.totalSales > 0 ? (margin / level.totalSales) * 100 : 0;
  const prevMargin = level.prevYearSales - level.prevYearCost;
  const variation = level.prevYearSales > 0
    ? ((level.totalSales - level.prevYearSales) / level.prevYearSales) * 100 : 0;

  let yoyTrend = 'neutral';
  if (level.prevYearSales === 0 && level.totalSales > 0) yoyTrend = 'new';
  else if (variation > 5) yoyTrend = 'up';
  else if (variation < -5) yoyTrend = 'down';

  return {
    code: level.code,
    name: level.name,
    level: level.level,
    totalSales: parseFloat(level.totalSales.toFixed(2)),
    totalUnits: parseFloat(level.totalUnits.toFixed(2)),
    totalCost: parseFloat(level.totalCost.toFixed(2)),
    totalMargin: parseFloat(margin.toFixed(2)),
    totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
    prevYearSales: parseFloat(level.prevYearSales.toFixed(2)),
    prevYearUnits: parseFloat(level.prevYearUnits.toFixed(2)),
    prevYearCost: parseFloat(level.prevYearCost.toFixed(2)),
    prevYearMargin: parseFloat(prevMargin.toFixed(2)),
    yoyTrend,
    yoyVariation: parseFloat(variation.toFixed(1)),
    monthlyData: formatLevelMonthly(level.monthlyData, yearsArray),
  };
}

/**
 * Accumulates sales data into a level node (FI or family).
 */
function accumulateLevel(
  level: { totalSales: number; totalCost: number; totalUnits: number;
    prevYearSales: number; prevYearCost: number; prevYearUnits: number;
    monthlyData: Record<string, Record<string, { sales: number; cost: number; units: number }>> },
  year: number, month: number, sales: number, cost: number, units: number,
  isSelected: boolean, isPrev: boolean,
) {
  if (isSelected) {
    level.totalSales += sales;
    level.totalCost += cost;
    level.totalUnits += units;
  } else if (isPrev) {
    level.prevYearSales += sales;
    level.prevYearCost += cost;
    level.prevYearUnits += units;
  }
  const ys = year.toString();
  const ms = month.toString();
  if (!level.monthlyData[ys]) level.monthlyData[ys] = {};
  if (!level.monthlyData[ys][ms]) level.monthlyData[ys][ms] = { sales: 0, cost: 0, units: 0 };
  level.monthlyData[ys][ms].sales += sales;
  level.monthlyData[ys][ms].cost += cost;
  level.monthlyData[ys][ms].units += units;
}

// ============================================
// SERVICE CLASS
// ============================================

class ObjectivesService {

  // ============================================
  // GET / - Summary (Quota vs Actual)
  // ============================================

  async getSummary(params: {
    vendedorCodes?: string; year?: number; month?: number;
  }): Promise<Record<string, unknown>> {
    const now = new Date();
    const targetYear = params.year || now.getFullYear();
    const targetMonth = params.month || (now.getMonth() + 1);
    const vendedorCodes = params.vendedorCodes;

    const targetPct = await getVendorTargetConfig(vendedorCodes);

    // 1. Try COFC quota table
    let salesObjective = 0;
    let marginObjective = 0;
    let objectiveSource = 'calculated';

    try {
      const quotaField = MONTH_QUOTA_MAP[targetMonth];
      if (quotaField) {
        const quotaResult = await odbcPool.query<Record<string, unknown>[]>(`
          SELECT COALESCE(SUM(${quotaField}), 0) AS QUOTA
          FROM DSEDAC.COFC
          WHERE CODIGOTIPOCUOTA IS NOT NULL
        `);
        const quota = toFloat(quotaResult[0]?.QUOTA);
        if (quota > 0) {
          salesObjective = quota;
          objectiveSource = 'database';
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug(`[OBJECTIVES] COFC query failed: ${msg}`);
    }

    // 2. Try CMV vendor-specific objective
    if (salesObjective === 0 && vendedorCodes && vendedorCodes !== 'ALL') {
      try {
        const safeCode = sanitizeCode(vendedorCodes.split(',')[0]);
        const cmvResult = await odbcPool.query<Record<string, unknown>[]>(`
          SELECT COALESCE(IMPORTEOBJETIVO, 0) AS OBJETIVO
          FROM DSEDAC.CMV
          WHERE TRIM(CODIGOVENDEDOR) = ?
        `, [safeCode]);

        const cmvObjective = toFloat(cmvResult[0]?.OBJETIVO);
        if (cmvObjective > 0) {
          salesObjective = cmvObjective;
          objectiveSource = 'database';
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.debug(`[OBJECTIVES] CMV query failed: ${msg}`);
      }
    }

    // 3. Get current & previous year sales from LAC
    const { clause: vendorClause, params: vendorParams } = buildVendedorFilterLAC(vendedorCodes || '');

    const [currentSalesResult, lastYearSalesResult, prevYearAnnualResult] = await Promise.all([
      odbcPool.query<Record<string, unknown>[]>(`
        SELECT
          COALESCE(SUM(IMPORTEVENTA), 0) AS SALES,
          COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) AS MARGIN,
          COUNT(DISTINCT CODIGOCLIENTEALBARAN) AS CLIENTS
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? ${vendorClause}
      `, [targetYear, targetMonth, ...vendorParams]),
      odbcPool.query<Record<string, unknown>[]>(`
        SELECT
          COALESCE(SUM(IMPORTEVENTA), 0) AS SALES,
          COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) AS MARGIN,
          COUNT(DISTINCT CODIGOCLIENTEALBARAN) AS CLIENTS
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? ${vendorClause}
      `, [targetYear - 1, targetMonth, ...vendorParams]),
      odbcPool.query<Record<string, unknown>[]>(`
        SELECT COALESCE(SUM(IMPORTEVENTA), 0) AS TOTAL_SALES
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = ? ${vendorClause}
      `, [targetYear - 1, ...vendorParams]),
    ]);

    const salesCurrent = toFloat(currentSalesResult[0]?.SALES);
    const salesLast = toFloat(lastYearSalesResult[0]?.SALES);
    const totalPrevYear = toFloat(prevYearAnnualResult[0]?.TOTAL_SALES);

    // 4. Calculate objective if not from DB
    if (salesObjective === 0) {
      if (totalPrevYear > 0) {
        const avgMonthlySales = totalPrevYear / 12;
        const deviationRatio = avgMonthlySales > 0 ? (salesLast - avgMonthlySales) / avgMonthlySales : 0;
        const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));
        salesObjective = salesLast * (1 + variableGrowthPct);
        objectiveSource = 'seasonality_dynamic';
      } else if (salesLast === 0 && salesCurrent > 0) {
        salesObjective = salesCurrent * (1 + targetPct / 100);
      } else {
        salesObjective = salesLast * (1 + targetPct / 100);
      }
    }

    const salesProgress = salesObjective > 0 ? (salesCurrent / salesObjective) * 100 : 0;
    const marginCurrent = toFloat(currentSalesResult[0]?.MARGIN);
    const marginLast = toFloat(lastYearSalesResult[0]?.MARGIN);
    marginObjective = marginObjective || (marginLast * (1 + targetPct / 100));
    const marginProgress = marginObjective > 0 ? (marginCurrent / marginObjective) * 100 : 0;

    const clientsCurrent = toInt(currentSalesResult[0]?.CLIENTS);
    const clientsLast = toInt(lastYearSalesResult[0]?.CLIENTS);
    const clientsObjective = Math.ceil(clientsLast * 1.05);
    const clientsProgress = clientsObjective > 0 ? (clientsCurrent / clientsObjective) * 100 : 0;

    const alerts: { type: string; message: string }[] = [];
    if (salesProgress < 80) alerts.push({ type: 'warning', message: `Ventas al ${salesProgress.toFixed(0)}% del objetivo` });
    if (salesProgress < 50) alerts.push({ type: 'danger', message: 'Ventas muy por debajo del objetivo' });
    if (marginProgress < 70) alerts.push({ type: 'warning', message: 'Margen por debajo del esperado' });

    return {
      period: { year: targetYear, month: targetMonth },
      objectiveSource,
      targetPercentage: targetPct,
      objectives: {
        sales: {
          target: salesObjective, current: salesCurrent, lastYear: salesLast,
          progress: Math.round(salesProgress * 10) / 10,
          variation: salesLast > 0 ? Math.round(((salesCurrent - salesLast) / salesLast) * 1000) / 10 : 0,
        },
        margin: {
          target: marginObjective, current: marginCurrent, lastYear: marginLast,
          progress: Math.round(marginProgress * 10) / 10,
        },
        clients: {
          target: clientsObjective, current: clientsCurrent, lastYear: clientsLast,
          progress: Math.round(clientsProgress * 10) / 10,
        },
      },
      alerts,
    };
  }

  // ============================================
  // GET /evolution - Monthly Evolution
  // ============================================

  async getEvolution(params: {
    vendedorCodes?: string; years?: string;
  }): Promise<Record<string, unknown>> {
    const now = new Date();
    const yearsArray = params.years
      ? params.years.split(',').map(y => parseInt(y.trim(), 10)).filter(y => y >= MIN_YEAR)
      : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

    // Include previous years for objective calculation
    const uniqueYears = [...new Set([...yearsArray, ...yearsArray.map(y => y - 1)])];
    const { clause: yearsClause, params: yearsParams } = buildInClause('L.LCAADC', uniqueYears.map(String));

    const vendedorCodes = params.vendedorCodes;
    const isAll = !vendedorCodes || vendedorCodes === 'ALL';
    const { clause: vendorClause, params: vendorParams } = buildVendedorFilterLACLAE(vendedorCodes || '');

    // Get active days for working day calculations
    let activeWeekDays: string[] = [];
    if (!isAll) {
      const firstCode = vendedorCodes!.split(',')[0].trim();
      activeWeekDays = await getVendorActiveDays(firstCode);
    }

    // Monthly totals per year from LACLAE
    const rows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT
        L.LCAADC AS YEAR,
        L.LCMMDC AS MONTH,
        SUM(L.LCIMVT) AS SALES,
        SUM(L.LCIMCT) AS COST,
        COUNT(DISTINCT L.LCCDCL) AS CLIENTS
      FROM DSED.LACLAE L
      WHERE ${yearsClause}
        AND ${LACLAE_SALES_FILTER}
        ${vendorClause}
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY L.LCAADC, L.LCMMDC
    `, [...yearsParams, ...vendorParams]);

    // Mutable array for B-sales injection
    const mutableRows = rows.map(r => ({
      YEAR: toInt(r.YEAR), MONTH: toInt(r.MONTH),
      SALES: toFloat(r.SALES), COST: toFloat(r.COST), CLIENTS: toInt(r.CLIENTS),
    }));

    // Add B-sales
    if (!isAll) {
      const firstCode = vendedorCodes!.split(',')[0].trim();
      for (const yr of uniqueYears) {
        const bSalesMap = await getBSales(firstCode, yr);
        for (const [month, amount] of Object.entries(bSalesMap)) {
          const m = parseInt(month);
          const existingRow = mutableRows.find(r => r.YEAR === yr && r.MONTH === m);
          if (existingRow) {
            existingRow.SALES += amount;
          } else if (amount > 0) {
            mutableRows.push({ YEAR: yr, MONTH: m, SALES: amount, COST: 0, CLIENTS: 0 });
          }
        }
      }
    }

    // Load inherited objectives for new vendors
    let inheritedMonthlySales: Record<number, { sales: number; cost: number; clients: number }> = {};
    if (!isAll) {
      const currentYear = yearsArray[0] || now.getFullYear();
      const prevYear = currentYear - 1;
      const monthsWithData = mutableRows.filter(r => r.YEAR === prevYear).map(r => r.MONTH);
      const missingMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter(m => !monthsWithData.includes(m));

      if (missingMonths.length > 0) {
        const firstCode = vendedorCodes!.split(',')[0].trim();
        const currentClients = await getVendorCurrentClients(firstCode, currentYear);
        if (currentClients.length > 0) {
          inheritedMonthlySales = await getClientsMonthlySales(currentClients, prevYear);
        }
      }
    }

    // Fixed monthly targets
    let fixedMonthlyTargetAmount: number | null = null;
    if (!isAll) {
      const firstCode = vendedorCodes!.split(',')[0].trim();
      const currentYear = yearsArray[0] || now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const { objetivo } = await getFixedMonthlyTarget(firstCode, currentYear, currentMonth);
      fixedMonthlyTargetAmount = objetivo;
    }

    // Get target config
    const targetPct = await getVendorTargetConfig(vendedorCodes);

    // Build yearly data
    const yearlyData: Record<number, unknown[]> = {};
    const yearTotals: Record<number, unknown> = {};

    for (const year of yearsArray) {
      // Calculate previous year totals and seasonal factors
      let prevYearTotal = 0;
      let inheritedTotal = 0;
      let currentYearTotalSoFar = 0;
      const prevYearMonthlySales: Record<number, number> = {};

      for (let m = 1; m <= 12; m++) {
        const prevRow = mutableRows.find(r => r.YEAR === (year - 1) && r.MONTH === m);
        const currRow = mutableRows.find(r => r.YEAR === year && r.MONTH === m);
        const ownPrevSales = prevRow ? prevRow.SALES : 0;

        if (ownPrevSales === 0 && inheritedMonthlySales[m]) {
          inheritedTotal += inheritedMonthlySales[m].sales;
          prevYearMonthlySales[m] = inheritedMonthlySales[m].sales;
        } else {
          prevYearTotal += ownPrevSales;
          prevYearMonthlySales[m] = ownPrevSales;
        }

        if (currRow) currentYearTotalSoFar += currRow.SALES;
      }

      const combinedPrevTotal = prevYearTotal + inheritedTotal;

      // Calculate annual and monthly objectives
      let annualObjective: number;
      let monthlyObjective: number;

      if (fixedMonthlyTargetAmount && fixedMonthlyTargetAmount > 0) {
        monthlyObjective = fixedMonthlyTargetAmount;
        annualObjective = fixedMonthlyTargetAmount * 12;
      } else {
        const growthFactor = 1 + (targetPct / 100);
        annualObjective = combinedPrevTotal > 0
          ? combinedPrevTotal * growthFactor
          : (currentYearTotalSoFar > 0 ? currentYearTotalSoFar * growthFactor : 0);
        monthlyObjective = annualObjective / 12;
      }

      // Calculate seasonal targets
      const seasonalTargets: Record<number, number> = {};
      if (!fixedMonthlyTargetAmount && combinedPrevTotal > 0) {
        const avgMonthly = combinedPrevTotal / 12;
        let rawSum = 0;
        const tempTargets: Record<number, number> = {};

        for (let m = 1; m <= 12; m++) {
          const sale = prevYearMonthlySales[m] || 0;
          const deviationRatio = avgMonthly > 0 ? (sale - avgMonthly) / avgMonthly : 0;
          const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));
          const rawTarget = sale * (1 + variableGrowthPct);
          tempTargets[m] = rawTarget;
          rawSum += rawTarget;
        }

        const correctionFactor = rawSum > 0 ? annualObjective / rawSum : 1;
        for (let m = 1; m <= 12; m++) {
          seasonalTargets[m] = tempTargets[m] * correctionFactor;
        }
      }

      // Build monthly data for this year
      yearlyData[year] = [];

      for (let m = 1; m <= 12; m++) {
        const row = mutableRows.find(r => r.YEAR === year && r.MONTH === m);
        const sales = row ? row.SALES : 0;
        const cost = row ? row.COST : 0;
        const clients = row ? row.CLIENTS : 0;

        let seasonalObjective = 0;
        if (fixedMonthlyTargetAmount && fixedMonthlyTargetAmount > 0) {
          seasonalObjective = fixedMonthlyTargetAmount;
        } else if (combinedPrevTotal > 0) {
          seasonalObjective = seasonalTargets[m] || (prevYearMonthlySales[m] * 1.10);
        } else if (annualObjective > 0) {
          seasonalObjective = annualObjective / 12;
        }

        const totalWorkingDays = calculateWorkingDays(year, m, activeWeekDays);
        const daysPassed = calculateDaysPassed(year, m, activeWeekDays);

        (yearlyData[year] as unknown[]).push({
          month: m,
          sales, cost, margin: sales - cost, clients,
          objective: seasonalObjective,
          workingDays: totalWorkingDays,
          daysPassed,
        });
      }

      const data = yearlyData[year] as Array<{ sales: number; cost: number; margin: number }>;
      yearTotals[year] = {
        totalSales: data.reduce((sum, m) => sum + m.sales, 0),
        totalCost: data.reduce((sum, m) => sum + m.cost, 0),
        totalMargin: data.reduce((sum, m) => sum + m.margin, 0),
        annualObjective,
      };
    }

    return {
      years: yearsArray,
      yearlyData,
      yearTotals,
      monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
    };
  }

  // ============================================
  // GET /matrix - Product-Level Analysis
  // ============================================

  async getMatrix(params: {
    clientCode: string;
    years?: string; startMonth?: number; endMonth?: number;
    productCode?: string; productName?: string;
    familyCode?: string; subfamilyCode?: string;
    fi1?: string; fi2?: string; fi3?: string; fi4?: string; fi5?: string;
  }): Promise<Record<string, unknown>> {
    const clientCode = sanitizeCode(params.clientCode);
    const yearsArray = params.years
      ? params.years.split(',').map(y => parseInt(y.trim(), 10)).filter(y => y >= 2015)
      : [new Date().getFullYear()];
    const monthStart = params.startMonth || 1;
    const monthEnd = params.endMonth || 12;

    // Include previous year for YoY
    const allYearsToFetch = [...new Set([...yearsArray, ...yearsArray.map(y => y - 1)])];
    const { clause: yearsClause, params: yearsParams } = buildInClause('L.LCAADC', allYearsToFetch.map(String));

    // --- Client Contact & Notes ---
    let contactInfo = { phone: '', phone2: '', email: '', phones: [] as { type: string; number: string }[] };
    let editableNotes: { text: string; modifiedBy: string } | null = null;

    try {
      const contactRows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT TELEFONO1 AS PHONE, TELEFONO2 AS PHONE2
        FROM DSEDAC.CLI WHERE CODIGOCLIENTE = ? FETCH FIRST 1 ROWS ONLY
      `, [clientCode]);

      if (contactRows.length > 0) {
        const c = contactRows[0];
        const p1 = toStr(c.PHONE).trim();
        const p2 = toStr(c.PHONE2).trim();
        const phones: { type: string; number: string }[] = [];
        if (p1) phones.push({ type: 'Teléfono 1', number: p1 });
        if (p2) phones.push({ type: 'Teléfono 2', number: p2 });
        contactInfo = { phone: p1, phone2: p2, email: '', phones };
      }
    } catch { /* non-critical */ }

    try {
      const notesRows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT OBSERVACIONES, MODIFIED_BY FROM JAVIER.CLIENT_NOTES
        WHERE CLIENT_CODE = ? FETCH FIRST 1 ROWS ONLY
      `, [clientCode]);

      if (notesRows.length > 0) {
        editableNotes = {
          text: toStr(notesRows[0].OBSERVACIONES),
          modifiedBy: toStr(notesRows[0].MODIFIED_BY),
        };
      }
    } catch { /* table may not exist */ }

    // --- Build filter conditions ---
    const filterConditions: string[] = [];
    const filterParams: unknown[] = [];

    if (params.productCode) {
      filterConditions.push('UPPER(L.LCCDRF) LIKE ?');
      filterParams.push(`%${sanitizeSearch(params.productCode)}%`);
    }
    if (params.productName) {
      filterConditions.push('(UPPER(A.DESCRIPCIONARTICULO) LIKE ? OR UPPER(L.LCDESC) LIKE ?)');
      const pattern = `%${sanitizeSearch(params.productName)}%`;
      filterParams.push(pattern, pattern);
    }
    if (params.familyCode) {
      filterConditions.push('A.CODIGOFAMILIA = ?');
      filterParams.push(sanitizeCode(params.familyCode));
    }
    if (params.subfamilyCode) {
      filterConditions.push('A.CODIGOSUBFAMILIA = ?');
      filterParams.push(sanitizeCode(params.subfamilyCode));
    }
    if (params.fi1) {
      filterConditions.push('TRIM(AX.FILTRO01) = ?');
      filterParams.push(sanitizeCode(params.fi1));
    }
    if (params.fi2) {
      filterConditions.push('TRIM(AX.FILTRO02) = ?');
      filterParams.push(sanitizeCode(params.fi2));
    }
    if (params.fi3) {
      filterConditions.push('TRIM(AX.FILTRO03) = ?');
      filterParams.push(sanitizeCode(params.fi3));
    }
    if (params.fi4) {
      filterConditions.push('TRIM(AX.FILTRO04) = ?');
      filterParams.push(sanitizeCode(params.fi4));
    }
    if (params.fi5) {
      filterConditions.push('TRIM(A.CODIGOSECCIONLARGA) = ?');
      filterParams.push(sanitizeCode(params.fi5));
    }

    const extraWhere = filterConditions.length > 0
      ? 'AND ' + filterConditions.join(' AND ')
      : '';

    // --- Main LACLAE query ---
    const mainRows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT
        L.LCCDRF AS PRODUCT_CODE,
        COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.LCDESC)) AS PRODUCT_NAME,
        COALESCE(A.CODIGOFAMILIA, 'SIN_FAM') AS FAMILY_CODE,
        COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') AS SUBFAMILY_CODE,
        COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') AS UNIT_TYPE,
        L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
        SUM(L.LCIMVT) AS SALES, SUM(L.LCIMCT) AS COST, SUM(L.LCCTUD) AS UNITS,
        SUM(CASE WHEN L.LCPRTC <> 0 AND L.LCPRT1 <> 0 AND L.LCPRTC <> L.LCPRT1 THEN 1 ELSE 0 END) AS HAS_SPECIAL_PRICE,
        SUM(CASE WHEN L.LCPJDT <> 0 THEN 1 ELSE 0 END) AS HAS_DISCOUNT,
        AVG(CASE WHEN L.LCPJDT <> 0 THEN L.LCPJDT ELSE NULL END) AS AVG_DISCOUNT_PCT,
        AVG(L.LCPRTC) AS AVG_CLIENT_TARIFF,
        AVG(L.LCPRT1) AS AVG_BASE_TARIFF,
        COALESCE(TRIM(AX.FILTRO01), '') AS FI1_CODE,
        COALESCE(TRIM(AX.FILTRO02), '') AS FI2_CODE,
        COALESCE(TRIM(AX.FILTRO03), '') AS FI3_CODE,
        COALESCE(TRIM(AX.FILTRO04), '') AS FI4_CODE,
        COALESCE(TRIM(A.CODIGOSECCIONLARGA), '') AS FI5_CODE
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
      LEFT JOIN DSEDAC.ARTX AX ON L.LCCDRF = AX.CODIGOARTICULO
      WHERE L.LCCDCL = ?
        AND ${yearsClause}
        AND L.LCMMDC BETWEEN ? AND ?
        AND ${LACLAE_SALES_FILTER}
        ${extraWhere}
      GROUP BY L.LCCDRF, A.DESCRIPCIONARTICULO, L.LCDESC, A.CODIGOFAMILIA,
        A.CODIGOSUBFAMILIA, A.UNIDADMEDIDA, L.LCAADC, L.LCMMDC,
        AX.FILTRO01, AX.FILTRO02, AX.FILTRO03, AX.FILTRO04, A.CODIGOSECCIONLARGA
      ORDER BY SALES DESC
    `, [clientCode, ...yearsParams, monthStart, monthEnd, ...filterParams]);

    // Load filter names
    const names = await loadFilterNames();

    const isSelectedYear = (y: number) => yearsArray.includes(y);
    const isPrevYear = (y: number) => yearsArray.some(s => s - 1 === y);

    // --- Build hierarchies ---
    const familyMap = new Map<string, {
      familyCode: string; familyName: string;
      totalSales: number; totalCost: number; totalUnits: number;
      subfamilies: Map<string, {
        subfamilyCode: string; subfamilyName: string;
        totalSales: number; totalCost: number; totalUnits: number;
        products: Map<string, any>;
      }>;
    }>();

    const fiHierarchyMap = new Map<string, LevelData & { children: Map<string, any> }>();

    // Tracking variables
    let grandTotalSales = 0, grandTotalCost = 0, grandTotalUnits = 0;
    let grandTotalPrevSales = 0, grandTotalPrevCost = 0, grandTotalPrevUnits = 0;
    const productSet = new Set<string>();
    const prevProductSet = new Set<string>();
    const monthlyStats = new Map<number, { currentSales: number; prevSales: number; currentUnits: number }>();
    for (let m = 1; m <= 12; m++) monthlyStats.set(m, { currentSales: 0, prevSales: 0, currentUnits: 0 });

    // Available filter maps
    const availableFamiliesMap = new Map<string, { code: string; name: string }>();
    const availableSubfamiliesMap = new Map<string, { code: string; name: string }>();
    const availableFiMaps = [
      new Map<string, { code: string; name: string }>(),
      new Map<string, { code: string; name: string }>(),
      new Map<string, { code: string; name: string }>(),
      new Map<string, { code: string; name: string }>(),
      new Map<string, { code: string; name: string }>(),
    ];

    for (const row of mainRows) {
      const famCode = toStr(row.FAMILY_CODE).trim() || 'SIN_FAM';
      const subfamCode = toStr(row.SUBFAMILY_CODE).trim() || 'General';
      const prodCode = toStr(row.PRODUCT_CODE).trim();
      const prodName = toStr(row.PRODUCT_NAME).trim() || 'Sin nombre';
      const unitType = toStr(row.UNIT_TYPE).trim() || 'UDS';
      const year = toInt(row.YEAR);
      const month = toInt(row.MONTH);
      const sales = toFloat(row.SALES);
      const cost = toFloat(row.COST);
      const units = toFloat(row.UNITS);
      const isSelected = isSelectedYear(year);
      const isPrev = isPrevYear(year);

      const fi1Code = toStr(row.FI1_CODE).trim();
      const fi2Code = toStr(row.FI2_CODE).trim();
      const fi3Code = toStr(row.FI3_CODE).trim();
      const fi4Code = toStr(row.FI4_CODE).trim();
      const fi5Code = toStr(row.FI5_CODE).trim();

      // Populate available filter maps
      if (!availableFamiliesMap.has(famCode)) {
        availableFamiliesMap.set(famCode, { code: famCode, name: names.family[famCode] ? `${famCode} - ${names.family[famCode]}` : famCode });
      }
      if (!availableSubfamiliesMap.has(subfamCode)) {
        availableSubfamiliesMap.set(subfamCode, { code: subfamCode, name: subfamCode });
      }

      const fiCodes = [fi1Code, fi2Code, fi3Code, fi4Code, fi5Code];
      const fiNameSources = [names.fi1, names.fi2, names.fi3, names.fi4, names.fi5];
      for (let i = 0; i < 5; i++) {
        const fc = fiCodes[i];
        if (fc && !availableFiMaps[i].has(fc)) {
          const n = fiNameSources[i][fc];
          availableFiMaps[i].set(fc, { code: fc, name: n ? `${fc} - ${n}` : fc });
        }
      }

      // Update monthly stats
      const mStat = monthlyStats.get(month)!;
      if (isSelected) { mStat.currentSales += sales; mStat.currentUnits += units; }
      else if (isPrev) { mStat.prevSales += sales; }

      // Grand totals
      if (isSelected) {
        grandTotalSales += sales; grandTotalCost += cost; grandTotalUnits += units;
        productSet.add(prodCode);
      } else if (isPrev) {
        grandTotalPrevSales += sales; grandTotalPrevCost += cost; grandTotalPrevUnits += units;
        prevProductSet.add(prodCode);
      }

      if (!isSelected && !isPrev) continue;

      // --- Family hierarchy ---
      if (!familyMap.has(famCode)) {
        familyMap.set(famCode, {
          familyCode: famCode,
          familyName: names.family[famCode] ? `${famCode} - ${names.family[famCode]}` : famCode,
          totalSales: 0, totalCost: 0, totalUnits: 0,
          subfamilies: new Map(),
        });
      }
      const family = familyMap.get(famCode)!;
      if (isSelected) { family.totalSales += sales; family.totalCost += cost; family.totalUnits += units; }

      if (!family.subfamilies.has(subfamCode)) {
        family.subfamilies.set(subfamCode, {
          subfamilyCode: subfamCode, subfamilyName: subfamCode,
          totalSales: 0, totalCost: 0, totalUnits: 0,
          products: new Map(),
        });
      }
      const subfamily = family.subfamilies.get(subfamCode)!;
      if (isSelected) { subfamily.totalSales += sales; subfamily.totalCost += cost; subfamily.totalUnits += units; }

      if (!subfamily.products.has(prodCode)) {
        subfamily.products.set(prodCode, {
          productCode: prodCode, productName: prodName, unitType,
          totalSales: 0, totalCost: 0, totalUnits: 0,
          prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
          hasDiscount: false, hasSpecialPrice: false,
          avgDiscountPct: 0, avgClientTariff: 0, avgBaseTariff: 0,
          monthlyData: {} as Record<string, Record<string, { sales: number; units: number }>>,
        });
      }
      const product = subfamily.products.get(prodCode)!;
      if (isSelected) {
        product.totalSales += sales; product.totalCost += cost; product.totalUnits += units;
        if (toInt(row.HAS_DISCOUNT) > 0) product.hasDiscount = true;
        if (toInt(row.HAS_SPECIAL_PRICE) > 0) product.hasSpecialPrice = true;
        const dPct = toFloat(row.AVG_DISCOUNT_PCT);
        if (dPct > 0) product.avgDiscountPct = dPct;
        const cTariff = toFloat(row.AVG_CLIENT_TARIFF);
        if (cTariff > 0) product.avgClientTariff = cTariff;
        const bTariff = toFloat(row.AVG_BASE_TARIFF);
        if (bTariff > 0) product.avgBaseTariff = bTariff;
      } else if (isPrev) {
        product.prevYearSales += sales; product.prevYearCost += cost; product.prevYearUnits += units;
      }

      const ys = year.toString();
      const ms = month.toString();
      if (!product.monthlyData[ys]) product.monthlyData[ys] = {};
      if (!product.monthlyData[ys][ms]) product.monthlyData[ys][ms] = { sales: 0, units: 0 };
      product.monthlyData[ys][ms].sales += sales;
      product.monthlyData[ys][ms].units += units;

      // --- FI Hierarchy (FI1 > FI2 > FI3 > FI4 > Product) ---
      const fi1Key = fi1Code || 'SIN_CAT';
      const fi2Key = fi2Code || 'General';
      const fi3Key = fi3Code || 'General';
      const fi4Key = fi4Code || 'General';

      // FI1
      if (!fiHierarchyMap.has(fi1Key)) {
        fiHierarchyMap.set(fi1Key, {
          code: fi1Key, level: 1,
          name: names.fi1[fi1Key] ? `${fi1Key} - ${names.fi1[fi1Key]}` : (fi1Key === 'SIN_CAT' ? 'Sin Categoría' : fi1Key),
          totalSales: 0, totalCost: 0, totalUnits: 0,
          prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
          monthlyData: {}, children: new Map(),
        });
      }
      const fi1Level = fiHierarchyMap.get(fi1Key)!;
      accumulateLevel(fi1Level, year, month, sales, cost, units, isSelected, isPrev);

      // FI2
      if (!fi1Level.children.has(fi2Key)) {
        fi1Level.children.set(fi2Key, {
          code: fi2Key, level: 2,
          name: names.fi2[fi2Key] ? `${fi2Key} - ${names.fi2[fi2Key]}` : (fi2Key === 'General' ? 'General' : fi2Key),
          totalSales: 0, totalCost: 0, totalUnits: 0,
          prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
          monthlyData: {}, children: new Map(),
        });
      }
      const fi2Level = fi1Level.children.get(fi2Key)!;
      accumulateLevel(fi2Level, year, month, sales, cost, units, isSelected, isPrev);

      // FI3
      if (!fi2Level.children.has(fi3Key)) {
        fi2Level.children.set(fi3Key, {
          code: fi3Key, level: 3,
          name: names.fi3[fi3Code] ? `${fi3Code} - ${names.fi3[fi3Code]}` : (fi3Key === 'General' ? 'General' : fi3Key),
          totalSales: 0, totalCost: 0, totalUnits: 0,
          prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
          monthlyData: {}, children: new Map(),
        });
      }
      const fi3Level = fi2Level.children.get(fi3Key)!;
      accumulateLevel(fi3Level, year, month, sales, cost, units, isSelected, isPrev);

      // FI4
      if (!fi3Level.children.has(fi4Key)) {
        fi3Level.children.set(fi4Key, {
          code: fi4Key, level: 4,
          name: names.fi4[fi4Code] ? `${fi4Code} - ${names.fi4[fi4Code]}` : (fi4Key === 'General' ? 'General' : fi4Key),
          totalSales: 0, totalCost: 0, totalUnits: 0,
          prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
          monthlyData: {}, products: new Map(),
        });
      }
      const fi4Level = fi3Level.children.get(fi4Key)!;
      accumulateLevel(fi4Level, year, month, sales, cost, units, isSelected, isPrev);

      // FI Product
      if (!fi4Level.products.has(prodCode)) {
        fi4Level.products.set(prodCode, {
          code: prodCode, name: prodName, unitType,
          fi5Code, fi5Name: names.fi5[fi5Code] || fi5Code,
          totalSales: 0, totalCost: 0, totalUnits: 0,
          prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
          hasDiscount: false, hasSpecialPrice: false,
          avgDiscountPct: 0, monthlyData: {},
        });
      }
      const fiProduct = fi4Level.products.get(prodCode)!;
      if (isSelected) {
        fiProduct.totalSales += sales; fiProduct.totalCost += cost; fiProduct.totalUnits += units;
        if (toInt(row.HAS_DISCOUNT) > 0) fiProduct.hasDiscount = true;
        if (toInt(row.HAS_SPECIAL_PRICE) > 0) fiProduct.hasSpecialPrice = true;
        const dPct = toFloat(row.AVG_DISCOUNT_PCT);
        if (dPct > 0) fiProduct.avgDiscountPct = dPct;
      } else if (isPrev) {
        fiProduct.prevYearSales += sales; fiProduct.prevYearCost += cost; fiProduct.prevYearUnits += units;
      }
      if (!fiProduct.monthlyData[year.toString()]) fiProduct.monthlyData[year.toString()] = {};
      if (!fiProduct.monthlyData[year.toString()][month.toString()]) fiProduct.monthlyData[year.toString()][month.toString()] = { sales: 0, units: 0 };
      fiProduct.monthlyData[year.toString()][month.toString()].sales += sales;
      fiProduct.monthlyData[year.toString()][month.toString()].units += units;
    }

    // --- Format family hierarchy ---
    const families = Array.from(familyMap.values()).map(f => {
      const subfamilies = Array.from(f.subfamilies.values()).map(s => {
        const products = Array.from(s.products.values()).map((p: any) => {
          const margin = p.totalSales - p.totalCost;
          const marginPercent = p.totalSales > 0 ? (margin / p.totalSales) * 100 : 0;
          const avgPrice = p.totalUnits > 0 ? p.totalSales / p.totalUnits : 0;
          const avgCost = p.totalUnits > 0 ? p.totalCost / p.totalUnits : 0;
          const prevAvgPrice = p.prevYearUnits > 0 ? p.prevYearSales / p.prevYearUnits : 0;
          const variation = p.prevYearSales > 0 ? ((p.totalSales - p.prevYearSales) / p.prevYearSales) * 100 : 0;
          let yoyTrend = 'neutral';
          if (variation > 5) yoyTrend = 'up'; if (variation < -5) yoyTrend = 'down';

          // Format monthly data
          const monthlyOutput: Record<string, unknown> = {};
          for (let m = 1; m <= 12; m++) {
            const mStr = m.toString();
            let selSales = 0, selUnits = 0, pSales = 0;
            for (const [ys, md] of Object.entries(p.monthlyData) as [string, Record<string, { sales: number; units: number }>][]) {
              const y = parseInt(ys);
              if (md[mStr]) {
                if (isSelectedYear(y)) { selSales += md[mStr].sales; selUnits += md[mStr].units; }
                else if (isPrevYear(y)) { pSales += md[mStr].sales; }
              }
            }
            let mTrend = 'neutral'; let mVar = 0;
            if (pSales > 0) { mVar = ((selSales - pSales) / pSales) * 100; if (mVar > 5) mTrend = 'up'; else if (mVar < -5) mTrend = 'down'; }
            else if (selSales > 0) mTrend = 'up';
            monthlyOutput[mStr] = { sales: selSales, prevSales: pSales, yoyTrend: mTrend, yoyVariation: mVar };
          }

          return {
            code: p.productCode, name: p.productName, unitType: p.unitType,
            totalSales: parseFloat(p.totalSales.toFixed(2)),
            totalUnits: parseFloat(p.totalUnits.toFixed(2)),
            totalCost: parseFloat(p.totalCost.toFixed(2)),
            totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
            avgUnitPrice: parseFloat(avgPrice.toFixed(2)),
            avgUnitCost: parseFloat(avgCost.toFixed(2)),
            marginPerUnit: parseFloat((avgPrice - avgCost).toFixed(2)),
            prevYearSales: parseFloat(p.prevYearSales.toFixed(2)),
            prevYearUnits: parseFloat(p.prevYearUnits.toFixed(2)),
            prevYearAvgPrice: parseFloat(prevAvgPrice.toFixed(2)),
            hasDiscount: p.hasDiscount, hasSpecialPrice: p.hasSpecialPrice,
            avgDiscountPct: p.avgDiscountPct,
            monthlyData: monthlyOutput,
            yoyTrend, yoyVariation: parseFloat(variation.toFixed(1)),
          };
        }).sort((a: any, b: any) => b.totalSales - a.totalSales);

        const sMargin = s.totalSales - s.totalCost;
        const sMarginPct = s.totalSales > 0 ? (sMargin / s.totalSales) * 100 : 0;
        return {
          subfamilyCode: s.subfamilyCode, subfamilyName: s.subfamilyName,
          totalSales: parseFloat(s.totalSales.toFixed(2)),
          totalUnits: s.totalUnits,
          totalMarginPercent: parseFloat(sMarginPct.toFixed(1)),
          products,
        };
      }).sort((a, b) => b.totalSales - a.totalSales);

      const fMargin = f.totalSales - f.totalCost;
      const fMarginPct = f.totalSales > 0 ? (fMargin / f.totalSales) * 100 : 0;
      return {
        familyCode: f.familyCode, familyName: f.familyName,
        totalSales: parseFloat(f.totalSales.toFixed(2)),
        totalUnits: f.totalUnits,
        totalMarginPercent: parseFloat(fMarginPct.toFixed(1)),
        subfamilies,
      };
    }).sort((a, b) => b.totalSales - a.totalSales);

    // --- Format FI hierarchy ---
    const formatFiProduct = (p: any) => {
      const summary = formatLevelSummary({
        ...p, level: 5,
        monthlyData: p.monthlyData || {},
      }, yearsArray);
      const avgPrice = p.totalUnits > 0 ? p.totalSales / p.totalUnits : 0;
      const avgCost = p.totalUnits > 0 ? p.totalCost / p.totalUnits : 0;
      const prevAvgPrice = p.prevYearUnits > 0 ? p.prevYearSales / p.prevYearUnits : 0;
      const prevAvgCost = p.prevYearUnits > 0 ? p.prevYearCost / p.prevYearUnits : 0;

      return {
        ...summary,
        code: p.code, name: p.name, unitType: p.unitType || 'UDS',
        fi5Code: p.fi5Code || '', fi5Name: p.fi5Name || '',
        avgUnitPrice: parseFloat(avgPrice.toFixed(2)),
        avgUnitCost: parseFloat(avgCost.toFixed(2)),
        prevYearAvgPrice: parseFloat(prevAvgPrice.toFixed(2)),
        prevYearAvgCost: parseFloat(prevAvgCost.toFixed(2)),
        hasDiscount: p.hasDiscount, hasSpecialPrice: p.hasSpecialPrice,
        avgDiscountPct: p.avgDiscountPct || 0,
      };
    };

    const fiHierarchy = Array.from(fiHierarchyMap.values()).map(fi1 => {
      const children1 = Array.from(fi1.children.values()).map((fi2: any) => {
        const children2 = Array.from(fi2.children.values()).map((fi3: any) => {
          const children3 = Array.from(fi3.children.values()).map((fi4: any) => {
            const products = Array.from(fi4.products.values()).map(formatFiProduct)
              .sort((a: any, b: any) => b.totalSales - a.totalSales);
            return { ...formatLevelSummary(fi4, yearsArray), productCount: products.length, products };
          }).filter((f: any) => f.totalSales > 0 || f.productCount > 0)
            .sort((a: any, b: any) => b.totalSales - a.totalSales);

          return { ...formatLevelSummary(fi3, yearsArray), childCount: children3.length, children: children3 };
        }).filter((f: any) => f.totalSales > 0 || f.childCount > 0)
          .sort((a: any, b: any) => b.totalSales - a.totalSales);

        return { ...formatLevelSummary(fi2, yearsArray), childCount: children2.length, children: children2 };
      }).filter((f: any) => f.totalSales > 0 || f.childCount > 0)
        .sort((a: any, b: any) => b.totalSales - a.totalSales);

      return { ...formatLevelSummary(fi1, yearsArray), childCount: children1.length, children: children1 };
    }).filter((f: any) => f.totalSales > 0 || f.childCount > 0)
      .sort((a: any, b: any) => b.totalSales - a.totalSales);

    // --- Monthly totals ---
    const flatMonthlyTotals: Record<number, unknown> = {};
    monthlyStats.forEach((val, month) => {
      const variation = val.prevSales > 0 ? ((val.currentSales - val.prevSales) / val.prevSales) * 100 : null;
      let yoyTrend = 'neutral';
      if (val.prevSales > 0) {
        if (val.currentSales > val.prevSales) yoyTrend = 'up';
        else if (val.currentSales < val.prevSales) yoyTrend = 'down';
      } else if (val.currentSales > 0) {
        yoyTrend = 'up';
      }
      flatMonthlyTotals[month] = {
        sales: val.currentSales, units: val.currentUnits, prevSales: val.prevSales,
        yoyVariation: variation !== null ? parseFloat(variation.toFixed(1)) : null,
        yoyTrend,
      };
    });

    // --- Summary ---
    const grandTotalMargin = grandTotalSales - grandTotalCost;
    const grandTotalPrevMargin = grandTotalPrevSales - grandTotalPrevCost;
    const salesGrowth = grandTotalPrevSales > 0 ? ((grandTotalSales - grandTotalPrevSales) / grandTotalPrevSales) * 100 : 0;
    const marginGrowth = grandTotalPrevMargin > 0 ? ((grandTotalMargin - grandTotalPrevMargin) / grandTotalPrevMargin) * 100 : 0;
    const unitsGrowth = grandTotalPrevUnits > 0 ? ((grandTotalUnits - grandTotalPrevUnits) / grandTotalPrevUnits) * 100 : 0;
    const isNewClient = grandTotalPrevSales < 0.01 && grandTotalSales > 0;
    const productGrowth = prevProductSet.size > 0
      ? ((productSet.size - prevProductSet.size) / prevProductSet.size) * 100
      : (productSet.size > 0 ? 100 : 0);

    return {
      clientCode,
      contactInfo,
      editableNotes,
      summary: {
        isNewClient,
        current: { label: yearsArray.join(', '), sales: grandTotalSales, margin: grandTotalMargin, units: grandTotalUnits, productCount: productSet.size },
        previous: { label: yearsArray.map(y => y - 1).join(', '), sales: grandTotalPrevSales, margin: grandTotalPrevMargin, units: grandTotalPrevUnits, productCount: prevProductSet.size },
        growth: { sales: salesGrowth, margin: marginGrowth, units: unitsGrowth, productCount: productGrowth },
        breakdown: [],
      },
      grandTotal: { sales: grandTotalSales, cost: grandTotalCost, margin: grandTotalMargin, units: grandTotalUnits, products: productSet.size },
      monthlyTotals: flatMonthlyTotals,
      availableFilters: {
        families: Array.from(availableFamiliesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        subfamilies: Array.from(availableSubfamiliesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        fi1: Array.from(availableFiMaps[0].values()).sort((a, b) => a.name.localeCompare(b.name)),
        fi2: Array.from(availableFiMaps[1].values()).sort((a, b) => a.name.localeCompare(b.name)),
        fi3: Array.from(availableFiMaps[2].values()).sort((a, b) => a.name.localeCompare(b.name)),
        fi4: Array.from(availableFiMaps[3].values()).sort((a, b) => a.name.localeCompare(b.name)),
        fi5: Array.from(availableFiMaps[4].values()).sort((a, b) => a.name.localeCompare(b.name)),
      },
      families,
      fiHierarchy,
      years: yearsArray,
      months: { start: monthStart, end: monthEnd },
    };
  }

  // ============================================
  // GET /populations - Distinct Cities
  // ============================================

  async getPopulations(): Promise<string[]> {
    const cacheKey = 'gmp:objectives:populations';
    return queryCache.getOrSet(cacheKey, async () => {
      const rows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT DISTINCT TRIM(POBLACION) AS CITY
        FROM DSEDAC.CLI
        WHERE ANOBAJA = 0
          AND TRIM(POBLACION) <> ''
        ORDER BY 1
      `);
      return rows.map(r => toStr(r.CITY));
    }, TTL.LONG);
  }

  // ============================================
  // GET /by-client - Per-Client Objectives
  // ============================================

  async getByClient(params: {
    vendedorCodes?: string; years?: string; months?: string;
    city?: string; code?: string; nif?: string; name?: string;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    const now = new Date();
    const yearsArray = params.years
      ? params.years.split(',').map(y => parseInt(y.trim(), 10)).filter(y => y >= MIN_YEAR)
      : [now.getFullYear()];
    const monthsArray = params.months
      ? params.months.split(',').map(m => parseInt(m.trim(), 10)).filter(m => m >= 1 && m <= 12)
      : Array.from({ length: 12 }, (_, i) => i + 1);
    const rowsLimit = Math.min(params.limit || 1000, 2000);

    const { clause: yearsClause, params: yearsP } = buildInClause('L.LCAADC', yearsArray.map(String));
    const { clause: monthsClause, params: monthsP } = buildInClause('L.LCMMDC', monthsArray.map(String));

    const { clause: vendorClause, params: vendorParams } = buildVendedorFilterLACLAE(params.vendedorCodes || '', 'L');

    // Build extra filters
    const extraConditions: string[] = [];
    const extraParams: unknown[] = [];

    if (params.city) {
      extraConditions.push('UPPER(C.POBLACION) = ?');
      extraParams.push(sanitizeSearch(params.city));
    }
    if (params.code) {
      extraConditions.push('C.CODIGOCLIENTE LIKE ?');
      extraParams.push(`%${sanitizeCode(params.code)}%`);
    }
    if (params.nif) {
      extraConditions.push('C.NIF LIKE ?');
      extraParams.push(`%${sanitizeSearch(params.nif)}%`);
    }
    if (params.name) {
      extraConditions.push('(UPPER(C.NOMBRECLIENTE) LIKE ? OR UPPER(C.NOMBREALTERNATIVO) LIKE ?)');
      const namePattern = `%${sanitizeSearch(params.name)}%`;
      extraParams.push(namePattern, namePattern);
    }

    const extraWhere = extraConditions.length > 0 ? 'AND ' + extraConditions.join(' AND ') : '';
    const mainYear = Math.max(...yearsArray);
    const prevYear = mainYear - 1;

    // LACLAE-based query (uses vendorFilter + all filters)
    const currentRows = await odbcPool.query<Record<string, unknown>[]>(`
      SELECT
        L.LCCDCL AS CODE,
        COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) AS NAME,
        MIN(C.DIRECCION) AS ADDRESS,
        MIN(C.CODIGOPOSTAL) AS POSTALCODE,
        MIN(C.POBLACION) AS CITY,
        SUM(L.LCIMVT) AS SALES,
        SUM(L.LCIMCT) AS COST
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
      WHERE ${yearsClause}
        AND ${monthsClause}
        AND ${LACLAE_SALES_FILTER}
        ${vendorClause}
        ${extraWhere}
      GROUP BY L.LCCDCL
      ORDER BY SALES DESC
      FETCH FIRST ? ROWS ONLY
    `, [...yearsP, ...monthsP, ...vendorParams, ...extraParams, rowsLimit]);

    const totalClientsCount = currentRows.length;

    // Previous year sales for objective calculation
    const retrievedCodes = currentRows.map(r => toStr(r.CODE).trim()).filter(c => c);
    const prevSalesMap = new Map<string, number>();

    if (retrievedCodes.length > 0) {
      const { clause: codesClause, params: codesParams } = buildInClause('L.LCCDCL', retrievedCodes);
      const { clause: prevMonthsClause, params: prevMonthsP } = buildInClause('L.LCMMDC', monthsArray.map(String));

      const prevRows = await odbcPool.query<Record<string, unknown>[]>(`
        SELECT L.LCCDCL AS CODE, SUM(L.LCIMVT) AS PREV_SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC = ?
          AND ${prevMonthsClause}
          AND ${LACLAE_SALES_FILTER}
          AND ${codesClause}
        GROUP BY L.LCCDCL
      `, [prevYear, ...prevMonthsP, ...codesParams]);

      for (const r of prevRows) {
        prevSalesMap.set(toStr(r.CODE).trim(), toFloat(r.PREV_SALES));
      }
    }

    // Objective config
    let defaultPct = 10;
    const objectiveConfigMap = new Map<string, number>();

    if (retrievedCodes.length > 0) {
      try {
        const { clause: confClause, params: confParams } = buildInClause(
          'CODIGOCLIENTE', [...retrievedCodes, '*'],
        );
        const confRows = await odbcPool.query<Record<string, unknown>[]>(`
          SELECT CODIGOCLIENTE, TARGET_PERCENTAGE
          FROM JAVIER.OBJ_CONFIG
          WHERE ${confClause}
        `, confParams);

        for (const r of confRows) {
          const code = toStr(r.CODIGOCLIENTE).trim();
          const pct = toFloat(r.TARGET_PERCENTAGE);
          if (code === '*') defaultPct = pct || 10;
          else objectiveConfigMap.set(code, pct);
        }
      } catch {
        // OBJ_CONFIG may not exist
      }
    }

    // Fixed targets from COMMERCIAL_TARGETS
    const vendorCodesArray = params.vendedorCodes
      ? params.vendedorCodes.split(',').map(v => sanitizeCode(v.trim()))
      : [];
    let vendorFixedAmount = 0;

    if (vendorCodesArray.length > 0) {
      const currentMonth = now.getMonth() + 1;
      for (const vc of vendorCodesArray) {
        const { objetivo } = await getFixedMonthlyTarget(vc, now.getFullYear(), currentMonth);
        if (objetivo && objetivo > 0) { vendorFixedAmount = objetivo; break; }
      }
    }

    // Build client list
    const clients = currentRows.map(r => {
      const code = toStr(r.CODE).trim();
      const sales = toFloat(r.SALES);
      const cost = toFloat(r.COST);
      const margin = sales - cost;
      const prevSales = prevSalesMap.get(code) || 0;

      const targetPct = objectiveConfigMap.has(code) ? objectiveConfigMap.get(code)! : defaultPct;
      const multiplier = 1 + (targetPct / 100.0);
      const objective = prevSales > 0 ? prevSales * multiplier : sales;
      const progress = objective > 0 ? (sales / objective) * 100 : (sales > 0 ? 100 : 0);

      let status = 'critical';
      if (progress >= 100) status = 'achieved';
      else if (progress >= 80) status = 'ontrack';
      else if (progress >= 50) status = 'atrisk';

      return {
        code,
        name: toStr(r.NAME).trim() || 'Sin nombre',
        address: toStr(r.ADDRESS).trim(),
        postalCode: toStr(r.POSTALCODE).trim(),
        city: toStr(r.CITY).trim(),
        current: sales, objective, prevYear: prevSales, margin,
        progress: Math.round(progress * 10) / 10,
        status,
      };
    });

    const achieved = clients.filter(c => c.status === 'achieved').length;
    const ontrack = clients.filter(c => c.status === 'ontrack').length;
    const atrisk = clients.filter(c => c.status === 'atrisk').length;
    const critical = clients.filter(c => c.status === 'critical').length;

    return {
      clients,
      count: totalClientsCount,
      start: 0,
      limit: rowsLimit,
      periodObjective: clients.reduce((sum, c) => sum + c.objective, 0),
      totalSales: clients.reduce((sum, c) => sum + c.current, 0),
      years: yearsArray,
      months: monthsArray,
      summary: { achieved, ontrack, atrisk, critical },
    };
  }
}

export const objectivesService = new ObjectivesService();
