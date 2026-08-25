'use strict';

const { RepartidorFinanzasService } = require('../../src/services/repartidorFinanzas.service');

describe('RepartidorFinanzasService: DI y delegacion exacta', () => {
    test('inyeccion de financeService mock recibe argumentos tal cual', async () => {
        const financeMock = {
            getDailySummary: jest.fn(async () => ({ day: {} })),
            getVencimientos: jest.fn(async () => ({ items: [], total: 0, hasMore: false, nextCursor: null })),
            getCommissionSummary: jest.fn(async () => ({ tiers: [] })),
        };
        const svc = new RepartidorFinanzasService({ financeService: financeMock });

        await svc.getDailySummary({ repartidorId: '12', date: '2026-08-25' });
        expect(financeMock.getDailySummary).toHaveBeenCalledWith({ repartidorId: '12', date: '2026-08-25' });

        await svc.getVencimientos({ repartidorId: '12', from: '2026-01-01', to: '2026-02-01', limit: 50, cursor: undefined, clientCode: undefined, search: undefined, estado: 'pendiente' });
        expect(financeMock.getVencimientos).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pendiente', limit: 50 }));

        await svc.getCommissionSummary({ repartidorId: '30', from: '2026-08-01', to: '2026-08-25' });
        expect(financeMock.getCommissionSummary).toHaveBeenCalledWith({ repartidorId: '30', from: '2026-08-01', to: '2026-08-25' });
    });

    test('sin dependencias construye delegadores (el canonico se valida en su propia suite)', () => {
        // No invocamos metodos: require del servicio real valida runtime reparto
        // y su suite dedicada ya cubre comportamiento.
        const svc = new RepartidorFinanzasService();
        expect(typeof svc.getDailySummary).toBe('function');
        expect(typeof svc.getVencimientos).toBe('function');
        expect(typeof svc.getCommissionSummary).toBe('function');
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
