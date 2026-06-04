'use strict';

const SNAPSHOT_SOURCE = 'JAVIER.COMMISSION_SNAPSHOT_2026_0102';
const PAYMENT_SNAPSHOT_SOURCE = 'JAVIER.COMMISSION_PAYMENTS';

function toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function hasSnapshotDataForMonth(monthsWithSnapshotData, month) {
    if (!monthsWithSnapshotData) return false;
    if (monthsWithSnapshotData instanceof Set) return monthsWithSnapshotData.has(month);
    if (Array.isArray(monthsWithSnapshotData)) return monthsWithSnapshotData.includes(month);
    return Boolean(monthsWithSnapshotData[month]);
}

function resolveCommissionTarget({
    month,
    fixedTargets,
    fallbackFixedBase,
    prevSales,
    ipc,
}) {
    const safeMonth = parseInt(month, 10);
    const fixedRows = Array.isArray(fixedTargets) ? fixedTargets : [];

    const exact = fixedRows.find(row => row.mes === safeMonth);
    const annual = fixedRows.find(row => row.mes === null);

    const exactBase = toNumber(exact?.importe);
    if (exactBase > 0) {
        return {
            target: exactBase,
            source: 'commercial_targets_exact',
        };
    }

    const annualBase = toNumber(annual?.importe);
    if (annualBase > 0) {
        return {
            target: annualBase,
            source: 'commercial_targets_annual',
        };
    }

    const fallbackBase = toNumber(fallbackFixedBase);
    if (fallbackBase > 0) {
        return {
            target: fallbackBase,
            source: 'commercial_targets_fallback',
        };
    }

    return {
        target: toNumber(prevSales) * (1 + (toNumber(ipc) / 100)),
        source: 'previous_year_plus_ipc',
    };
}

function hasPaymentSnapshotData(paymentDetail) {
    if (!paymentDetail) return false;
    return Boolean(paymentDetail.ultimaFecha)
        || toNumber(paymentDetail.totalPaid) > 0
        || toNumber(paymentDetail.ventaComision) > 0
        || toNumber(paymentDetail.objetivoReal) > 0
        || toNumber(paymentDetail.comisionGenerada) > 0
        || toNumber(paymentDetail.comisionGeneradaSnapshot) > 0;
}

function resolvePaymentSnapshotMonth({
    paymentDetail,
    liveMetrics,
    isExcluded,
}) {
    const live = liveMetrics || {};
    const liveCommission = isExcluded ? 0 : toNumber(live.commission);

    if (!hasPaymentSnapshotData(paymentDetail)) {
        return {
            actual: toNumber(live.actual),
            target: toNumber(live.target),
            commission: liveCommission,
            isPaymentSnapshot: false,
            snapshotSource: null,
            status: 'live',
            hasStoredValues: false,
        };
    }

    const generated = paymentDetail.comisionGeneradaSnapshot !== undefined
        ? toNumber(paymentDetail.comisionGeneradaSnapshot)
        : toNumber(paymentDetail.comisionGenerada);

    return {
        actual: toNumber(paymentDetail.ventaComision) > 0
            ? toNumber(paymentDetail.ventaComision)
            : toNumber(live.actual),
        target: toNumber(paymentDetail.objetivoReal) > 0
            ? toNumber(paymentDetail.objetivoReal)
            : toNumber(live.target),
        commission: isExcluded ? 0 : generated,
        isPaymentSnapshot: true,
        snapshotSource: PAYMENT_SNAPSHOT_SOURCE,
        status: 'payment_recorded',
        hasStoredValues: true,
    };
}

/**
 * Resolves commission-facing metrics for Jan/Feb 2026.
 *
 * COMMISSION_SNAPSHOT_2026_0102 only contains vendors that generated commission.
 * If a covered month has rows but a vendor is absent, that absence is the
 * authoritative "no commission generated" record for this screen.
 */
function resolveHistoricalCommissionMonth({
    year,
    month,
    snapshotUntilMonth,
    monthsWithSnapshotData,
    snapshotEntry,
    liveMetrics,
    isExcluded,
}) {
    const safeYear = parseInt(year, 10);
    const safeMonth = parseInt(month, 10);
    const safeUntil = parseInt(snapshotUntilMonth, 10) || 0;
    const live = liveMetrics || {};
    const liveCommission = isExcluded ? 0 : toNumber(live.commission);

    const isSnapshotCandidate = safeYear === 2026 && safeUntil > 0 && safeMonth <= safeUntil;
    const monthCovered = isSnapshotCandidate && hasSnapshotDataForMonth(monthsWithSnapshotData, safeMonth);

    if (!monthCovered) {
        return {
            actual: toNumber(live.actual),
            target: toNumber(live.target),
            commission: liveCommission,
            isHistoricalSnapshot: false,
            snapshotSource: null,
            status: 'live',
            hasStoredValues: false,
        };
    }

    if (snapshotEntry) {
        const target = toNumber(snapshotEntry.objetivo) > 0
            ? toNumber(snapshotEntry.objetivo)
            : toNumber(live.target);

        return {
            actual: toNumber(snapshotEntry.ventasTotales),
            target,
            commission: isExcluded ? 0 : toNumber(snapshotEntry.comisionGenerada),
            isHistoricalSnapshot: true,
            snapshotSource: SNAPSHOT_SOURCE,
            status: 'recorded',
            hasStoredValues: true,
        };
    }

    return {
        actual: toNumber(live.actual),
        target: toNumber(live.target),
        commission: 0,
        isHistoricalSnapshot: true,
        snapshotSource: SNAPSHOT_SOURCE,
        status: 'not_commissioned',
        hasStoredValues: false,
    };
}

module.exports = {
    SNAPSHOT_SOURCE,
    PAYMENT_SNAPSHOT_SOURCE,
    resolveCommissionTarget,
    resolveHistoricalCommissionMonth,
    resolvePaymentSnapshotMonth,
};
