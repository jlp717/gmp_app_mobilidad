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

jest.mock('../services/query-optimizer', () => ({
    cachedQuery: jest.fn(async (runner, sql) => runner(sql)),
}));

jest.mock('../services/redis-cache', () => ({ redisCache: {}, TTL: { SHORT: 60 } }));

describe('getOrders bolsaGenerada', () => {
    let mockQuery;
    let pedidosService;

    beforeEach(() => {
        jest.resetModules();
        mockQuery = require('../config/db').queryWithParams;
        mockQuery.mockReset();
        pedidosService = require('../services/pedidos.service');
    });

    test('maps bolsaGenerada true when MOV exists for pedido', async () => {
        mockQuery.mockResolvedValueOnce([
            {
                ID: 42,
                EJERCICIO: 2026,
                NUMEROPEDIDO: 1,
                SERIEPEDIDO: 'M',
                TERMINAL: 999,
                TERMINALPEDIDO: 999,
                DIADOCUMENTO: 1,
                MESDOCUMENTO: 6,
                ANODOCUMENTO: 2026,
                HORADOCUMENTO: 120000,
                CODIGOCLIENTE: '4300001091',
                NOMBRECLIENTE: 'Cliente Test',
                CODIGOVENDEDOR: '93',
                TIPOVENTA: 'CC',
                ESTADO: 'BORRADOR',
                IMPORTETOTAL: 10,
                IMPORTEBASE: 0,
                IMPORTEIVA: 0,
                IMPORTECOSTO: 0,
                IMPORTEMARGEN: 0,
                IMPORTE_CALCULADO: 10,
                TOTAL_COSTO: 0,
                OBSERVACIONES: '',
                CODIGOFORMAPAGO: '02',
                CODIGOTARIFA: 1,
                ORIGEN: 'A',
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
                BOLSA_MOV_COUNT: 1,
            },
        ]);

        const { orders } = await pedidosService.getOrders({ vendedorCodes: '93', year: 2026 });
        expect(orders).toHaveLength(1);
        expect(orders[0].bolsaGenerada).toBe(true);
    });

    test('maps bolsaGenerada false when no MOV row', async () => {
        mockQuery.mockResolvedValueOnce([
            {
                ID: 43,
                EJERCICIO: 2026,
                NUMEROPEDIDO: 2,
                SERIEPEDIDO: 'M',
                TERMINAL: 999,
                TERMINALPEDIDO: 999,
                DIADOCUMENTO: 2,
                MESDOCUMENTO: 6,
                ANODOCUMENTO: 2026,
                HORADOCUMENTO: 120000,
                CODIGOCLIENTE: '4300001091',
                NOMBRECLIENTE: 'Cliente Test',
                CODIGOVENDEDOR: '93',
                TIPOVENTA: 'CC',
                ESTADO: 'BORRADOR',
                IMPORTETOTAL: 5,
                IMPORTEBASE: 0,
                IMPORTEIVA: 0,
                IMPORTECOSTO: 0,
                IMPORTEMARGEN: 0,
                IMPORTE_CALCULADO: 5,
                TOTAL_COSTO: 0,
                OBSERVACIONES: '',
                CODIGOFORMAPAGO: '02',
                CODIGOTARIFA: 1,
                ORIGEN: 'A',
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
            },
        ]);

        const { orders } = await pedidosService.getOrders({ vendedorCodes: '93', year: 2026 });
        expect(orders[0].bolsaGenerada).toBe(false);
    });
});

describe('tariff deviation guard', () => {
    let pedidosService;

    beforeEach(() => {
        jest.resetModules();
        pedidosService = require('../services/pedidos.service');
    });

    test('assertPrecioWithinClientTariff rejects >50% deviation for COMERCIAL', () => {
        expect(() => pedidosService.assertPrecioWithinClientTariff({
            precioVenta: 9,
            tariffPrice: 20,
            userRole: 'COMERCIAL',
            articleCode: 'ART1',
        })).toThrow(/desvia/);
    });

    test('assertPrecioWithinClientTariff allows JEFE_VENTAS override', () => {
        expect(() => pedidosService.assertPrecioWithinClientTariff({
            precioVenta: 1,
            tariffPrice: 20,
            userRole: 'JEFE_VENTAS',
            articleCode: 'ART1',
        })).not.toThrow();
    });
});


