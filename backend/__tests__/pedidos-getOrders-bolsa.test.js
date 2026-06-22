'use strict';

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: (...args) => mockQueryWithParams(...args),
    getPool: jest.fn(() => null),
    initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
    cachedQuery: async (queryFn, sql) => queryFn(sql),
    invalidateOnMutation: jest.fn(),
}));

jest.mock('../services/redis-cache', () => ({
    redisCache: { get: jest.fn(), set: jest.fn() },
    TTL: { SHORT: 60 },
}));

describe('getOrders bolsaGenerada', () => {
    beforeEach(() => {
        jest.resetModules();
        mockQueryWithParams.mockReset();
    });

    test('maps bolsaGenerada from MOVIMIENTOS_BOLSA aggregate', async () => {
        mockQueryWithParams.mockResolvedValueOnce([
            {
                ID: 101,
                EJERCICIO: 2026,
                NUMEROPEDIDO: 1,
                SERIEPEDIDO: 'M',
                TERMINAL: 93,
                TERMINALPEDIDO: 93,
                DIADOCUMENTO: 1,
                MESDOCUMENTO: 6,
                ANODOCUMENTO: 2026,
                HORADOCUMENTO: 120000,
                CODIGOCLIENTE: '4300000001',
                NOMBRECLIENTE: 'Test',
                CODIGOVENDEDOR: '93',
                TIPOVENTA: 'CC',
                ESTADO: 'CONFIRMADO',
                IMPORTETOTAL: 10,
                IMPORTEBASE: 0,
                IMPORTEIVA: 0,
                IMPORTECOSTO: 0,
                IMPORTEMARGEN: 0,
                IMPORTE_CALCULADO: 10,
                TOTAL_COSTO: 0,
                OBSERVACIONES: '',
                CODIGOFORMAPAGO: '',
                CODIGOTARIFA: 1,
                ORIGEN: 'APP',
                FECHAREPARTO: null,
                DIAREPARTO: 0,
                MESREPARTO: 0,
                ANOREPARTO: 0,
                CODIGOREPARTIDOR: '',
                CODIGOVEHICULO: '',
                RUTA: '',
                DIASREPARTO: '',
                REPARTO_VALIDADO_SN: 'N',
                CREATED_AT: null,
                UPDATED_AT: null,
                LINE_COUNT: 1,
                BOLSA_MOV_COUNT: 2,
                BOLSA_NETO: -3.5,
            },
            {
                ID: 102,
                EJERCICIO: 2026,
                NUMEROPEDIDO: 2,
                SERIEPEDIDO: 'M',
                TERMINAL: 93,
                TERMINALPEDIDO: 93,
                DIADOCUMENTO: 1,
                MESDOCUMENTO: 6,
                ANODOCUMENTO: 2026,
                HORADOCUMENTO: 120000,
                CODIGOCLIENTE: '4300000002',
                NOMBRECLIENTE: 'Test2',
                CODIGOVENDEDOR: '93',
                TIPOVENTA: 'CC',
                ESTADO: 'BORRADOR',
                IMPORTETOTAL: 0,
                IMPORTEBASE: 0,
                IMPORTEIVA: 0,
                IMPORTECOSTO: 0,
                IMPORTEMARGEN: 0,
                IMPORTE_CALCULADO: 5,
                TOTAL_COSTO: 0,
                OBSERVACIONES: '',
                CODIGOFORMAPAGO: '',
                CODIGOTARIFA: 1,
                ORIGEN: 'APP',
                FECHAREPARTO: null,
                DIAREPARTO: 0,
                MESREPARTO: 0,
                ANOREPARTO: 0,
                CODIGOREPARTIDOR: '',
                CODIGOVEHICULO: '',
                RUTA: '',
                DIASREPARTO: '',
                REPARTO_VALIDADO_SN: 'N',
                CREATED_AT: null,
                UPDATED_AT: null,
                LINE_COUNT: 1,
                BOLSA_MOV_COUNT: 0,
                BOLSA_NETO: 0,
            },
        ]);

        const pedidosService = require('../services/pedidos.service');
        const { orders } = await pedidosService.getOrders({ vendedorCodes: '93', year: 2026, limit: 10 });

        expect(orders).toHaveLength(2);
        expect(orders[0].bolsaGenerada).toBe(true);
        expect(orders[0].bolsaNeto).toBe(-3.5);
        expect(orders[1].bolsaGenerada).toBe(false);
        expect(orders[1].bolsaNeto).toBe(0);
        expect(String(mockQueryWithParams.mock.calls[0][0])).toContain('MOVIMIENTOS_BOLSA');
    });
});
