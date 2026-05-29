'use strict';

/**
 * Team visibility for commercial 80 (Almería).
 * Commission math uses standard calculateVendorData per vendor:
 * threshold = prevSales × (1 + IPC%), excess = max(0, actual − threshold), tiers on excess.
 * No 4/4 gate; no flat 10% on leader increment.
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
 * IPC (COMM_CONFIG.IPC_PCT, e.g. 3%) = per-vendor threshold inflation (LY + IPC).
 * TEAM_LEAD_YOY_BONUS_PCT (e.g. 10 in TEAM_COMMISSION_RULES) = optional leader
 * bonus on own YoY excess — NOT IPC, NOT used in current calculateVendorData path.
 */
const TEAM_LEAD_YOY_BONUS_PCT = 10;

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

/**
 * @param {Function} calculateVendorData - (code, year, config) => vendor data
 */
async function calculateTeamMonth(leaderCode, year, month, config, calculateVendorData, vendorDataCache) {
    const leader = normalizeVendorCode(leaderCode);
    const teamConfig = await loadTeamCommissionConfig(leader, year);
    const members = [];

    if (!vendorDataCache.has(leader)) {
        vendorDataCache.set(leader, await calculateVendorData(leader, year, config));
    }
    const leaderData = vendorDataCache.get(leader);
    const leaderM = monthMetricsFromVendorData(leaderData, month);

    let qualifyingCount = 0;
    let teamMembersExcess = 0;
    let teamMembersCommission = 0;

    for (const memberCode of teamConfig.memberCodes) {
        if (!vendorDataCache.has(memberCode)) {
            vendorDataCache.set(memberCode, await calculateVendorData(memberCode, year, config));
        }
        const vendorData = vendorDataCache.get(memberCode);
        const m = monthMetricsFromVendorData(vendorData, month);

        if (m.qualifies) qualifyingCount += 1;
        teamMembersExcess += m.excess;
        teamMembersCommission += m.commission;

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

    return {
        year,
        month,
        members,
        leaderPrevSales: leaderM.prevSales,
        leaderCurrentSales: leaderM.currentSales,
        leaderThreshold: leaderM.threshold,
        leaderExcess: leaderM.excess,
        leaderPersonalCommission: leaderM.commission,
        teamMembersExcess,
        teamMembersCommission,
        /** @deprecated use leaderExcess — kept for PDF/clients */
        totalExcess: leaderM.excess,
        totalCommission: 0,
        qualifyingMembers: qualifyingCount,
        allMembersQualified: false,
        config: {
            teamMemberCodes: teamConfig.memberCodes,
            formula: 'LY_threshold_tiers_per_vendor',
        },
    };
}

async function getTeamCommission(leaderCode, year, calculateVendorData, config) {
    const leader = normalizeVendorCode(leaderCode);
    const teamConfig = await loadTeamCommissionConfig(leader, year);
    const vendorDataCache = new Map();
    const months = [];
    const currentMonth = new Date().getMonth() + 1;
    let annualTeamMembersCommission = 0;
    let annualTeamMembersExcess = 0;
    let annualLeaderExcess = 0;

    for (let m = 1; m <= 12; m++) {
        const result = await calculateTeamMonth(
            leader,
            year,
            m,
            config,
            calculateVendorData,
            vendorDataCache,
        );
        months.push(result);
        annualTeamMembersCommission += result.teamMembersCommission;
        annualTeamMembersExcess += result.teamMembersExcess;
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
        annualTeamMembersExcess: annualTeamMembersExcess,
        annualTeamMembersCommission: annualTeamMembersCommission,
        arrearsTotal: 0,
        leaderPersonalCommission: leaderData.grandTotalCommission ?? 0,
        teamMembers: teamConfig.memberCodes,
        config: {
            formula: 'LY_threshold_tiers_per_vendor',
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
};
