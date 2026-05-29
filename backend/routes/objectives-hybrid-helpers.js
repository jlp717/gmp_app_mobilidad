/**
 * Pure helpers for hybrid objective logic (testable, shared with objectives.js).
 */
const SEASONAL_AGGRESSIVENESS = 0.5;

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
};
