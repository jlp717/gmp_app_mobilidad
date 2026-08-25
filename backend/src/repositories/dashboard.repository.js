'use strict';

const { db } = require('../config');
const { cachedQuery } = require('../../services/query-optimizer');

/**
 * Unico punto de acceso DB2 para los endpoints de dashboard.
 * Los services reciben una instancia de esta clase (o un mock) por constructor;
 * ningun service importa odbc/config-db directamente.
 */
class DashboardRepository {
    /**
     * @param {object} [deps]
     * @param {Function} [deps.queryWithParams] ejecutor SQL parametrizado
     * @param {Function} [deps.cachedQuery] cache de queries (query-optimizer)
     */
    constructor(deps = {}) {
        this._queryWithParams = deps.queryWithParams || ((sql, params, ...rest) => db.queryWithParams(sql, params, ...rest));
        this._cachedQuery = deps.cachedQuery || cachedQuery;
    }

    /** Ventana corriente LACLAE (ventas/margen/cajas/clientes activos). */
    fetchPeriodAggregate(sql, params, cacheKey, ttl) {
        return this._cachedQuery(this._queryWithParams, sql, cacheKey, ttl, params);
    }

    /** Ventas B por vendedor: delega en el helper existente (misma SQL/cache). */
    // ponytail: reutiliza getBSalesByVendor de utils/common; extraer su SQL aqui si se toca esa zona.
    fetchBSalesByVendor(year, vendorScope) {
        const { getBSalesByVendor } = require('../../utils/common');
        return getBSalesByVendor(year, vendorScope);
    }
}

module.exports = { DashboardRepository };
