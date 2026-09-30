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
    expect(sql).toContain('AS DOUBLE');
    expect(sql).not.toMatch(/SUM\(S\.LCIMVT\)/);
    expect(sql).not.toMatch(/SUM\(L\.LCIMVT\)/);
    expect(sql.indexOf('GROUP BY S.LCCDRF')).toBeLessThan(sql.indexOf('LEFT JOIN LATERAL'));
    expect(calls[0].params[0]).toBe('4300007540');
    expect(calls[0].params).toContain(2023);
    expect(calls[0].params[calls[0].params.length - 1]).toBe('%X%');
});

test('matrix retries plain sums when the precise aggregate overflows', async () => {
    const calls = [];
    const db = {
        queryWithParams: async (sql) => {
            calls.push(sql);
            if (calls.length === 1) {
                const error = new Error('overflow');
                error.odbcErrors = [{ state: '22003', code: -802, message: 'overflow' }];
                throw error;
            }
            return [{ PRODUCT_CODE: 'A' }];
        },
    };

    const rows = await fetchMatrixProductRows('4300000362', [2026], 1, 12, '', [], db);
    expect(rows).toHaveLength(1);
    expect(calls[1]).toContain('SUM(S.LCIMVT) AS SALES');
    expect(calls[1]).not.toContain('DECFLOAT');
});
