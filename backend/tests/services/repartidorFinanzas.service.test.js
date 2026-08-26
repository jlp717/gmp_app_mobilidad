'use strict';

const { RepartidorFinanzasService } = require('../../src/services/repartidorFinanzas.service');

describe('RepartidorFinanzasService: DI y delegacion exacta', () => {
    let financeMock;
    let svc;

    beforeEach(() => {
        financeMock = {
            getDailySummary: jest.fn(),
            getVencimientos: jest.fn(),
            getCommissionSummary: jest.fn(),
        };
        svc = new RepartidorFinanzasService({ financeService: financeMock });
    });

    test('getDailySummary delega params exactos y devuelve el resultado canonico', async () => {
        const params = { repartidorId: '12', date: '2026-08-25' };
        const expected = { day: { total: 42 } };
        financeMock.getDailySummary.mockResolvedValue(expected);

        await expect(svc.getDailySummary(params)).resolves.toBe(expected);
        expect(financeMock.getDailySummary).toHaveBeenCalledTimes(1);
        expect(financeMock.getDailySummary).toHaveBeenCalledWith(params);
    });

    test('getVencimientos delega params exactos y devuelve la pagina canonica', async () => {
        const params = {
            repartidorId: '12',
            from: '2026-01-01',
            to: '2026-02-01',
            limit: 50,
            cursor: 'cursor-1',
            clientCode: 'C001',
            search: 'cliente',
            estado: 'pendiente',
        };
        const expected = { items: [{ id: 'F-1' }], total: 1, hasMore: false, nextCursor: null };
        financeMock.getVencimientos.mockResolvedValue(expected);

        await expect(svc.getVencimientos(params)).resolves.toBe(expected);
        expect(financeMock.getVencimientos).toHaveBeenCalledTimes(1);
        expect(financeMock.getVencimientos).toHaveBeenCalledWith(params);
    });

    test('getCommissionSummary delega params exactos y devuelve el resumen canonico', async () => {
        const params = { repartidorId: '30', from: '2026-08-01', to: '2026-08-25' };
        const expected = { tiers: [{ rate: 0.03 }] };
        financeMock.getCommissionSummary.mockResolvedValue(expected);

        await expect(svc.getCommissionSummary(params)).resolves.toBe(expected);
        expect(financeMock.getCommissionSummary).toHaveBeenCalledTimes(1);
        expect(financeMock.getCommissionSummary).toHaveBeenCalledWith(params);
    });
});

describe('validators repartidorFinanzas: mismas reglas que el route legacy', () => {
    const v = require('../../src/validators/repartidorFinanzas.validators');

    test('listParams ACEPTA ALL a nivel schema (paridad); el guard 422 vive aparte', () => {
        expect(v.listParamsSchema.safeParse({ repartidorId: 'ALL' }).success).toBe(true);
        expect(v.listParamsSchema.safeParse({ repartidorId: '12,34' }).success).toBe(true);
    });

    test('vencimientos clamp de limit y rango invalido 400-equivalente', () => {
        const ok = v.vencimientosQuerySchema.safeParse({ limit: '200' });
        expect(ok.success).toBe(true);
        expect(ok.data.limit).toBe(100);
        const bad = v.vencimientosQuerySchema.safeParse({ from: '2026-05-01', to: '2026-01-01' });
        expect(bad.success).toBe(false);
    });

    test('assertExplicitRepartidorSelector lanza 422 para ALL multiple', () => {
        expect(() => v.assertExplicitRepartidorSelector('10,ALL')).toThrow(v.UnsupportedRepartidorSelectorError);
        expect(() => v.assertExplicitRepartidorSelector('10')).not.toThrow();
    });
});
