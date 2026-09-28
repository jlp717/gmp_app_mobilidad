'use strict';

/**
 * Contrato de fachada del split backend/services/pedidos (lote 2026-09-28).
 * index.js re-exporta implementaciones movidas verbatim a _shared,
 * order-lifecycle, promotions, catalog-aux, discovery, similarity e history.
 * Sin cambios de comportamiento: superficie de 72 claves + identidad por
 * referencia con cada modulo + stubs historicos resolviendo.
 */

const EXPECTED_KEYS = [
    'PRECIO_HISTORICO_TEST_TABLE', '_private', 'addOrderLine',
    'applyConfiguredPricingToProduct', 'applyConfiguredPricingToProducts',
    'applyGiftPromotionsToLines', 'applyProductPriceView',
    'assertOrderEditable', 'assertPrecioWithinClientTariff',
    'buildCreateOrderPayloadHash', 'calculateLineImporte', 'cancelOrder',
    'canonicalOrderStatus', 'checkDraftAccumulation', 'cloneOrder',
    'confirmOrder', 'createOrder', 'deleteOrderLine',
    'effectiveMinPriceFromRow', 'ensurePedidoIdempotencyKeyFromRequest',
    'extractIdempotencyKeyFromRequest', 'generateOrderPdf',
    'generatePedidoIdempotencyKey', 'getActivePromotions',
    'getAvailableVehicles', 'getBrands', 'getClientBalance',
    'getClientPricing', 'getComplementaryProducts',
    'getConfirmedPedidosForRutero', 'getDeliveryOptions', 'getFamilies',
    'getFamiliesDetailed', 'getOrderAlbaran', 'getOrderAnalytics',
    'getOrderDetail', 'getOrderStats', 'getOrderVendorForAuth', 'getOrders',
    'getPedidoSaleTypeLabel', 'getPedidosConfirmationTarget',
    'getPedidosPendientesSyncThreshold', 'getPrecioHistoricoTEST',
    'getProductBrands', 'getProductDetail', 'getProductFamilies',
    'getProductHistory', 'getProductPriceHistory', 'getProductStock',
    'getProducts', 'getRecommendations', 'getSimilarProducts', 'getStock',
    'getStockBatch', 'initPedidosTables', 'isGiftLine',
    'isOrderTransitionAllowed', 'normalizePedidoIdempotencyKey',
    'normalizePedidoSaleType', 'normalizeSearchTerm', 'pedidosBreaker',
    'purgeExpiredDraftReservations', 'resolveIvaFromCodigo',
    'resolveMargenObjetivoPct', 'resolvePrecioMinimoPolitica',
    'resolveServerLineUnitPrice', 'savePrecioHistoricoTEST', 'searchProducts',
    'searchProductsWithStock', 'storedOrderStatus', 'updateOrderLine',
    'updateOrderStatus',
];

function loadAll() {
    jest.resetModules();
    jest.doMock('../../middleware/logger', () => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    jest.doMock('../../config/db', () => ({
        query: jest.fn(async () => []),
        queryWithParams: jest.fn(async () => []),
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
    return {
        index: require('../../services/pedidos/index'),
        lifecycle: require('../../services/pedidos/order-lifecycle'),
        promotions: require('../../services/pedidos/promotions'),
        catalogAux: require('../../services/pedidos/catalog-aux'),
        discovery: require('../../services/pedidos/discovery'),
        similarity: require('../../services/pedidos/similarity'),
        history: require('../../services/pedidos/history'),
    };
}

describe('pedidos split facade (index re-exporta modulos)', () => {
    test('superficie de 72 claves intacta y definida', () => {
        const { index } = loadAll();
        expect(Object.keys(index).sort()).toEqual([...EXPECTED_KEYS].sort());
        for (const k of EXPECTED_KEYS) {
            expect(index[k]).toBeDefined();
        }
    });

    test('identidad por referencia con cada modulo', () => {
        const m = loadAll();
        expect(m.index.getRecommendations).toBe(m.discovery.getRecommendations);
        expect(m.index.getClientBalance).toBe(m.discovery.getClientBalance);
        expect(m.index.cloneOrder).toBe(m.discovery.cloneOrder);
        expect(m.index.getConfirmedPedidosForRutero).toBe(m.catalogAux.getConfirmedPedidosForRutero);
        expect(m.index.searchProducts).toBe(m.catalogAux.searchProducts);
        expect(m.index.getClientPricing).toBe(m.catalogAux.getClientPricing);
        expect(m.index.getActivePromotions).toBe(m.promotions.getActivePromotionsV2);
        expect(m.index.checkDraftAccumulation).toBe(m.lifecycle.checkDraftAccumulation);
        expect(m.index.getOrderVendorForAuth).toBe(m.lifecycle.getOrderVendorForAuth);
        expect(m.index.normalizePedidoSaleType).toBe(m.lifecycle.normalizePedidoSaleType);
        expect(m.index.getPedidosConfirmationTarget).toBe(m.lifecycle.getPedidosConfirmationTarget);
        expect(m.index.getComplementaryProducts).toBe(m.similarity.getComplementaryProducts);
        expect(m.index.getSimilarProducts).toBe(m.similarity.getSimilarProducts);
        expect(m.index.generateOrderPdf).toBe(m.history.generateOrderPdf);
        expect(m.index.getProductHistory).toBe(m.history.getProductHistory);
        expect(m.index.getProductPriceHistory).toBe(m.history.getProductPriceHistory);
        expect(m.index.searchProductsWithStock).toBe(m.history.searchProductsWithStock);
    });

    test('stubs historicos siguen resolviendo via fachada', () => {
        loadAll();
        const catalog = require('../../services/pedidos/catalog');
        const search = require('../../services/pedidos/search');
        const write = require('../../services/pedidos/write');
        const analytics = require('../../services/pedidos/analytics');
        const shared = require('../../services/pedidos/shared');
        expect(typeof catalog.getProducts).toBe('function');
        expect(typeof search.searchProducts).toBe('function');
        expect(typeof write.createOrder).toBe('function');
        expect(typeof write.confirmOrder).toBe('function');
        expect(typeof analytics.getOrderAnalytics).toBe('function');
        expect(typeof shared.initPedidosTables).toBe('function');
        expect(typeof shared.checkDraftAccumulation).toBe('function');
    });
});
