'use strict';

const SNAPSHOT_SOURCE = 'JAVIER.COMMISSION_SNAPSHOT_2026_0102';

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
        actual: 0,
        target: 0,
        commission: 0,
        isHistoricalSnapshot: true,
        snapshotSource: SNAPSHOT_SOURCE,
        status: 'not_commissioned',
        hasStoredValues: false,
    };
}

module.exports = {
    SNAPSHOT_SOURCE,
    resolveHistoricalCommissionMonth,
};
