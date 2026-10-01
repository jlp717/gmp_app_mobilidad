'use strict';

/**
 * REQ-25 tanda4: promos backend sin DB2 real (TEST-only, mocks QSYS2).
 * - Tabla NONE (sin PRD/PMR/PMRC/PMP/CPES) → [].
 * - PRD existe pero fuera de vigencia → [] con log total/vigentes.
 */

const PRD_COLS = [
    'CODIGOARTICULO', 'DESCRIPCION', 'TIPOPROMOCION', 'PRECIOPROMOCIONAL',
    'CANTIDADMINIMA', 'CANTIDADREGALO', 'ACUMULABLESN',
    'DIADESDE', 'MESDESDE', 'ANODESDE', 'DIAHASTA', 'MESHASTA', 'ANOHASTA',
].map((COLUMN_NAME) => ({ COLUMN_NAME }));

function loadService({ sysColumnsByTable, promoRows, countTotal }) {
    jest.resetModules();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    jest.doMock('../../middleware/logger', () => logger);
    const queryWithParams = jest.fn(async (sql, params) => {
        const s = String(sql || '');
        if (s.includes('QSYS2.SYSCOLUMNS')) {
            const table = Array.isArray(params) ? String(params[1] || '').toUpperCase() : '';
            return sysColumnsByTable[table] || [];
        }
        if (s.includes('COUNT(*) AS TOTAL')) return [{ TOTAL: countTotal }];
        return promoRows;
    });
    jest.doMock('../../config/db', () => ({
        query: jest.fn(async () => []),
        queryWithParams,
        getPool: jest.fn(() => null),
        initDb: jest.fn(async () => null),
    }));
    jest.doMock('../../services/redis-cache', () => ({
        redisCache: { get: jest.fn(async () => null), set: jest.fn(async () => true) },
        TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, STATIC: 3600 },
    }));
    jest.doMock('../../services/query-optimizer', () => ({
        cachedQuery: jest.fn(async (fn, sql) => fn(sql)),
        invalidateOnMutation: jest.fn(),
        patternFor: jest.fn((p) => p),
    }));
    const svc = require('../../services/pedidos/index');
    return { svc, logger, queryWithParams };
}

describe('REQ-25 promos backend (TEST-only mocks)', () => {
    test('tablas NONE → [] y warn desactivadas', async () => {
        const { svc, logger } = loadService({
            sysColumnsByTable: {},
            promoRows: [],
            countTotal: 0,
        });
        const res = await svc.getActivePromotions('C001');
        expect(res).toEqual([]);
        const warns = logger.warn.mock.calls.map((c) => String(c[0] || ''));
        expect(warns.some((m) => /Ninguna tabla de promociones/i.test(m))).toBe(true);
    });

    test('PRD fuera vigencia → [] con log total/vigentes', async () => {
        const { svc, logger } = loadService({
            sysColumnsByTable: { PRD: PRD_COLS },
            promoRows: [],
            countTotal: 3,
        });
        const res = await svc.getActivePromotions('C001');
        expect(res).toEqual([]);
        const infos = logger.info.mock.calls.map((c) => String(c[0] || ''));
        expect(
            infos.some((m) => /total filas=3/i.test(m) && /vigentes hoy=0/i.test(m)),
        ).toBe(true);
    });

    test('catalogo: vigente en promotions y caducada en history', async () => {
        const year = new Date().getFullYear();
        const { svc, queryWithParams } = loadService({
            sysColumnsByTable: {
                PMR: [{ COLUMN_NAME: 'CODIGOPROMOCIONREGALO' }],
            },
            promoRows: [
                {
                    PROMO_CODE: 'NEW1',
                    PROMO_NAME: 'Nueva',
                    ANOINICIO: year,
                    MESINICIO: 1,
                    DIAINICIO: 1,
                    ANOFIN: 0,
                    MESFIN: 0,
                    DIAFIN: 0,
                },
                {
                    PROMO_CODE: 'OLD1',
                    PROMO_NAME: 'Antigua',
                    ANOINICIO: year - 2,
                    MESINICIO: 1,
                    DIAINICIO: 1,
                    ANOFIN: year - 1,
                    MESFIN: 1,
                    DIAFIN: 1,
                },
            ],
            countTotal: 2,
        });

        const catalog = await svc.getClientPromotionCatalog('4300000362');
        expect(catalog.newCount).toBe(1);
        expect(catalog.promotions.map((p) => p.promoCode)).toEqual(['NEW1']);
        expect(catalog.promotions[0].active).toBe(true);
        expect(catalog.history.map((p) => p.promoCode)).toEqual(['OLD1']);
        expect(catalog.history[0].active).toBe(false);

        const activeOnly = await svc.getActivePromotions('4300000362');
        expect(activeOnly.map((p) => p.promoCode)).toEqual(['NEW1']);

        const pmrCalls = queryWithParams.mock.calls.filter((call) =>
            String(call[0] || '').includes('CODIGOPROMOCIONREGALO'),
        );
        expect(String(pmrCalls[0][0])).not.toContain('ANOFIN * 10000');
        expect(String(pmrCalls[0][0])).toContain('ANOINICIO');
        expect(String(pmrCalls[1][0])).toContain('ANOFIN');
    });
});
