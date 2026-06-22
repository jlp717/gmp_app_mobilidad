'use strict';

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn(),
    getPool: jest.fn(() => null),
    initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

describe('Business audit — pedidos / promos / bolsa', () => {
    let mockQuery;
    let pedidosService;
    let bolsaService;

    beforeEach(() => {
        jest.resetModules();
        mockQuery = require('../config/db').queryWithParams;
        mockQuery.mockReset();
        pedidosService = require('../services/pedidos.service');
        bolsaService = require('../services/bolsa-comercial.service');
    });

    test('getActivePromotions exposes active PMR gift promotions', async () => {
        mockQuery.mockImplementation(async (sql, params) => {
            const table = String(params?.[1] || '').toUpperCase();
            const schema = String(params?.[0] || '').toUpperCase();
            if (String(sql || '').includes('SYSCOLUMNS') && schema === 'DSEDAC' && table === 'PMR') {
                return [{ COLUMN_NAME: 'CODIGOPROMOCIONREGALO' }];
            }
            if (String(sql || '').includes('SYSCOLUMNS')) return [];
            if (String(sql || '').includes('FROM DSEDAC.PMR')) {
                return [{
                    PROMO_CODE: 'PROMO01',
                    PROMO_NAME: 'Regalo muestra',
                    CANTIDADMINIMAPROMOCION: 2,
                    CANTIDADMAXIMAREGALO: 1,
                    PROMOCIONACUMULATIVASN: 'S',
                }];
            }
            return [];
        });

        const result = await pedidosService.getActivePromotions('4300001091');

        expect(result).toEqual([expect.objectContaining({
            code: 'PROMO01',
            name: 'Regalo muestra',
            promoType: 'GIFT',
            minQty: 2,
            giftQty: 1,
            cumulative: true,
        })]);
    });

    test('getActivePromotions returns empty list when active PMR has no rows', async () => {
        mockQuery.mockImplementation(async (sql, params) => {
            const table = String(params?.[1] || '').toUpperCase();
            const schema = String(params?.[0] || '').toUpperCase();
            if (String(sql || '').includes('SYSCOLUMNS') && schema === 'DSEDAC' && table === 'PMR') {
                return [{ COLUMN_NAME: 'CODIGOPROMOCIONREGALO' }];
            }
            if (String(sql || '').includes('SYSCOLUMNS')) return [];
            if (String(sql || '').includes('FROM DSEDAC.PMR')) return [];
            return [];
        });

        const result = await pedidosService.getActivePromotions('4300001091');

        expect(result).toEqual([]);
    });

    test('bolsa differential uses precioTarifaCliente not legacy precioMinimo label', async () => {
        mockQuery.mockResolvedValueOnce([{
            ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 6,
            LIMITE_PCT: 3, SALDO_DISPONIBLE: 100, CONSUMIDO: 0, ACUMULADO: 0,
        }]);

        const result = await bolsaService.validateOrderWithBolsa('10', [{
            precioTarifaCliente: 20,
            precioMinimo: 5,
            precioVenta: 18,
            cantidadEnvases: 3,
        }]);

        expect(result.valid).toBe(true);
        expect(result.consumo).toBe(6);
    });

    test('canonicalOrderStatus maps internal CONFIRMANDO for user-facing simplification', () => {
        expect(pedidosService.canonicalOrderStatus('CONFIRMANDO')).toBe('CONFIRMANDO');
        expect(pedidosService.canonicalOrderStatus('PEND_APROB')).toBe('PENDIENTE_APROBACION');
        expect(pedidosService.canonicalOrderStatus('BORRADOR')).toBe('BORRADOR');
    });
});
