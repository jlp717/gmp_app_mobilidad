'use strict';

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn(),
}));

const { queryWithParams } = require('../config/db');
const {
    isTeamLeader,
    getTeamCommission,
    loadTeamCommissionConfig,
    monthMetricsFromVendorData,
    ALMERIA_TEAM_MEMBERS_80,
    isCommercial80User,
    isScopedTeamAllRequest,
    resolveAllModeVendorCodes,
    resolveAllModeVendorCodesString,
    TEAM_LEAD_YOY_BONUS_PCT,
} = require('../services/team-commission.service');

function mockVendorData(code, prevByMonth, actualByMonth, commissionByMonth) {
    const months = [];
    for (let m = 1; m <= 12; m++) {
        const prev = prevByMonth[m] ?? 1000;
        const actual = actualByMonth[m] ?? prev;
        const target = prev * 1.1;
        const commission = commissionByMonth[m] ?? (actual > target ? 5 : 0);
        months.push({
            month: m,
            prevSales: prev,
            actual,
            target,
            complianceCtx: { commission },
        });
    }
    return { vendorName: `Vendor ${code}`, months, grandTotalCommission: 0 };
}

describe('team-commission.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        queryWithParams.mockResolvedValue([]);
    });

    test('isTeamLeader only matches commercial 80', () => {
        expect(isTeamLeader('80')).toBe(true);
        expect(isTeamLeader('080')).toBe(true);
        expect(isTeamLeader('98')).toBe(false);
    });

    test('resolveAllModeVendorCodes scopes ALL for commercial 80 to team members only', async () => {
        const discoverAll = jest.fn(async () => ['05', '10', '72']);
        const scoped = await resolveAllModeVendorCodes('80', 2026, discoverAll);
        expect(scoped).toEqual(ALMERIA_TEAM_MEMBERS_80);
        expect(discoverAll).not.toHaveBeenCalled();

        const global = await resolveAllModeVendorCodes('98', 2026, discoverAll);
        expect(global).toEqual(['05', '10', '72']);
    });

    test('isScopedTeamAllRequest distinguishes commercial 80 ALL from jefe ALL', () => {
        expect(isScopedTeamAllRequest('80', 'ALL')).toBe(true);
        expect(isScopedTeamAllRequest('98', 'ALL')).toBe(false);
        expect(isCommercial80User('080')).toBe(true);
        expect(resolveAllModeVendorCodesString('80')).toBe('72,73,81,83');
    });

    test('TEAM_LEAD_YOY_BONUS_PCT is separate from IPC threshold (3%)', () => {
        expect(TEAM_LEAD_YOY_BONUS_PCT).toBe(10);
    });

    test('loadTeamCommissionConfig uses in-code members without DB', async () => {
        const cfg = await loadTeamCommissionConfig('80', 2026);
        expect(cfg.memberCodes).toEqual(ALMERIA_TEAM_MEMBERS_80);
        expect(queryWithParams).not.toHaveBeenCalled();
    });

    test('monthMetricsFromVendorData uses target as LY threshold and excess', () => {
        const vd = mockVendorData('72', { 1: 1000 }, { 1: 1200 }, { 1: 2 });
        const m = monthMetricsFromVendorData(vd, 1);
        expect(m.threshold).toBe(1100);
        expect(m.excess).toBe(100);
        expect(m.qualifies).toBe(true);
        expect(m.commission).toBe(2);
    });

    test('getTeamCommission: each member independent, no 4/4 gate, no leader 10%', async () => {
        const mockCalculate = jest.fn(async (code) => {
            if (code === '80') {
                return mockVendorData('80', { 1: 5000 }, { 1: 6000 }, { 1: 0 });
            }
            if (code === '73') {
                return mockVendorData('73', { 1: 1000, 2: 1000 }, { 1: 1200, 2: 900 }, { 1: 5, 2: 0 });
            }
            return mockVendorData(code, { 1: 1000, 2: 1000 }, { 1: 1200, 2: 1200 }, { 1: 5, 2: 5 });
        });

        const result = await getTeamCommission('80', 2026, mockCalculate, { ipc: 3 });

        expect(result.teamMembers).toEqual(ALMERIA_TEAM_MEMBERS_80);
        expect(result.annualTotal).toBe(0);

        const jan = result.months.find((m) => m.month === 1);
        expect(jan.totalCommission).toBe(0);
        expect(jan.leaderExcess).toBe(500);
        expect(jan.allMembersQualified).toBe(false);
        expect(jan.qualifyingMembers).toBe(4);
        expect(jan.teamMembersCommission).toBeGreaterThan(0);

        const feb = result.months.find((m) => m.month === 2);
        expect(feb.qualifyingMembers).toBe(3);
        expect(feb.members.find((x) => x.vendorCode === '73')?.qualifies).toBe(false);
        expect(feb.totalCommission).toBe(0);
    });
});
