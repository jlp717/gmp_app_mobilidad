/**
 * Pure helpers for hybrid objective logic (testable, shared with objectives.js).
 */
const SEASONAL_AGGRESSIVENESS = 0.5;

const MONTHLY_OBJECTIVE_REBALANCES = [
    {
        year: 2026,
        id: '2026-june-to-nov-dec',
        sourceMonth: 6,
        destinations: [
            { month: 11, amount: 70000 },
            { month: 12, amount: 50000 },
        ],
    },
];

function roundCents(value) {
    return Math.round((parseFloat(value) || 0) * 100) / 100;
}

function computeSeasonalWeightTargets(prevYearMonthlySales, combinedPrevTotal, targetPct) {
    const seasonalWeights = {};
    if (combinedPrevTotal <= 0) return seasonalWeights;

    const avgMonthly = combinedPrevTotal / 12;
    const growthFactor = 1 + (targetPct / 100);
    const annualObjective = combinedPrevTotal * growthFactor;
    let rawSum = 0;
    const tempTargets = {};

    for (let m = 1; m <= 12; m++) {
        const sale = prevYearMonthlySales[m] || 0;
        const deviationRatio = avgMonthly > 0 ? (sale - avgMonthly) / avgMonthly : 0;
        const variableGrowthPct = (targetPct / 100) * (1 + (SEASONAL_AGGRESSIVENESS * deviationRatio));
        tempTargets[m] = sale * (1 + variableGrowthPct);
        rawSum += tempTargets[m];
    }

    const correctionFactor = rawSum > 0 ? annualObjective / rawSum : 1;
    for (let m = 1; m <= 12; m++) {
        seasonalWeights[m] = tempTargets[m] * correctionFactor;
    }
    return seasonalWeights;
}

function getObjectiveMonthlyRebalances(year, rebalances = MONTHLY_OBJECTIVE_REBALANCES) {
    const safeYear = parseInt(year, 10);
    if (!safeYear) return [];

    return (rebalances || [])
        .filter(rule => parseInt(rule.year, 10) === safeYear)
        .map(rule => {
            const destinations = (rule.destinations || [])
                .map(dest => ({
                    month: parseInt(dest.month, 10),
                    amount: parseFloat(dest.amount) || 0,
                }))
                .filter(dest => dest.month >= 1 && dest.month <= 12 && dest.amount !== 0);
            const amount = rule.amount != null
                ? parseFloat(rule.amount) || 0
                : destinations.reduce((sum, dest) => sum + dest.amount, 0);

            return {
                ...rule,
                sourceMonth: parseInt(rule.sourceMonth, 10),
                amount,
                destinations,
            };
        })
        .filter(rule => rule.sourceMonth >= 1 && rule.sourceMonth <= 12 && rule.amount !== 0);
}

function hasObjectiveMonthlyRebalances(year) {
    return getObjectiveMonthlyRebalances(year).length > 0;
}

function allocationFactorForMonth(allocationFactorsByMonth, month) {
    if (!allocationFactorsByMonth) return 1;
    const factor = parseFloat(allocationFactorsByMonth[month]);
    return Number.isFinite(factor) && factor >= 0 ? factor : 0;
}

function applyMonthlyObjectiveRebalances(monthlyTargets, year, options = {}) {
    const monthly = {};
    for (let m = 1; m <= 12; m++) {
        monthly[m] = parseFloat(monthlyTargets?.[m]) || 0;
    }

    const rules = getObjectiveMonthlyRebalances(year, options.rebalances);
    if (rules.length === 0) return monthly;

    const allocationFactorsByMonth = options.allocationFactorsByMonth || null;
    for (const rule of rules) {
        const sourceFactor = allocationFactorForMonth(allocationFactorsByMonth, rule.sourceMonth);
        monthly[rule.sourceMonth] = roundCents(monthly[rule.sourceMonth] - (rule.amount * sourceFactor));

        for (const dest of rule.destinations) {
            const destFactor = allocationFactorForMonth(allocationFactorsByMonth, dest.month);
            monthly[dest.month] = roundCents(monthly[dest.month] + (dest.amount * destFactor));
        }
    }

    return monthly;
}

function sumMonthlyObjectives(monthlyTargets) {
    return Object.values(monthlyTargets || {}).reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
}

function applyHybridMonthlyObjectives(prevYearMonthlySales, combinedPrevTotal, targetPct, exactFixedByMonth) {
    const seasonalWeights = computeSeasonalWeightTargets(
        prevYearMonthlySales,
        combinedPrevTotal,
        targetPct,
    );
    const annualDynamic = Object.values(seasonalWeights).reduce((s, v) => s + v, 0);

    const pinnedMonths = Object.keys(exactFixedByMonth)
        .map(m => parseInt(m, 10))
        .filter(m => m >= 1 && m <= 12 && exactFixedByMonth[m] > 0);

    if (pinnedMonths.length === 0) {
        return { monthly: seasonalWeights, annual: annualDynamic };
    }

    let pinnedSum = 0;
    const monthly = {};
    for (let m = 1; m <= 12; m++) {
        if (exactFixedByMonth[m] > 0) {
            monthly[m] = exactFixedByMonth[m];
            pinnedSum += exactFixedByMonth[m];
        }
    }

    const remainder = Math.max(0, annualDynamic - pinnedSum);
    const nonPinned = [];
    let weightSum = 0;
    for (let m = 1; m <= 12; m++) {
        if (exactFixedByMonth[m] > 0) continue;
        nonPinned.push(m);
        weightSum += seasonalWeights[m] || 0;
    }

    if (nonPinned.length === 0) {
        return { monthly, annual: Object.values(monthly).reduce((s, v) => s + v, 0) };
    }

    for (const m of nonPinned) {
        monthly[m] = weightSum > 0
            ? remainder * ((seasonalWeights[m] || 0) / weightSum)
            : remainder / nonPinned.length;
    }

    const annual = Object.values(monthly).reduce((s, v) => s + v, 0);
    return { monthly, annual };
}

module.exports = {
    computeSeasonalWeightTargets,
    applyHybridMonthlyObjectives,
    applyMonthlyObjectiveRebalances,
    getObjectiveMonthlyRebalances,
    hasObjectiveMonthlyRebalances,
    sumMonthlyObjectives,
    MONTHLY_OBJECTIVE_REBALANCES,
};
