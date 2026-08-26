'use strict';

const { db } = require('../config');
const {
    parseSalesVendorCodes,
    getSalesVendorCodeVariants,
    normalizeSalesVendorCode,
} = require('../../utils/common');

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutos
const DEFAULT_MAX_ENTRIES = 500;

/**
 * Unico punto de acceso DB2 a JAVIER.VENTAS_B (solo lectura) con cache
 * acotada LRU-simple por clave ano+scope. Los services reciben una instancia
 * (o mock) por constructor; nadie mas toca esta tabla directamente.
 */
class BSalesRepository {
    /**
     * @param {object} [deps]
     * @param {Function} [deps.queryWithParams]
     * @param {number} [deps.ttlMs]
     * @param {number} [deps.maxEntries]
     */
    constructor(deps = {}) {
        this._queryWithParams = deps.queryWithParams || ((sql, params, ...rest) => db.queryWithParams(sql, params, ...rest));
        this._ttlMs = deps.ttlMs || DEFAULT_TTL_MS;
        this._maxEntries = deps.maxEntries || DEFAULT_MAX_ENTRIES;
        this._cache = new Map();
    }

    _cacheGet(cacheKey) {
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < this._ttlMs) return cached.data;
        return undefined;
    }

    _cacheSet(cacheKey, data) {
        this._cache.set(cacheKey, { data, ts: Date.now() });
        if (this._cache.size > this._maxEntries) {
            const oldest = this._cache.keys().next().value;
            this._cache.delete(oldest);
        }
    }

    /** Ventas B agregadas por vendedor y mes para un ejercicio. */
    async getByVendor(year, vendorCodes = []) {
        const safeYear = parseInt(year, 10);
        if (!safeYear) return {};

        const parsedCodes = parseSalesVendorCodes(vendorCodes);
        const codeVariants = [...new Set(parsedCodes.flatMap(getSalesVendorCodeVariants))];
        const scopeKey = codeVariants.length
            ? codeVariants.map(normalizeSalesVendorCode).sort().join(',')
            : 'ALL';
        const cacheKey = `byVendor:${safeYear}:${scopeKey}`;
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;

        const params = [safeYear];
        let vendorFilter = '';
        if (codeVariants.length > 0) {
            vendorFilter = `AND TRIM(CODIGOVENDEDOR) IN (${codeVariants.map(() => '?').join(',')})`;
            params.push(...codeVariants);
        }

        try {
            const rows = await this._queryWithParams(`
            SELECT TRIM(CODIGOVENDEDOR) as CODIGOVENDEDOR, MES, SUM(IMPORTE) as IMPORTE
            FROM JAVIER.VENTAS_B
            WHERE EJERCICIO = ?
              ${vendorFilter}
            GROUP BY TRIM(CODIGOVENDEDOR), MES
        `, params, false, false);

            const byVendor = {};
            rows.forEach(row => {
                const code = normalizeSalesVendorCode(row.CODIGOVENDEDOR);
                const month = parseInt(row.MES, 10);
                const amount = parseFloat(row.IMPORTE) || 0;
                if (!code || !month) return;
                if (!byVendor[code]) byVendor[code] = {};
                byVendor[code][month] = (byVendor[code][month] || 0) + amount;
            });
            this._cacheSet(cacheKey, byVendor);
            return byVendor;
        } catch (e) {
            // Tabla puede no existir para ejercicios antiguos: degradacion a vacio.
            return {};
        }
    }

    /** Ventas B mensuales de un unico vendedor (contrato legacy getBSales). */
    async getSingle(vendorCode, year) {
        if (!vendorCode || vendorCode === 'ALL') return {};
        const rawCode = String(vendorCode).trim();
        const cacheKey = `${rawCode}:${parseInt(year, 10)}`;
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;

        const byVendor = await this.getByVendor(year, [rawCode]);
        const monthlyMap = byVendor[normalizeSalesVendorCode(rawCode)] || {};
        this._cacheSet(cacheKey, monthlyMap);
        return monthlyMap;
    }
}

// Singleton por defecto para delegadores legacy en utils/common.
const bSalesRepository = new BSalesRepository();

module.exports = { BSalesRepository, bSalesRepository };
