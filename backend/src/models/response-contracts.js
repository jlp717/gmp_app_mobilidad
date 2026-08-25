'use strict';

/**
 * Modelos de respuesta (contratos de salida) para los endpoints migrados.
 * Documentacion ejecutable: los tests de contrato usan estas claves como
 * referencia canonica del payload observable.
 */

const METRICS_RESPONSE_KEYS = Object.freeze([
    'period', 'totalSales', 'totalBoxes', 'totalOrders', 'totalMargin',
    'uniqueClients', 'avgOrderValue', 'todaySales', 'todayOrders',
    'lastMonthSales', 'growthPercent', 'sales', 'margin', 'clients', 'boxes',
]);

const SALES_EVOLUTION_ITEM_KEYS = Object.freeze([
    'year', 'month', 'totalSales', 'totalOrders', 'uniqueClients',
]);

const RUTERO_WEEK_KEYS = Object.freeze([
    'week', 'todayName', 'role', 'totalUniqueClients',
]);

const VENCIMIENTOS_RESPONSE_KEYS = Object.freeze([
    'success', 'repartidorId', 'range', 'vencimientos', 'pagination',
]);

module.exports = {
    METRICS_RESPONSE_KEYS,
    SALES_EVOLUTION_ITEM_KEYS,
    RUTERO_WEEK_KEYS,
    VENCIMIENTOS_RESPONSE_KEYS,
};
