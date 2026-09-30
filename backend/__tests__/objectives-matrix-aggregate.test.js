'use strict';

jest.mock('../middleware/db-timing', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
}));
jest.mock('../utils/common', () => {
    const actual = jest.requireActual('../utils/common');
    return {
        LACLAE_SALES_FILTER: "L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC')",
        parseCommaSeparatedYears: actual.parseCommaSeparatedYears,
    };
});

const { fetchMatrixProductRows } = require('../repositories/objectives-repository');

test('matrix sales aggregate the selected client without a double cast or article join', async () => {
    const calls = [];
    const db = {
        queryWithParams: async (sql, params) => {
            calls.push({ sql, params });
            if (sql.includes('FROM DSEDAC.ART') || sql.includes('CODIGOARTICULO IN')) return [];
            return [{ PRODUCT_CODE: 'A' }];
        },
    };

    const rows = await fetchMatrixProductRows('4300007540', [2026, 2025, 2024, 2023], 1, 12, '', [], db);

    expect(rows).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql).toContain('SUM(S.LCIMVT) AS SALES');
    expect(sql).not.toContain('AS DOUBLE');
    expect(sql).not.toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('S.LCCDCL = CAST(? AS CHAR(10))');
    expect(calls[0].params[0]).toBe('4300007540');
    expect(calls[0].params).toContain(2023);
});

test('glued year lists are split before they are bound', async () => {
    const calls = [];
    const db = {
        queryWithParams: async (sql, params) => {
            calls.push({ sql, params });
            return [];
        },
    };

    await fetchMatrixProductRows('4300000362', [202620252024, 202620252023], 1, 12, '', [], db);

    expect(calls[0].params).toEqual(['4300000362', 2026, 2025, 2024, 2023, 1, 12]);
    expect(calls[0].sql.match(/\?/g)).toHaveLength(7);
});
