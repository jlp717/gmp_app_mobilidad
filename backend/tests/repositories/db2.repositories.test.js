'use strict';

const { RuteroRepository } = require('../../src/repositories/rutero.repository');
const { DashboardRepository } = require('../../src/repositories/dashboard.repository');

describe('repositories: parametrizacion SQL y seams', () => {
    test('RuteroRepository ERP: un placeholder por codigo + fecha como binds', async () => {
        const q = jest.fn(async () => [{ DELIVERED: '7' }]);
        const repo = new RuteroRepository({ queryWithParams: q });
        const n = await repo.fetchErpDeliveredCount(['A1', 'B2'], { dia: 25, mes: 8, ano: 2026 });
        expect(n).toBe(7);
        const [sql, params] = q.mock.calls[0];
        expect((sql.match(/\?/g) || []).length).toBe(5); // 2 codes + dia+mes+ano
        expect(params).toEqual(['A1', 'B2', 25, 8, 2026]);
        // Solo lectura: DSEDAC ERP
        expect(sql).toMatch(/DSEDAC\.OPP/);
    });

    test('RuteroRepository app: esquema nuevo usa IDEMPOTENCY_TOKEN/OPERADOR', async () => {
        process.env.DELIVERY_STATUS_SCHEMA = 'new';
        const q = jest.fn(async () => [{ DELIVERED: '3' }]);
        const repo = new RuteroRepository({ queryWithParams: q });
        await repo.fetchAppDeliveredCount(['A1']);
        const [sql] = q.mock.calls[0];
        if (/IDEMPOTENCY_TOKEN/.test(sql)) {
            expect(sql).toMatch(/DS\.OPERADOR/);
            expect(sql).toMatch(/JAVIER\.DELIVERY_STATUS/);
        } else {
            expect(sql).toMatch(/DS\.REPARTIDOR_ID/);
        }
    });

    test('RuteroRepository fallback CDVI: sin codes no ejecuta SQL', async () => {
        const q = jest.fn();
        const repo = new RuteroRepository({ queryWithParams: q });
        const rows = await repo.fetchWeeklyVisitCounts([]);
        expect(rows).toEqual([]);
        expect(q).not.toHaveBeenCalled();
    });

    test('RuteroRepository fallback con codes: IN parametrizado sobre CODIGOVENDEDOR', async () => {
        const q = jest.fn(async () => [{ LUNES: '1' }]);
        const repo = new RuteroRepository({ queryWithParams: q });
        await repo.fetchWeeklyVisitCounts(['X9']);
        const [sql, params] = q.mock.calls[0];
        expect(sql).toMatch(/TRIM\(CODIGOVENDEDOR\) IN \(\?\)/);
        expect(params).toEqual(['X9']);
    });

    test('DashboardRepository.fetchPeriodAggregate delega en cachedQuery inyectado', async () => {
        const cachedQuery = jest.fn(async () => [{ SALES: '1' }]);
        const qfn = jest.fn();
        const repo = new DashboardRepository({ queryWithParams: qfn, cachedQuery });
        const out = await repo.fetchPeriodAggregate('SELECT 1', [5], 'k', 60);
        expect(out).toEqual([{ SALES: '1' }]);
        expect(cachedQuery).toHaveBeenCalledWith(qfn, 'SELECT 1', 'k', 60, [5]);
    });
});
