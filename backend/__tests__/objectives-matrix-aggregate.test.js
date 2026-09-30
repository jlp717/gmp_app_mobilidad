'use strict';

jest.mock('../middleware/db-timing', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
}));
jest.mock('../utils/common', () => ({
    LACLAE_SALES_FILTER: "L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC')",
}));

const { fetchMatrixProductRows } = require('../repositories/objectives-repository');

test('matrix sales aggregate in decfloat before the article join', async () => {
    const calls = [];
    const db = {
        queryWithParams: async (sql, params) => {
            calls.push({ sql, params });
            return [];
        },
    };

    await fetchMatrixProductRows('4300007540', [2026, 2025, 2024, 2023], 1, 12, ' AND UPPER(L.LCCDRF) LIKE ?', ['%X%'], db);

    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql).toContain('DECFLOAT(34)');
    expect(sql).not.toMatch(/SUM\(S\.LCIMVT\)/);
    expect(sql).not.toMatch(/SUM\(L\.LCIMVT\)/);
    expect(sql.indexOf('GROUP BY S.LCCDRF')).toBeLessThan(sql.indexOf('LEFT JOIN LATERAL'));
    expect(calls[0].params[0]).toBe('4300007540');
    expect(calls[0].params).toContain(2023);
    expect(calls[0].params[calls[0].params.length - 1]).toBe('%X%');
});
