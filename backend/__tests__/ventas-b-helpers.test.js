jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const { queryWithParams } = require('../config/db');
const {
    aggregateBSalesByMonth,
    getBSalesByVendor,
    normalizeSalesVendorCode,
} = require('../utils/common');

describe('ventas B helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('normalizes single-digit vendor codes to ERP format', () => {
        expect(normalizeSalesVendorCode('1')).toBe('01');
        expect(normalizeSalesVendorCode('01')).toBe('01');
        expect(normalizeSalesVendorCode('2')).toBe('02');
        expect(normalizeSalesVendorCode('13')).toBe('13');
        expect(normalizeSalesVendorCode('97')).toBe('97');
    });

    test('loads and aggregates positive and negative B sales by normalized vendor', async () => {
        queryWithParams.mockResolvedValueOnce([
            { CODIGOVENDEDOR: '1', MES: 2, IMPORTE: -479.72 },
            { CODIGOVENDEDOR: '13', MES: 2, IMPORTE: 15652.84 },
            { CODIGOVENDEDOR: '97', MES: 2, IMPORTE: -416.47 },
            { CODIGOVENDEDOR: '2', MES: 4, IMPORTE: 1435.14 },
        ]);

        const byVendor = await getBSalesByVendor(2026);

        expect(byVendor).toEqual({
            '01': { 2: -479.72 },
            '02': { 4: 1435.14 },
            '13': { 2: 15652.84 },
            '97': { 2: -416.47 },
        });
        const byMonth = aggregateBSalesByMonth(byVendor);
        expect(byMonth[2]).toBeCloseTo(14756.65, 2);
        expect(byMonth[4]).toBeCloseTo(1435.14, 2);
    });

    test('uses padded and unpadded variants when scoped to vendors', async () => {
        queryWithParams.mockResolvedValueOnce([]);

        await getBSalesByVendor(2026, ['01', '13']);

        const params = queryWithParams.mock.calls[0][1];
        expect(params).toEqual(expect.arrayContaining([2026, '01', '1', '13']));
    });
});
