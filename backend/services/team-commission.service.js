'use strict';

/**
 * Team visibility for commercial 80 (Almeria).
 * Members keep their normal individual commission calculation.
 * The leader special payout uses accumulated 80+72+73+81+83 sales,
 * with a fixed LY + 10% threshold and no IPC.
 */

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

/**
 * Team lead (commercial 80) — flip here or env TEAM_LEAD_80_ENABLED=false.
 * When off: normal comercial view, no team panel/PDF section.
 */
const TEAM_LEAD_80_ENABLED =
    process.env.TEAM_LEAD_80_ENABLED !== 'false' &&
    process.env.TEAM_LEAD_80_ENABLED !== '0';

const TEAM_LEADER_CODES = new Set(['80']);
/** Four Almería commercials under Juan Luis (80) */
const ALMERIA_TEAM_MEMBERS_80 = ['72', '73', '81', '83'];
/** Scoped "Todos los comerciales" for login 80 */
const ALMERIA_TEAM_WITH_LEADER = ['80', ...ALMERIA_TEAM_MEMBERS_80];
const ALMERIA_TEAM_ACCUMULATED_80 = ['80', ...ALMERIA_TEAM_MEMBERS_80];
const TEAM_LEAD_GROWTH_THRESHOLD_PCT = 10;

const TEAM_CONFIG_BY_LEADER = {
    '80': {
        memberCodes: [...ALMERIA_TEAM_MEMBERS_80],
    },
};

function normalizeVendorCode(code) {
    const raw = String(code || '').trim();
    return raw.replace(/^0+/, '') || raw;
}

function normalizeUserCode(code) {
    return normalizeVendorCode(code);
}

/** Commercial 80 (Almería lead) — scoped "Todos" ≠ jefe global ALL */
function isCommercial80User(userCode) {
    return normalizeUserCode(userCode) === '80';
}

/**
 * Historical name kept for external callers/tests. This is the fixed growth
 * threshold for the 80 accumulated special, not IPC and not OBJ_CONFIG.
 */
const TEAM_LEAD_YOY_BONUS_PCT = TEAM_LEAD_GROWTH_THRESHOLD_PCT;

function isScopedTeamAllRequest(userCode, vendorCode) {
    const code = String(vendorCode || '').trim().toUpperCase();
    return code === 'ALL' && isCommercial80User(userCode);
}

/**
 * Resolve vendor list when vendedorCode=ALL.
 * Commercial 80 → sum ONLY 72,73,81,83 (excludes leader 80 personal sales).
 */
async function resolveAllModeVendorCodes(userCode, year, discoverAllFn) {
    if (isCommercial80User(userCode)) {
        return [...ALMERIA_TEAM_MEMBERS_80];
    }
    return discoverAllFn(year);
}

function resolveAllModeVendorCodesString(userCode) {
    if (isCommercial80User(userCode)) {
        return ALMERIA_TEAM_MEMBERS_80.join(',');
    }
    return 'ALL';
}

function allModeCacheScope(userCode, vendorCode) {
    if (isScopedTeamAllRequest(userCode, vendorCode)) return 'TEAM80';
    if (String(vendorCode || '').trim().toUpperCase() === 'ALL') return 'ALL';
    return null;
}

function isTeamLeader(vendorCode) {
    if (!TEAM_LEAD_80_ENABLED) return false;
    return TEAM_LEADER_CODES.has(normalizeVendorCode(vendorCode));
}

function filterTeamMembers(memberRows, leaderCode) {
    const allowed = new Set(ALMERIA_TEAM_MEMBERS_80);
    const leader = normalizeVendorCode(leaderCode);
    const fromDb = (memberRows || [])
        .map((r) => normalizeVendorCode(r.MEMBER_CODE || r.memberCode || r))
        .filter((c) => c && c !== leader && allowed.has(c));
    if (fromDb.length >= 4) {
        return [...new Set(fromDb)].sort();
    }
    return [...ALMERIA_TEAM_MEMBERS_80];
}

async function loadTeamCommissionConfig(leaderCode, year) {
    const leader = normalizeVendorCode(leaderCode);
    const staticCfg = TEAM_CONFIG_BY_LEADER[leader];
    if (!staticCfg) {
        logger.warn(`[TEAM_COMM] No in-code config for leader ${leader}`);
        return { leaderCode: leader, year, memberCodes: [] };
    }

    if (process.env.TEAM_COMMISSION_USE_DB === 'true') {
        try {
            const rules = await queryWithParams(
                `SELECT LEADER_CODE, YEAR
                 FROM JAVIER.TEAM_COMMISSION_RULES
                 WHERE LEADER_CODE = ? AND YEAR = ? AND ACTIVE = 'Y'
                 FETCH FIRST 1 ROWS ONLY`,
                [leader, year],
                false,
                false,
            );
            if (rules?.length) {
                const members = await queryWithParams(
                    `SELECT MEMBER_CODE
                     FROM JAVIER.TEAM_COMMISSION_MEMBERS
                     WHERE RULE_ID = (
                       SELECT ID FROM JAVIER.TEAM_COMMISSION_RULES
                       WHERE LEADER_CODE = ? AND YEAR = ? AND ACTIVE = 'Y'
                     ) AND ACTIVE = 'Y'
                     ORDER BY MEMBER_CODE`,
                    [leader, year],
                    false,
                    false,
                );
                const memberCodes = filterTeamMembers(members, leader);
                if (memberCodes.length >= 4) {
                    return { leaderCode: leader, year, memberCodes };
                }
            }
        } catch (e) {
            logger.warn(`[TEAM_COMM] DB override skipped for ${leader}: ${e.message}`);
        }
    }

    return {
        leaderCode: leader,
        year,
        memberCodes: filterTeamMembers(
            staticCfg.memberCodes.map((c) => ({ MEMBER_CODE: c })),
            leader,
        ),
    };
}

function monthMetricsFromVendorData(vendorData, month) {
    const md = (vendorData.months || []).find((m) => m.month === month) || {};
    const prevSales = md.prevSales ?? 0;
    const currentSales = md.actual ?? 0;
    const threshold = md.target ?? 0;
    const ctx = md.complianceCtx || {};
    const excess = Math.max(0, currentSales - threshold);
    const ownCommission = ctx.commission ?? 0;
    const qualifies = threshold > 0 && currentSales > threshold;

    return {
        prevSales,
        currentSales,
        threshold,
        excess,
        qualifies,
        commission: ownCommission,
        tier: ctx.tier ?? 0,
        rate: ctx.rate ?? 0,
    };
}

function calculateTierCommission(actual, target, config) {
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

function buildAccumulatedTeamMetrics(leaderMetric, memberMetrics, config) {
    const allMetrics = [leaderMetric, ...memberMetrics];
    const prevSales = allMetrics.reduce((sum, metric) => sum + (metric.prevSales || 0), 0);
    const currentSales = allMetrics.reduce((sum, metric) => sum + (metric.currentSales || 0), 0);
    const threshold = prevSales * (1 + (TEAM_LEAD_GROWTH_THRESHOLD_PCT / 100));
    const result = calculateTierCommission(currentSales, threshold, config);

    return {
        prevSales,
        currentSales,
        threshold,
        excess: Math.max(0, currentSales - threshold),
        commission: result.commission,
        tier: result.tier,
        rate: result.rate,
        compliancePct: result.compliancePct,
        qualifies: threshold > 0 && currentSales > threshold,
        growthThresholdPct: TEAM_LEAD_GROWTH_THRESHOLD_PCT,
        memberCodes: [...ALMERIA_TEAM_ACCUMULATED_80],
    };
}

/**
 * @param {Function} calculateVendorData - (code, year, config) => vendor data
 */
async function calculateTeamMonth(leaderCode, year, month, config, calculateVendorData, vendorDataCache, teamConfig) {
    const leader = normalizeVendorCode(leaderCode);
    const members = [];

    if (!vendorDataCache.has(leader)) {
        vendorDataCache.set(leader, await calculateVendorData(leader, year, config));
    }
    const leaderData = vendorDataCache.get(leader);
    const leaderM = monthMetricsFromVendorData(leaderData, month);

    let qualifyingCount = 0;
    let membersIndividualExcess = 0;
    let membersIndividualCommission = 0;

    for (const memberCode of teamConfig.memberCodes) {
        if (!vendorDataCache.has(memberCode)) {
            vendorDataCache.set(memberCode, await calculateVendorData(memberCode, year, config));
        }
        const vendorData = vendorDataCache.get(memberCode);
        const m = monthMetricsFromVendorData(vendorData, month);

        if (m.qualifies) qualifyingCount += 1;
        membersIndividualExcess += m.excess;
        membersIndividualCommission += m.commission;

        members.push({
            vendorCode: memberCode,
            vendorName: vendorData.vendorName || memberCode,
            prevYearSales: m.prevSales,
            currentSales: m.currentSales,
            threshold: m.threshold,
            excess: m.excess,
            qualifies: m.qualifies,
            commission: m.commission,
            tier: m.tier,
        });
    }

    const accumulated = buildAccumulatedTeamMetrics(
        leaderM,
        members.map(member => ({
            prevSales: member.prevYearSales,
            currentSales: member.currentSales,
        })),
        config,
    );

    return {
        year,
        month,
        members,
        leaderPrevSales: leaderM.prevSales,
        leaderCurrentSales: leaderM.currentSales,
        leaderThreshold: leaderM.threshold,
        leaderExcess: leaderM.excess,
        leaderPersonalCommission: leaderM.commission,
        membersIndividualExcess,
        membersIndividualCommission,
        teamAggregatePrevSales: accumulated.prevSales,
        teamAggregateThreshold: accumulated.threshold,
        teamAggregateCurrentSales: accumulated.currentSales,
        teamAggregateExcess: accumulated.excess,
        teamAggregateCommission: accumulated.commission,
        teamAggregateTier: accumulated.tier,
        teamAggregateRate: accumulated.rate,
        teamAggregateCompliancePct: accumulated.compliancePct,
        teamAggregateQualifies: accumulated.qualifies,
        teamAggregateGrowthPct: accumulated.growthThresholdPct,
        teamAggregateCodes: accumulated.memberCodes,
        teamMembersExcess: accumulated.excess,
        teamMembersCommission: accumulated.commission,
        /** @deprecated use leaderExcess — kept for PDF/clients */
        totalExcess: leaderM.excess,
        totalCommission: 0,
        qualifyingMembers: qualifyingCount,
        allMembersQualified: false,
        config: {
            teamMemberCodes: teamConfig.memberCodes,
            accumulatedCodes: accumulated.memberCodes,
            formula: 'leader_accumulated_LY_plus_10_no_ipc',
        },
    };
}

async function getTeamCommission(leaderCode, year, calculateVendorData, config) {
    const leader = normalizeVendorCode(leaderCode);
    const teamConfig = await loadTeamCommissionConfig(leader, year);
    const vendorDataCache = new Map();
    const months = [];
    const currentMonth = new Date().getMonth() + 1;
    let annualTeamAggregateCommission = 0;
    let annualTeamAggregateExcess = 0;
    let annualMembersIndividualCommission = 0;
    let annualMembersIndividualExcess = 0;
    let annualLeaderExcess = 0;

    for (let m = 1; m <= 12; m++) {
        const result = await calculateTeamMonth(
            leader,
            year,
            m,
            config,
            calculateVendorData,
            vendorDataCache,
            teamConfig,
        );
        months.push(result);
        annualTeamAggregateCommission += result.teamAggregateCommission;
        annualTeamAggregateExcess += result.teamAggregateExcess;
        annualMembersIndividualCommission += result.membersIndividualCommission;
        annualMembersIndividualExcess += result.membersIndividualExcess;
        annualLeaderExcess += result.leaderExcess;
    }

    const leaderData = vendorDataCache.get(leader) || (await calculateVendorData(leader, year, config));

    return {
        success: true,
        year,
        leaderCode: leader,
        months,
        annualTotal: 0,
        annualExcess: annualLeaderExcess,
        annualTeamAggregateExcess,
        annualTeamAggregateCommission,
        annualMembersIndividualExcess,
        annualMembersIndividualCommission,
        annualTeamMembersExcess: annualTeamAggregateExcess,
        annualTeamMembersCommission: annualTeamAggregateCommission,
        arrearsTotal: 0,
        leaderPersonalCommission: leaderData.grandTotalCommission ?? 0,
        teamMembers: teamConfig.memberCodes,
        accumulatedCodes: [...ALMERIA_TEAM_ACCUMULATED_80],
        growthThresholdPct: TEAM_LEAD_GROWTH_THRESHOLD_PCT,
        config: {
            formula: 'leader_accumulated_LY_plus_10_no_ipc',
        },
        currentMonth,
    };
}

/**
 * Team-lead API payload: personal months from calculateVendorData + team breakdown.
 */
function buildTeamLeadSummaryPayload(leaderPersonal, teamData, config, payments) {
    return {
        config,
        grandTotalCommission: leaderPersonal.grandTotalCommission ?? 0,
        totals: { commission: leaderPersonal.grandTotalCommission ?? 0 },
        months: leaderPersonal.months ?? [],
        quarters: leaderPersonal.quarters ?? [],
        vendor: teamData.leaderCode,
        breakdown: [],
        isExcluded: leaderPersonal.isExcluded ?? false,
        isTeamLead: true,
        hidePersonalCommissionBadge: leaderPersonal.isExcluded ?? false,
        teamCommission: teamData,
        payments: payments || leaderPersonal.payments || { monthly: {}, quarterly: {}, total: 0 },
    };
}

module.exports = {
    TEAM_LEAD_80_ENABLED,
    TEAM_LEADER_CODES,
    ALMERIA_TEAM_MEMBERS_80,
    ALMERIA_TEAM_WITH_LEADER,
    ALMERIA_TEAM_ACCUMULATED_80,
    TEAM_LEAD_GROWTH_THRESHOLD_PCT,
    TEAM_LEAD_YOY_BONUS_PCT,
    isTeamLeader,
    isCommercial80User,
    isScopedTeamAllRequest,
    resolveAllModeVendorCodes,
    resolveAllModeVendorCodesString,
    allModeCacheScope,
    loadTeamCommissionConfig,
    getTeamCommission,
    buildTeamLeadSummaryPayload,
    monthMetricsFromVendorData,
    calculateTierCommission,
};
