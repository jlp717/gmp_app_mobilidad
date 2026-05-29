'use strict';

/**
 * Commissions PDF report service.
 *
 * The PDF must follow the same historical rule as the commissions screen:
 * - Jan/Feb 2026 are covered by JAVIER.COMMISSION_SNAPSHOT_2026_0102.
 * - If a vendor has a row there, sales/target/generated/paid come from it.
 * - If a vendor is absent in a covered month, sales and target stay calculated
 *   with the historical vendor criterion, but generated and paid commission are 0.
 */

const PDFDocument = require('pdfkit');
const logger = require('../middleware/logger');
const { queryWithParams } = require('../config/db');
const { CircuitBreaker } = require('./circuit-breaker');
const {
    getVendorColumnExpr,
    LACLAE_SALES_FILTER,
    SNAPSHOT_UNTIL_MONTH,
} = require('../utils/common');

const commissionsPdfBreaker = new CircuitBreaker({
    name: 'commissions-pdf',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000
});

const SNAPSHOT_TABLE = 'JAVIER.COMMISSION_SNAPSHOT_2026_0102';

const DEFAULT_CONFIG = {
    ipc: 3.0,
    TIER1_MAX: 103.00,
    TIER1_PCT: 1.0,
    TIER2_MAX: 106.00,
    TIER2_PCT: 1.3,
    TIER3_MAX: 110.00,
    TIER3_PCT: 1.6,
    TIER4_PCT: 2.0,
};

const COLORS = {
    header: '#003d7a',
    headerText: '#FFFFFF',
    text: '#111827',
    muted: '#6B7280',
    grid: '#B7C3D0',
    rowAlt: '#F3F8FC',
    columnHeader: '#DCEBFA',
    totalBg: '#003d7a',
    totalText: '#FFFFFF',
    objective: '#0057A3',
    condor: '#9A5B00',
    good: '#166534',
    warning: '#B45309',
    bad: '#B91C1C',
};

const ALLOWED_USERS = ['DIEGO', 'diego'];

function formatCurrency(num) {
    const value = parseFloat(num);
    if (!Number.isFinite(value)) return '0,00';
    const fixed = Math.abs(value).toFixed(2);
    const parts = fixed.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const result = `${integerPart},${parts[1]}`;
    return value < 0 ? `-${result}` : result;
}

function getMonthName(monthNum) {
    const months = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return months[monthNum] || '';
}

function formatPct(pct) {
    const value = parseFloat(pct);
    if (!Number.isFinite(value)) return '-';
    return `${value.toFixed(1)}%`;
}

function toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeVendorCode(code) {
    const raw = String(code || '').trim();
    return raw.replace(/^0+/, '') || raw;
}

function displayVendorCode(code) {
    const raw = String(code || '').trim();
    const normalized = normalizeVendorCode(raw);
    if (/^\d$/.test(normalized)) return normalized.padStart(2, '0');
    return raw || normalized;
}

function getCodeVariants(code) {
    const raw = String(code || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!raw) return [];
    const normalized = normalizeVendorCode(raw);
    const padded = /^\d{1,2}$/.test(normalized) ? normalized.padStart(2, '0') : normalized;
    return [...new Set([raw, normalized, padded].filter(Boolean))];
}

function upsertVendorMonth(vendorMap, code, name, month, values) {
    const normalized = normalizeVendorCode(code);
    if (!normalized) return null;

    if (!vendorMap.has(normalized)) {
        vendorMap.set(normalized, {
            code: displayVendorCode(code),
            normalizedCode: normalized,
            name: name || `Vendedor ${displayVendorCode(code)}`,
            months: {},
        });
    }

    const vendor = vendorMap.get(normalized);
    if (name && (!vendor.name || vendor.name.startsWith('Vendedor '))) {
        vendor.name = name;
    }
    if (!vendor.months[month]) vendor.months[month] = {};
    vendor.months[month] = { ...vendor.months[month], ...values };
    return vendor;
}

function getVendorEntry(map, code) {
    if (!map || !code) return null;
    return map.get(normalizeVendorCode(code)) || map.get(String(code).trim()) || null;
}

function setNestedMonthValue(map, code, month, value) {
    const normalized = normalizeVendorCode(code);
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, {});
    map.get(normalized)[month] = value;
}

function calculateCommission(actual, target, config) {
    if (target <= 0) {
        return { commission: 0, tier: 0, rate: 0, increment: 0, compliancePct: 0 };
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
    } else if (compliancePct > 100.00) {
        rate = config.TIER1_PCT;
        tier = 1;
    }

    return {
        commission: increment > 0 && rate > 0 ? increment * (rate / 100) : 0,
        tier,
        rate,
        increment,
        compliancePct,
    };
}

function isAuthorized(userName) {
    return ALLOWED_USERS.includes(userName?.toUpperCase());
}

function getMonthsInRange(startMonth, endMonth) {
    const months = [];
    for (let month = startMonth; month <= endMonth; month++) months.push(month);
    return months;
}

function getSnapshotMonths(year, startMonth, endMonth) {
    if (parseInt(year, 10) !== 2026 || SNAPSHOT_UNTIL_MONTH <= 0) return [];
    return getMonthsInRange(startMonth, endMonth).filter(month => month <= SNAPSHOT_UNTIL_MONTH);
}

async function getCommissionConfig(year) {
    try {
        const rows = await queryWithParams(`
            SELECT *
            FROM JAVIER.COMM_CONFIG
            WHERE YEAR = ?
            FETCH FIRST 1 ROWS ONLY
        `, [parseInt(year, 10)], false, false);

        if (!rows || rows.length === 0) return DEFAULT_CONFIG;
        const row = rows[0];
        return {
            ipc: toNumber(row.IPC_PCT) || DEFAULT_CONFIG.ipc,
            TIER1_MAX: toNumber(row.TIER1_MAX) || DEFAULT_CONFIG.TIER1_MAX,
            TIER1_PCT: toNumber(row.TIER1_PCT) || DEFAULT_CONFIG.TIER1_PCT,
            TIER2_MAX: toNumber(row.TIER2_MAX) || DEFAULT_CONFIG.TIER2_MAX,
            TIER2_PCT: toNumber(row.TIER2_PCT) || DEFAULT_CONFIG.TIER2_PCT,
            TIER3_MAX: toNumber(row.TIER3_MAX) || DEFAULT_CONFIG.TIER3_MAX,
            TIER3_PCT: toNumber(row.TIER3_PCT) || DEFAULT_CONFIG.TIER3_PCT,
            TIER4_PCT: toNumber(row.TIER4_PCT) || DEFAULT_CONFIG.TIER4_PCT,
        };
    } catch (e) {
        logger.warn(`[PDF] COMM_CONFIG lookup failed: ${e.message}. Using defaults.`);
        return DEFAULT_CONFIG;
    }
}

async function getSnapshotCommissionData(year, startMonth, endMonth) {
    const snapshotMonths = getSnapshotMonths(year, startMonth, endMonth);
    const rowsByVendor = new Map();
    const coveredMonths = new Set();

    if (snapshotMonths.length === 0) {
        return { rowsByVendor, coveredMonths };
    }

    try {
        const placeholders = snapshotMonths.map(() => '?').join(',');
        const rows = await queryWithParams(`
            SELECT
                TRIM(VENDEDOR_CODIGO) as VENDEDOR_CODIGO,
                MES,
                MAX(VENTAS_REAL) as VENTAS_REAL,
                MAX(OBJETIVO_MES) as OBJETIVO_MES,
                MAX(COMISION_GENERADA) as COMISION_GENERADA,
                SUM(IMPORTE_PAGADO) as IMPORTE_PAGADO
            FROM ${SNAPSHOT_TABLE}
            WHERE ANIO = ?
              AND MES IN (${placeholders})
            GROUP BY TRIM(VENDEDOR_CODIGO), MES
        `, [parseInt(year, 10), ...snapshotMonths], false, false);

        rows.forEach(row => {
            const month = parseInt(row.MES, 10);
            const code = row.VENDEDOR_CODIGO || '';
            if (!Number.isFinite(month)) return;
            coveredMonths.add(month);
            setNestedMonthValue(rowsByVendor, code, month, {
                ventasReal: toNumber(row.VENTAS_REAL),
                objetivoMes: toNumber(row.OBJETIVO_MES),
                comisionGenerada: toNumber(row.COMISION_GENERADA),
                importePagado: toNumber(row.IMPORTE_PAGADO),
            });
        });

        logger.info(`[PDF] Loaded ${rows.length} historical commission rows from ${SNAPSHOT_TABLE}.`);
    } catch (e) {
        logger.warn(`[PDF] Historical commission snapshot lookup failed: ${e.message}`);
    }

    return { rowsByVendor, coveredMonths };
}

async function getLacSalesData(year, startMonth, endMonth) {
    const vendorColExpr = getVendorColumnExpr('L');
    const vendorMap = new Map();

    try {
        const rows = await queryWithParams(`
            SELECT
                RTRIM(${vendorColExpr}) as VENDEDOR,
                COALESCE(TRIM(V.NOMBREVENDEDOR), '') as NOMBRE_VENDEDOR,
                L.LCMMDC as MES,
                COALESCE(SUM(L.LCIMVT), 0) as LAC_TOTAL
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.VDD V ON RTRIM(${vendorColExpr}) = RTRIM(V.CODIGOVENDEDOR)
            WHERE L.LCAADC = ?
              AND L.LCMMDC BETWEEN ? AND ?
              AND ${LACLAE_SALES_FILTER}
              AND (${vendorColExpr}) IS NOT NULL
              AND RTRIM(${vendorColExpr}) <> ''
            GROUP BY RTRIM(${vendorColExpr}), V.NOMBREVENDEDOR, L.LCMMDC
            ORDER BY RTRIM(${vendorColExpr}), L.LCMMDC
        `, [parseInt(year, 10), parseInt(startMonth, 10), parseInt(endMonth, 10)], false, false);

        rows.forEach(row => {
            upsertVendorMonth(
                vendorMap,
                row.VENDEDOR,
                row.NOMBRE_VENDEDOR,
                parseInt(row.MES, 10),
                { lac: toNumber(row.LAC_TOTAL), isHistoricalCommissionMonth: false }
            );
        });
    } catch (e) {
        logger.warn(`[PDF] LAC sales lookup failed: ${e.message}`);
    }

    const snapshotData = await getSnapshotCommissionData(year, startMonth, endMonth);
    snapshotData.rowsByVendor.forEach((months, normalizedCode) => {
        Object.entries(months).forEach(([monthKey, snapshotRow]) => {
            const month = parseInt(monthKey, 10);
            upsertVendorMonth(
                vendorMap,
                normalizedCode,
                null,
                month,
                {
                    snapshotTotal: snapshotRow.ventasReal,
                    isHistoricalCommissionMonth: snapshotData.coveredMonths.has(month),
                    snapshotStatus: 'recorded',
                }
            );
        });
    });

    return Array.from(vendorMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}

async function getCondorSalesData(year, startMonth, endMonth) {
    const condorMap = new Map();

    try {
        const rows = await queryWithParams(`
            SELECT
                TRIM(B.CODIGOVENDEDOR) as VENDEDOR_CODIGO,
                COALESCE(TRIM(V.NOMBREVENDEDOR), '') as NOMBRE_VENDEDOR,
                B.MES,
                SUM(B.IMPORTE) as VENTAS_CONDOR
            FROM JAVIER.VENTAS_B B
            LEFT JOIN DSEDAC.VDD V ON TRIM(B.CODIGOVENDEDOR) = TRIM(V.CODIGOVENDEDOR)
            WHERE B.EJERCICIO = ?
              AND B.MES BETWEEN ? AND ?
            GROUP BY TRIM(B.CODIGOVENDEDOR), V.NOMBREVENDEDOR, B.MES
            ORDER BY TRIM(B.CODIGOVENDEDOR), B.MES
        `, [parseInt(year, 10), parseInt(startMonth, 10), parseInt(endMonth, 10)], false, false);

        rows.forEach(row => {
            const normalized = normalizeVendorCode(row.VENDEDOR_CODIGO);
            if (!normalized) return;
            if (!condorMap.has(normalized)) {
                condorMap.set(normalized, {
                    code: displayVendorCode(row.VENDEDOR_CODIGO),
                    normalizedCode: normalized,
                    name: row.NOMBRE_VENDEDOR || `Vendedor ${displayVendorCode(row.VENDEDOR_CODIGO)}`,
                    months: {},
                });
            }
            const entry = condorMap.get(normalized);
            if (row.NOMBRE_VENDEDOR && (!entry.name || entry.name.startsWith('Vendedor '))) {
                entry.name = row.NOMBRE_VENDEDOR;
            }
            entry.months[parseInt(row.MES, 10)] = { condor: toNumber(row.VENTAS_CONDOR) };
        });

        logger.info(`[PDF] Loaded CONDOR sales for ${condorMap.size} vendors.`);
    } catch (e) {
        logger.warn(`[PDF] CONDOR sales lookup failed: ${e.message}`);
    }

    return condorMap;
}

async function getVendorPaymentsForPdf(year) {
    const map = new Map();

    try {
        const rows = await queryWithParams(`
            SELECT
                VENDEDOR_CODIGO,
                MES,
                IMPORTE_PAGADO,
                OBSERVACIONES
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE ANIO = ?
            ORDER BY VENDEDOR_CODIGO, MES
        `, [parseInt(year, 10)], false, false);

        rows.forEach(row => {
            const code = row.VENDEDOR_CODIGO || '';
            const month = parseInt(row.MES, 10);
            const normalized = normalizeVendorCode(code);
            if (!normalized || !Number.isFinite(month)) return;

            if (!map.has(normalized)) map.set(normalized, {});
            if (!map.get(normalized)[month]) {
                map.get(normalized)[month] = { importePagado: 0, observaciones: [] };
            }

            map.get(normalized)[month].importePagado += toNumber(row.IMPORTE_PAGADO);
            if (row.OBSERVACIONES && row.OBSERVACIONES.trim()) {
                map.get(normalized)[month].observaciones.push(row.OBSERVACIONES.trim());
            }
        });
    } catch (e) {
        logger.warn(`[PDF] Payments lookup failed: ${e.message}`);
    }

    return map;
}

function getVendorCodesFromData(vendorData, condorDataMap) {
    const codes = new Set();
    (vendorData || []).forEach(vendor => {
        if (vendor?.code) codes.add(normalizeVendorCode(vendor.code));
    });
    (condorDataMap || new Map()).forEach((entry, code) => {
        codes.add(normalizeVendorCode(entry?.code || code));
    });
    return Array.from(codes).filter(Boolean);
}

function buildVariantParams(vendorCodes) {
    return [...new Set(vendorCodes.flatMap(getCodeVariants))];
}

async function getPreviousYearLacSales(year, startMonth, endMonth, vendorCodes) {
    const map = new Map();
    const codeParams = buildVariantParams(vendorCodes);
    if (codeParams.length === 0) return map;

    try {
        const vendorColExpr = getVendorColumnExpr('L');
        const codePlaceholders = codeParams.map(() => '?').join(',');
        const rows = await queryWithParams(`
            SELECT
                RTRIM(${vendorColExpr}) as VENDEDOR_CODIGO,
                L.LCMMDC as MES,
                SUM(L.LCIMVT) as VENTAS_LAC
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ?
              AND L.LCMMDC BETWEEN ? AND ?
              AND ${LACLAE_SALES_FILTER}
              AND RTRIM(${vendorColExpr}) IN (${codePlaceholders})
            GROUP BY RTRIM(${vendorColExpr}), L.LCMMDC
        `, [parseInt(year, 10) - 1, parseInt(startMonth, 10), parseInt(endMonth, 10), ...codeParams], false, false);

        rows.forEach(row => {
            setNestedMonthValue(map, row.VENDEDOR_CODIGO, parseInt(row.MES, 10), toNumber(row.VENTAS_LAC));
        });
    } catch (e) {
        logger.warn(`[PDF] Previous-year LAC lookup failed: ${e.message}`);
    }

    return map;
}

async function getPreviousYearCondorSales(year, startMonth, endMonth, vendorCodes) {
    const map = new Map();
    const codeParams = buildVariantParams(vendorCodes);
    if (codeParams.length === 0) return map;

    try {
        const placeholders = codeParams.map(() => '?').join(',');
        const rows = await queryWithParams(`
            SELECT
                TRIM(CODIGOVENDEDOR) as VENDEDOR_CODIGO,
                MES,
                SUM(IMPORTE) as VENTAS_CONDOR
            FROM JAVIER.VENTAS_B
            WHERE EJERCICIO = ?
              AND MES BETWEEN ? AND ?
              AND TRIM(CODIGOVENDEDOR) IN (${placeholders})
            GROUP BY TRIM(CODIGOVENDEDOR), MES
        `, [parseInt(year, 10) - 1, parseInt(startMonth, 10), parseInt(endMonth, 10), ...codeParams], false, false);

        rows.forEach(row => {
            setNestedMonthValue(map, row.VENDEDOR_CODIGO, parseInt(row.MES, 10), toNumber(row.VENTAS_CONDOR));
        });
    } catch (e) {
        logger.warn(`[PDF] Previous-year CONDOR lookup failed: ${e.message}`);
    }

    return map;
}

async function getFixedCommissionTargets(year, vendorCodes) {
    const map = new Map();
    const codeParams = buildVariantParams(vendorCodes);
    if (codeParams.length === 0) return map;

    try {
        const currentMonth = new Date().getMonth() + 1;
        const placeholders = codeParams.map(() => '?').join(',');
        const rows = await queryWithParams(`
            SELECT
                TRIM(CODIGOVENDEDOR) as VENDEDOR_CODIGO,
                IMPORTE_BASE_COMISION,
                MES
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE ANIO = ?
              AND ACTIVO = 1
              AND TRIM(CODIGOVENDEDOR) IN (${placeholders})
            ORDER BY TRIM(CODIGOVENDEDOR), MES DESC
        `, [parseInt(year, 10), ...codeParams], false, false);

        const rowsByVendor = new Map();
        rows.forEach(row => {
            const normalized = normalizeVendorCode(row.VENDEDOR_CODIGO);
            if (!normalized) return;
            if (!rowsByVendor.has(normalized)) rowsByVendor.set(normalized, []);
            rowsByVendor.get(normalized).push(row);
        });

        rowsByVendor.forEach((vendorRows, normalizedCode) => {
            const best = vendorRows
                .sort((a, b) => (toNumber(b.MES) || 0) - (toNumber(a.MES) || 0))
                .find(row => !row.MES || parseInt(row.MES, 10) <= currentMonth);
            if (best) {
                const amount = toNumber(best.IMPORTE_BASE_COMISION);
                if (amount > 0) map.set(normalizedCode, amount);
            }
        });
    } catch (e) {
        logger.warn(`[PDF] COMMERCIAL_TARGETS lookup failed: ${e.message}`);
    }

    return map;
}

function getMonthValue(nestedMap, code, month, fallback = 0) {
    const entry = getVendorEntry(nestedMap, code);
    if (!entry) return fallback;
    const value = entry[month];
    return value === undefined || value === null ? fallback : value;
}

function getSnapshotEntry(snapshotData, code, month) {
    const months = getVendorEntry(snapshotData.rowsByVendor, code);
    return months ? months[month] || null : null;
}

async function buildMonthlyTargetsAndCommissions(vendorData, condorDataMap, year, startMonth, endMonth) {
    const vendorCodes = getVendorCodesFromData(vendorData, condorDataMap);
    const [config, fixedTargets, prevLac, snapshotData] = await Promise.all([
        getCommissionConfig(year),
        getFixedCommissionTargets(year, vendorCodes),
        getPreviousYearLacSales(year, startMonth, endMonth, vendorCodes),
        getSnapshotCommissionData(year, startMonth, endMonth),
    ]);

    const targetMap = new Map();

    vendorCodes.forEach(code => {
        const normalized = normalizeVendorCode(code);
        const vendor = (vendorData || []).find(v => normalizeVendorCode(v.code) === normalized);
        const condorEntry = getVendorEntry(condorDataMap, normalized);
        const fixedTarget = fixedTargets.get(normalized);

        for (let month = startMonth; month <= endMonth; month++) {
            const lacData = vendor?.months?.[month] || {};
            const condorData = condorEntry?.months?.[month] || {};
            const lacSales = toNumber(lacData.lac);
            const condorSales = toNumber(condorData.condor);
            const previousSales = toNumber(getMonthValue(prevLac, normalized, month));

            let target = fixedTarget && fixedTarget > 0
                ? fixedTarget
                : previousSales * (1 + (config.ipc / 100));
            let totalSales = lacSales + condorSales;
            let commission = calculateCommission(totalSales, target, config).commission;
            let paidOverride = null;
            let status = 'live';

            const snapshotEntry = getSnapshotEntry(snapshotData, normalized, month);
            const coveredHistoricalMonth = parseInt(year, 10) === 2026 &&
                SNAPSHOT_UNTIL_MONTH > 0 &&
                month <= SNAPSHOT_UNTIL_MONTH &&
                snapshotData.coveredMonths.has(month);

            if (coveredHistoricalMonth && snapshotEntry) {
                target = snapshotEntry.objetivoMes > 0 ? snapshotEntry.objetivoMes : target;
                totalSales = snapshotEntry.ventasReal;
                commission = snapshotEntry.comisionGenerada;
                paidOverride = snapshotEntry.importePagado;
                status = 'recorded';
            } else if (coveredHistoricalMonth) {
                commission = 0;
                paidOverride = 0;
                status = 'not_commissioned';
            }

            setNestedMonthValue(targetMap, normalized, month, {
                objetivo: target,
                totalVentas: totalSales,
                comisionGenerada: commission,
                importePagadoOverride: paidOverride,
                isHistoricalCommissionMonth: coveredHistoricalMonth,
                snapshotStatus: status,
            });
        }
    });

    return targetMap;
}

function buildPdfVendorList(vendorData, condorDataMap) {
    const map = new Map();

    (vendorData || []).forEach(vendor => {
        const normalized = normalizeVendorCode(vendor.code);
        if (!normalized) return;
        map.set(normalized, {
            ...vendor,
            normalizedCode: normalized,
            months: vendor.months || {},
        });
    });

    (condorDataMap || new Map()).forEach((condorEntry, code) => {
        const normalized = normalizeVendorCode(condorEntry?.code || code);
        if (!normalized || map.has(normalized)) return;
        map.set(normalized, {
            code: displayVendorCode(condorEntry?.code || code),
            normalizedCode: normalized,
            name: condorEntry?.name || `Vendedor ${displayVendorCode(condorEntry?.code || code)}`,
            months: {},
        });
    });

    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function getMetricEntry(targetMap, code, month) {
    const months = getVendorEntry(targetMap, code);
    return months ? months[month] || null : null;
}

function pctColor(pct) {
    if (pct >= 100) return COLORS.good;
    if (pct > 0) return COLORS.warning;
    return COLORS.muted;
}

function getVendorCondorMonth(condorDataMap, vendorCode, month) {
    const entry = getVendorEntry(condorDataMap, vendorCode);
    return toNumber(entry?.months?.[month]?.condor);
}

function getSummaryPayment(vendor, month) {
    const payments = vendor?.payments || {};
    const monthlyPaid = toNumber(payments.monthly?.[month]);
    const detailPaid = toNumber(payments.details?.[month]?.totalPaid);
    return detailPaid || monthlyPaid;
}

function drawSummaryPdfTable({
    doc,
    vendor,
    condorDataMap,
    startMonth,
    endMonth,
    margin,
    tableWidth,
    cols,
    yPos,
}) {
    const ROW_H = 15;
    const HDR_H = 18;
    const normalized = normalizeVendorCode(vendor.vendedorCode || vendor.code);

    doc.rect(margin, yPos, tableWidth, HDR_H).fill(COLORS.header);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.headerText)
        .text(`${displayVendorCode(vendor.vendedorCode || vendor.code)}  ${vendor.vendorName || vendor.name || ''}`, margin + 5, yPos + 5, {
            width: tableWidth - 10,
            align: 'left'
        });
    yPos += HDR_H;

    let xPos = margin;
    cols.forEach(col => {
        doc.rect(xPos, yPos, col.width, HDR_H).fill(COLORS.columnHeader).stroke(COLORS.grid);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.text)
            .text(col.label, xPos + 2, yPos + 5, {
                width: col.width - 4,
                align: col.key === 'obs' ? 'left' : 'center'
            });
        xPos += col.width;
    });
    yPos += HDR_H;

    const totals = {
        objective: 0,
        lac: 0,
        condor: 0,
        sales: 0,
        generated: 0,
        paid: 0,
    };

    for (let month = startMonth; month <= endMonth; month++) {
        const monthData = (vendor.months || []).find(item => parseInt(item.month, 10) === month) || {};
        const actual = toNumber(monthData.actual);
        const objective = toNumber(monthData.target);
        const condorAmount = getVendorCondorMonth(condorDataMap, normalized, month);
        const lacAmount = Math.max(actual - condorAmount, 0);
        const generated = toNumber(monthData.complianceCtx?.commission);
        const paid = getSummaryPayment(vendor, month);
        const pct = objective > 0 ? (actual / objective) * 100 : 0;

        totals.objective += objective;
        totals.lac += lacAmount;
        totals.condor += condorAmount;
        totals.sales += actual;
        totals.generated += generated;
        totals.paid += paid;

        const rowBg = (month - startMonth) % 2 === 0 ? COLORS.rowAlt : '#FFFFFF';
        doc.rect(margin, yPos, tableWidth, ROW_H).fill(rowBg);

        const values = {
            mes: getMonthName(month).substring(0, 3).toUpperCase(),
            obj: formatCurrency(objective),
            lac: formatCurrency(lacAmount),
            condor: formatCurrency(condorAmount),
            total: formatCurrency(actual),
            pct: objective > 0 ? formatPct(pct) : '-',
            gen: formatCurrency(generated),
            pag: formatCurrency(paid),
            obs: monthData.isFuture ? 'Mes futuro' : '',
        };

        xPos = margin;
        cols.forEach(col => {
            let color = COLORS.text;
            const align = col.key === 'mes' || col.key === 'obs' ? 'left' : 'right';

            if (col.key === 'obj' && objective > 0) color = COLORS.objective;
            if (col.key === 'condor' && condorAmount > 0) color = COLORS.condor;
            if (col.key === 'total' && objective > 0) color = pctColor(pct);
            if (col.key === 'pct') color = pctColor(pct);
            if (col.key === 'gen') color = generated > 0 ? COLORS.good : COLORS.muted;
            if (col.key === 'pag') color = paid > 0 ? COLORS.header : COLORS.muted;
            if (col.key === 'obs') color = COLORS.muted;

            doc.font('Helvetica').fontSize(7).fillColor(color)
                .text(values[col.key], xPos + 2, yPos + 4, {
                    width: col.width - 4,
                    align,
                });
            doc.rect(xPos, yPos, col.width, ROW_H).stroke(COLORS.grid);
            xPos += col.width;
        });

        yPos += ROW_H;
    }

    doc.rect(margin, yPos, tableWidth, HDR_H).fill(COLORS.totalBg);
    const totalPct = totals.objective > 0 ? (totals.sales / totals.objective) * 100 : 0;
    const totalValues = {
        mes: 'TOTAL',
        obj: formatCurrency(totals.objective),
        lac: formatCurrency(totals.lac),
        condor: formatCurrency(totals.condor),
        total: formatCurrency(totals.sales),
        pct: totals.objective > 0 ? formatPct(totalPct) : '-',
        gen: formatCurrency(totals.generated),
        pag: formatCurrency(totals.paid),
        obs: totals.condor > 0 ? 'Incluye ventas B' : '',
    };

    xPos = margin;
    cols.forEach(col => {
        const align = col.key === 'mes' || col.key === 'obs' ? 'left' : 'right';
        doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.totalText)
            .text(totalValues[col.key], xPos + 2, yPos + 5, {
                width: col.width - 4,
                align,
            });
        doc.rect(xPos, yPos, col.width, HDR_H).stroke(COLORS.grid);
        xPos += col.width;
    });

    return {
        yPos: yPos + HDR_H + 8,
        totals,
    };
}

function drawTeamLeadSection(doc, teamData, year, startMonth, endMonth, margin, contentWidth, pageHeight) {
    if (!teamData || !teamData.months) return margin + 40;

    const cols = [
        { key: 'code', label: 'Comercial', width: 70 },
        { key: 'prev', label: 'Ventas LY', width: 90 },
        { key: 'curr', label: 'Ventas CY', width: 90 },
        { key: 'inc', label: 'Incremento', width: 90 },
        { key: 'qual', label: 'Umbral', width: 50 },
        { key: 'own', label: 'Com. propia', width: 80 },
    ];
    const HDR_H = 16;
    const ROW_H = 14;
    let yPos = margin;

    if (yPos > pageHeight - 120) {
        doc.addPage({ layout: 'landscape' });
        yPos = margin;
    }

    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.header)
        .text(`Equipo Almeria (${teamData.leaderCode}) — umbral LY+IPC y franjas por comercial (sin gate 4/4)`, margin, yPos, { width: contentWidth });
    yPos += 18;

    for (let month = startMonth; month <= endMonth; month++) {
        const tm = teamData.months.find((m) => m.month === month);
        if (!tm) continue;

        if (yPos > pageHeight - 100) {
            doc.addPage({ layout: 'landscape' });
            yPos = margin;
        }

        const teamExcess = tm.teamMembersExcess ?? 0;
        const teamComm = tm.teamMembersCommission ?? 0;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
            .text(
                `${getMonthName(month)} ${year} — equipo exceso ${formatCurrency(teamExcess)} · comision ${formatCurrency(teamComm)} · califican ${tm.qualifyingMembers ?? 0}/4`,
                margin,
                yPos,
            );
        yPos += 14;

        doc.rect(margin, yPos, contentWidth, HDR_H).fill(COLORS.columnHeader);
        let xPos = margin;
        cols.forEach((col) => {
            doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.header)
                .text(col.label, xPos + 2, yPos + 4, { width: col.width - 4, align: 'left' });
            doc.rect(xPos, yPos, col.width, HDR_H).stroke(COLORS.grid);
            xPos += col.width;
        });
        yPos += HDR_H;

        (tm.members || []).forEach((member, idx) => {
            const rowBg = idx % 2 === 0 ? COLORS.rowAlt : '#FFFFFF';
            doc.rect(margin, yPos, contentWidth, ROW_H).fill(rowBg);
            xPos = margin;
            const values = {
                code: displayVendorCode(member.vendorCode),
                prev: formatCurrency(member.prevYearSales),
                curr: formatCurrency(member.currentSales),
                inc: formatCurrency(member.excess),
                qual: member.qualifies ? 'SI' : 'NO',
                own: formatCurrency(member.commission),
            };
            cols.forEach((col) => {
                const color = col.key === 'qual' ? (member.qualifies ? COLORS.good : COLORS.bad) : COLORS.text;
                doc.font('Helvetica').fontSize(7).fillColor(color)
                    .text(values[col.key], xPos + 2, yPos + 3, { width: col.width - 4, align: col.key === 'code' ? 'left' : 'right' });
                doc.rect(xPos, yPos, col.width, ROW_H).stroke(COLORS.grid);
                xPos += col.width;
            });
            yPos += ROW_H;
        });

        yPos += 6;
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.good)
        .text(
            `Atrasos ene-${getMonthName(endMonth).toLowerCase()}: ${formatCurrency(teamData.arrearsTotal || 0)} | Anual JL (exceso propio): ${formatCurrency(teamData.annualExcess || teamData.annualTotal || 0)}`,
            margin,
            yPos,
        );
    return yPos + 20;
}

async function generateCommissionsPdfFromSummary(summaryVendors, condorDataMap, year, startMonth, endMonth, teamCommissionData = null) {
    const vendors = [...(summaryVendors || [])].sort((a, b) => {
        const aCode = displayVendorCode(a.vendedorCode || a.code || '');
        const bCode = displayVendorCode(b.vendedorCode || b.code || '');
        return aCode.localeCompare(bCode);
    });

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 30,
                layout: 'landscape'
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;
            const margin = 30;
            const contentWidth = pageWidth - margin * 2;
            const tableWidth = contentWidth;
            const periodLabel = startMonth === endMonth
                ? `${getMonthName(startMonth)} ${year}`
                : `${getMonthName(startMonth)} - ${getMonthName(endMonth)} ${year}`;
            const now = new Date();
            const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            const cols = [
                { key: 'mes', label: 'Mes', width: 48 },
                { key: 'obj', label: 'Objetivo', width: 80 },
                { key: 'lac', label: 'Venta LAC', width: 80 },
                { key: 'condor', label: 'Venta B', width: 82 },
                { key: 'total', label: 'Total ventas', width: 82 },
                { key: 'pct', label: '% Cumpl.', width: 58 },
                { key: 'gen', label: 'Com. gen.', width: 74 },
                { key: 'pag', label: 'Com. pag.', width: 74 },
                { key: 'obs', label: 'Observaciones', width: 204 },
            ];

            const drawPageHeader = (y) => {
                doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.header)
                    .text('Informe de comisiones comerciales', margin, y, {
                        width: contentWidth / 2,
                        align: 'left'
                    });
                doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
                    .text(`${periodLabel} | Generado: ${dateStr}`, margin + contentWidth / 2, y + 2, {
                        width: contentWidth / 2,
                        align: 'right'
                    });
                return y + 20;
            };

            let yPos = drawPageHeader(margin);
            let firstVendor = true;
            const globalTotals = {
                objective: 0,
                lac: 0,
                condor: 0,
                sales: 0,
                generated: 0,
                paid: 0,
            };

            vendors.forEach(vendor => {
                const monthsInRange = endMonth - startMonth + 1;
                const estimatedHeight = 18 * 3 + 15 * monthsInRange + 18;
                if (!firstVendor && yPos + estimatedHeight > pageHeight - margin - 20) {
                    doc.addPage();
                    yPos = drawPageHeader(margin);
                }
                firstVendor = false;

                const drawn = drawSummaryPdfTable({
                    doc,
                    vendor,
                    condorDataMap,
                    startMonth,
                    endMonth,
                    margin,
                    tableWidth,
                    cols,
                    yPos,
                });
                yPos = drawn.yPos;
                Object.keys(globalTotals).forEach(key => {
                    globalTotals[key] += drawn.totals[key] || 0;
                });
            });

            const globalNeededHeight = 36;
            if (yPos + globalNeededHeight > pageHeight - margin - 20) {
                doc.addPage();
                yPos = drawPageHeader(margin);
            }

            doc.rect(margin, yPos, tableWidth, 20).fill('#111827');
            const globalPct = globalTotals.objective > 0
                ? (globalTotals.sales / globalTotals.objective) * 100
                : 0;
            const globalValues = [
                'ACUMULADO',
                formatCurrency(globalTotals.objective),
                formatCurrency(globalTotals.lac),
                formatCurrency(globalTotals.condor),
                formatCurrency(globalTotals.sales),
                globalTotals.objective > 0 ? formatPct(globalPct) : '-',
                formatCurrency(globalTotals.generated),
                formatCurrency(globalTotals.paid),
                '',
            ];

            let xPos = margin;
            cols.forEach((col, index) => {
                const align = index === 0 || col.key === 'obs' ? 'left' : 'right';
                doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF')
                    .text(globalValues[index], xPos + 2, yPos + 6, {
                        width: col.width - 4,
                        align,
                    });
                doc.rect(xPos, yPos, col.width, 20).stroke(COLORS.grid);
                xPos += col.width;
            });

            doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
                .text('GMP App Movilidad | Uso interno', margin, pageHeight - 28, {
                    width: contentWidth,
                    align: 'left'
                });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

async function generateCommissionsPdf(vendorData, condorDataMap, year, startMonth, endMonth) {
    const targetMap = await buildMonthlyTargetsAndCommissions(vendorData, condorDataMap, year, startMonth, endMonth);
    const paymentsMap = await getVendorPaymentsForPdf(year);
    const vendors = buildPdfVendorList(vendorData, condorDataMap);

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 30,
                layout: 'landscape'
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;
            const margin = 30;
            const contentWidth = pageWidth - margin * 2;
            const tableWidth = contentWidth;
            const periodLabel = startMonth === endMonth
                ? `${getMonthName(startMonth)} ${year}`
                : `${getMonthName(startMonth)} - ${getMonthName(endMonth)} ${year}`;

            const now = new Date();
            const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            const cols = [
                { key: 'mes', label: 'Mes', width: 48 },
                { key: 'obj', label: 'Objetivo', width: 80 },
                { key: 'lac', label: 'Venta LAC', width: 80 },
                { key: 'condor', label: 'Venta CONDOR', width: 82 },
                { key: 'total', label: 'Total ventas', width: 82 },
                { key: 'pct', label: '% Cumpl.', width: 58 },
                { key: 'gen', label: 'Com. gen.', width: 74 },
                { key: 'pag', label: 'Com. pag.', width: 74 },
                { key: 'obs', label: 'Observaciones', width: 204 },
            ];

            const ROW_H = 15;
            const HDR_H = 18;

            const drawPageHeader = (y) => {
                doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.header)
                    .text('Informe de comisiones comerciales', margin, y, {
                        width: contentWidth / 2,
                        align: 'left'
                    });
                doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
                    .text(`${periodLabel} | Generado: ${dateStr}`, margin + contentWidth / 2, y + 2, {
                        width: contentWidth / 2,
                        align: 'right'
                    });
                return y + 20;
            };

            let yPos = drawPageHeader(margin);
            let firstVendor = true;

            vendors.forEach(vendor => {
                const normalized = normalizeVendorCode(vendor.code);
                const condorEntry = getVendorEntry(condorDataMap, normalized) || { months: {} };
                const vendorPayments = getVendorEntry(paymentsMap, normalized) || {};
                const monthsInRange = endMonth - startMonth + 1;
                const estimatedHeight = HDR_H * 2 + ROW_H * monthsInRange + HDR_H + 14;

                if (!firstVendor && yPos + estimatedHeight > pageHeight - margin - 20) {
                    doc.addPage();
                    yPos = drawPageHeader(margin);
                }
                firstVendor = false;

                doc.rect(margin, yPos, tableWidth, HDR_H).fill(COLORS.header);
                doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.headerText)
                    .text(`${vendor.code}  ${vendor.name || ''}`, margin + 5, yPos + 5, {
                        width: tableWidth - 10,
                        align: 'left'
                    });
                yPos += HDR_H;

                let xPos = margin;
                cols.forEach(col => {
                    doc.rect(xPos, yPos, col.width, HDR_H).fill(COLORS.columnHeader).stroke(COLORS.grid);
                    doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.text)
                        .text(col.label, xPos + 2, yPos + 5, {
                            width: col.width - 4,
                            align: col.key === 'obs' ? 'left' : 'center'
                        });
                    xPos += col.width;
                });
                yPos += HDR_H;

                let totalObj = 0;
                let totalLac = 0;
                let totalCondor = 0;
                let totalSales = 0;
                let totalGenerated = 0;
                let totalPaid = 0;
                let hasCondor = false;

                for (let month = startMonth; month <= endMonth; month++) {
                    const monthLacData = vendor.months?.[month] || {};
                    const condorData = condorEntry.months?.[month] || {};
                    const metric = getMetricEntry(targetMap, normalized, month) || {};
                    const payment = vendorPayments[month] || { importePagado: 0, observaciones: [] };

                    const condorAmount = toNumber(condorData.condor);
                    const totalAmount = Number.isFinite(parseFloat(metric.totalVentas))
                        ? toNumber(metric.totalVentas)
                        : toNumber(monthLacData.lac) + condorAmount;
                    const lacAmount = metric.snapshotStatus === 'recorded'
                        ? Math.max(totalAmount - condorAmount, 0)
                        : toNumber(monthLacData.lac);
                    const objective = toNumber(metric.objetivo);
                    const pct = objective > 0 ? (totalAmount / objective) * 100 : 0;
                    const generated = toNumber(metric.comisionGenerada);
                    const paid = metric.importePagadoOverride !== null && metric.importePagadoOverride !== undefined
                        ? toNumber(metric.importePagadoOverride)
                        : toNumber(payment.importePagado);
                    const observations = [];

                    if (metric.snapshotStatus === 'not_commissioned') {
                        observations.push('Mes cerrado sin comision registrada');
                    }
                    if (payment.observaciones && payment.observaciones.length > 0) {
                        observations.push(...payment.observaciones);
                    }

                    totalObj += objective;
                    totalLac += lacAmount;
                    totalCondor += condorAmount;
                    totalSales += totalAmount;
                    totalGenerated += generated;
                    totalPaid += paid;
                    if (condorAmount > 0) hasCondor = true;

                    const rowBg = (month - startMonth) % 2 === 0 ? COLORS.rowAlt : '#FFFFFF';
                    doc.rect(margin, yPos, tableWidth, ROW_H).fill(rowBg);

                    const values = {
                        mes: getMonthName(month).substring(0, 3).toUpperCase(),
                        obj: objective > 0 ? formatCurrency(objective) : '0,00',
                        lac: formatCurrency(lacAmount),
                        condor: formatCurrency(condorAmount),
                        total: formatCurrency(totalAmount),
                        pct: objective > 0 ? formatPct(pct) : '-',
                        gen: formatCurrency(generated),
                        pag: formatCurrency(paid),
                        obs: observations.join('; '),
                    };

                    xPos = margin;
                    cols.forEach(col => {
                        let color = COLORS.text;
                        let align = col.key === 'mes' || col.key === 'obs' ? 'left' : 'right';

                        if (col.key === 'obj' && objective > 0) color = COLORS.objective;
                        if (col.key === 'condor' && condorAmount > 0) color = COLORS.condor;
                        if (col.key === 'total' && objective > 0) color = pctColor(pct);
                        if (col.key === 'pct') color = pctColor(pct);
                        if (col.key === 'gen') color = generated > 0 ? COLORS.good : COLORS.muted;
                        if (col.key === 'pag') color = paid > 0 ? COLORS.header : COLORS.muted;
                        if (col.key === 'obs') color = COLORS.muted;

                        const text = col.key === 'obs' && values.obs.length > 58
                            ? `${values.obs.substring(0, 55)}...`
                            : values[col.key];

                        doc.font('Helvetica').fontSize(7).fillColor(color)
                            .text(text, xPos + 2, yPos + 4, {
                                width: col.width - 4,
                                align,
                            });
                        doc.rect(xPos, yPos, col.width, ROW_H).stroke(COLORS.grid);
                        xPos += col.width;
                    });

                    yPos += ROW_H;
                }

                doc.rect(margin, yPos, tableWidth, HDR_H).fill(COLORS.totalBg);
                const totalPct = totalObj > 0 ? (totalSales / totalObj) * 100 : 0;
                const totalValues = {
                    mes: 'TOTAL',
                    obj: formatCurrency(totalObj),
                    lac: formatCurrency(totalLac),
                    condor: formatCurrency(totalCondor),
                    total: formatCurrency(totalSales),
                    pct: totalObj > 0 ? formatPct(totalPct) : '-',
                    gen: formatCurrency(totalGenerated),
                    pag: formatCurrency(totalPaid),
                    obs: hasCondor ? 'Tiene ventas CONDOR' : '',
                };

                xPos = margin;
                cols.forEach(col => {
                    const align = col.key === 'mes' || col.key === 'obs' ? 'left' : 'right';
                    doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.totalText)
                        .text(totalValues[col.key], xPos + 2, yPos + 5, {
                            width: col.width - 4,
                            align,
                        });
                    doc.rect(xPos, yPos, col.width, HDR_H).stroke(COLORS.grid);
                    xPos += col.width;
                });

                yPos += HDR_H + 8;
            });

            if (teamCommissionData) {
                drawTeamLeadSection(
                    doc,
                    teamCommissionData,
                    year,
                    startMonth,
                    endMonth,
                    margin,
                    contentWidth,
                    pageHeight,
                );
            }

            doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
                .text('GMP App Movilidad | Uso interno', margin, pageHeight - 28, {
                    width: contentWidth,
                    align: 'left'
                });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    isAuthorized,
    getLacSalesData,
    getCondorSalesData,
    generateCommissionsPdf,
    generateCommissionsPdfFromSummary,
    _private: {
        calculateCommission,
        buildMonthlyTargetsAndCommissions,
        generateCommissionsPdfFromSummary,
        getSnapshotCommissionData,
        normalizeVendorCode,
    },
};
