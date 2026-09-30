'use strict';

jest.mock('../middleware/db-timing', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
}));
jest.mock('../utils/common', () => ({
    LACLAE_SALES_FILTER: "L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC')",
}));

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
