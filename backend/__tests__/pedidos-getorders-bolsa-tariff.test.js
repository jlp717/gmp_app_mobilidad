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
        pedidosService = require('../services/pedidos/index');
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
        pedidosService = require('../services/pedidos/index');
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

    test('resolveServerLineUnitPrice preserves a positive commercial price for Bolsa validation', () => {
        expect(pedidosService.resolveServerLineUnitPrice({
            clientTariff: 10,
            precioMinimo: 8,
            requestedPrice: 0.01,
            userRole: 'COMERCIAL',
            articleCode: 'ART1',
        })).toBe(0.01);
    });

    test('resolveServerLineUnitPrice overwrites with tariff when request is valid', () => {
        expect(pedidosService.resolveServerLineUnitPrice({
            clientTariff: 12.5,
            precioMinimo: 8,
            requestedPrice: 12.5,
            userRole: 'COMERCIAL',
            articleCode: 'ART1',
        })).toBe(12.5);
    });

    test('resolveServerLineUnitPrice keeps REGALO gift lines at 0', () => {
        expect(pedidosService.resolveServerLineUnitPrice({
            clientTariff: 12.5,
            precioMinimo: 8,
            requestedPrice: 0,
            userRole: 'COMERCIAL',
            articleCode: 'ART1',
            isGift: true,
        })).toBe(0);
    });

    test.each(['CAJAS', 'UNIDADES'])(
        'freezes real PES reference for article 2974 in %s and ignores forged client policy flags',
        (unidadMedida) => {
            const resolved = pedidosService._private.resolveAuthoritativeLinePricing({
                line: {
                    codigoArticulo: '2974',
                    unidadMedida,
                    cantidadEnvases: unidadMedida === 'CAJAS' ? 1 : 0,
                    cantidadUnidades: unidadMedida === 'UNIDADES' ? 1 : 0,
                    precioEspecialCliente: false,
                    permiteBajoMinimo: false,
                    precioClienteSource: 'CLIENT_FORGED',
                    precioMinimo: 0.01,
                    precioCosto: 0.01,
                    importeCosto: 999,
                },
                articleCode: '2974',
                clientTariff: 39.4,
                serverMin: 39.4,
                productPricing: {
                    PRECIO_MINIMO: 36.198,
                    COSTE_FABRICACION: 26.065,
                    MARGEN_OBJETIVO_PCT: 20,
                },
                clientPrice: {
                    PRECIO_ESPECIAL: 29.28,
                    IS_SPECIAL_PRICE: 'S',
                    PERMITE_BAJO_MINIMO: 'S',
                    SOURCE: 'DSEDAC.PES',
                    MOTIVO: 'Precio especial ERP',
                },
                userRole: 'COMERCIAL',
            });

            expect(resolved.price).toBe(29.28);
            expect(resolved.referencePrice).toBe(29.28);
            expect(resolved.line).toMatchObject({
                unidadMedida,
                precioTarifa: 39.4,
                precioTarifaCliente: 29.28,
                precioMinimo: 36.198,
                precioEspecialCliente: true,
                permiteBajoMinimo: true,
                precioClienteSource: 'DSEDAC.PES',
                precioCosto: 26.065,
                precioCostoVerificado: true,
            });
        },
    );

    test('rejects a non-gift line when no authoritative ERP price exists', () => {
        expect(() => pedidosService._private.resolveAuthoritativeLinePricing({
            line: {
                codigoArticulo: 'NO-PRICE',
                precio: 0.01,
                precioCosto: 0.01,
                importeCosto: 0.01,
            },
            articleCode: 'NO-PRICE',
            clientTariff: 0,
            serverMin: 0,
            productPricing: null,
            clientPrice: null,
            userRole: 'COMERCIAL',
        })).toThrow(expect.objectContaining({
            code: 'ORDER_PRICE_UNAVAILABLE',
            status: 503,
            articleCode: 'NO-PRICE',
        }));
    });

    test('unknown server cost never produces a fake one-hundred-percent margin', () => {
        const resolved = pedidosService._private.resolveAuthoritativeLinePricing({
            line: {
                codigoArticulo: 'ART-NO-COST',
                precio: 10,
                precioCosto: 0.01,
                importeCosto: 0.01,
            },
            articleCode: 'ART-NO-COST',
            clientTariff: 10,
            serverMin: 0,
            productPricing: null,
            clientPrice: null,
            userRole: 'COMERCIAL',
        });
        const metrics = pedidosService._private.calculateVerifiedCostMetrics({
            importeVenta: 10,
            billingQty: 1,
            precioCosto: resolved.line.precioCosto,
            costVerified: resolved.line.precioCostoVerificado,
        });

        expect(resolved.line).toMatchObject({
            precioCosto: 0,
            precioCostoVerificado: false,
            precioCostoSource: '',
        });
        expect(resolved.line.importeCosto).toBeUndefined();
        expect(metrics).toEqual({ importeCosto: 0, importeMargen: 0, pctMargen: 0 });
    });

    test('rejects a stale offline reference with an actionable typed conflict', () => {
        expect(() => pedidosService._private.resolveAuthoritativeLinePricing({
            line: { codigoArticulo: '2974', precioTarifaCliente: 39.4 },
            articleCode: '2974',
            clientTariff: 39.4,
            serverMin: 39.4,
            productPricing: { PRECIO_MINIMO: 36.198 },
            clientPrice: {
                PRECIO_ESPECIAL: 29.28,
                IS_SPECIAL_PRICE: 'S',
                PERMITE_BAJO_MINIMO: 'S',
                SOURCE: 'DSEDAC.PES',
            },
            userRole: 'COMERCIAL',
        })).toThrow(expect.objectContaining({
            code: 'ORDER_PRICE_SNAPSHOT_STALE',
            status: 409,
            articleCode: '2974',
            quotedPrice: 39.4,
            currentPrice: 29.28,
        }));
    });

    test('does not accept forged special-price authority without a current ERP special row', () => {
        const resolved = pedidosService._private.resolveAuthoritativeLinePricing({
            line: {
                codigoArticulo: '2974',
                precioEspecialCliente: true,
                permiteBajoMinimo: true,
                precioClienteSource: 'DSEDAC.PES',
            },
            articleCode: '2974',
            clientTariff: 39.4,
            serverMin: 36.198,
            productPricing: { PRECIO_MINIMO: 36.198 },
            clientPrice: null,
            userRole: 'COMERCIAL',
        });

        expect(resolved.line).toMatchObject({
            precioTarifaCliente: 39.4,
            precioEspecialCliente: false,
            permiteBajoMinimo: false,
            precioClienteSource: '',
        });
    });

    test('reads confirmed price history from canonical order tables, never a missing duplicate table', async () => {
        const queryWithParams = require('../config/db').queryWithParams;
        queryWithParams.mockResolvedValueOnce([{ PRECIOVENTA: 29.28, FECHA: '2026-11-02' }]);

        await expect(pedidosService.getPrecioHistoricoTEST({
            clientCode: '4300032888',
            articleCode: '2974',
        })).resolves.toEqual([{ PRECIOVENTA: 29.28, FECHA: '2026-11-02' }]);

        const [sql, params] = queryWithParams.mock.calls[0];
        expect(sql).toMatch(/FROM\s+JAVIER\.PEDIDOS_CAB\s+C/i);
        expect(sql).toMatch(/JOIN\s+JAVIER\.PEDIDOS_LIN\s+L/i);
        expect(sql).toMatch(/TRIM\(C\.ESTADO\) = 'CONFIRMADO'/i);
        expect(sql).not.toMatch(/PRECIO_HISTORICO/i);
        expect(params).toEqual(['4300032888', '2974']);
    });
});


