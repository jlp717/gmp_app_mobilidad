'use strict';

const logger = require('../../middleware/logger');
const { getCurrentDate } = require('../../utils/common');

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/**
 * Caso de uso: obtener el rutero semanal (conteos por dia, total clientes y
 * progreso de entregas de hoy). Logica movida verbatim desde routes/planner.js.
 */
class RuteroSemanalService {
    /**
     * @param {object} deps
     * @param {import('../repositories/rutero.repository').RuteroRepository} deps.repository
     * @param {Function} deps.getWeekCountsFromCache  cache laclae (services/laclae)
     * @param {Function} deps.getTotalClientsFromCache
     */
    constructor({ repository, getWeekCountsFromCache, getTotalClientsFromCache }) {
        this._repo = repository;
        this._getWeekCountsFromCache = getWeekCountsFromCache;
        this._getTotalClientsFromCache = getTotalClientsFromCache;
    }

    static cleanVendorCodes(vendedorCodes, { sentinelFiltered = false } = {}) {
        if (!vendedorCodes) return [];
        if (!sentinelFiltered) {
            return vendedorCodes.split(',').map(c => c.trim()).filter(c => c);
        }
        const UNK_SENTINEL = new Set(['UNK', 'NONE', 'NULL', 'N/A', '0', '', 'undefined', 'null']);
        return vendedorCodes.split(',').map(c => c.trim()).filter(c => !UNK_SENTINEL.has(c.toUpperCase()));
    }

    async _computeTodayProgress(todayName, todayClients, vendedorCodes) {
        const weekProgress = {};
        try {
            if (todayClients > 0) {
                const cleanCodes = RuteroSemanalService.cleanVendorCodes(vendedorCodes, { sentinelFiltered: true });
                let deliveredToday = 0;
                if (cleanCodes.length > 0) {
                    // Enfoque hibrido: ERP (primario) + estado app (suplemento).
                    const now = new Date();
                    // perf: parallelized independent IO (pool-per-call).
                    const [erpDelivered, appDelivered] = await Promise.all([
                        this._repo.fetchErpDeliveredCount(cleanCodes, {
                            dia: now.getDate(),
                            mes: now.getMonth() + 1,
                            ano: now.getFullYear(),
                        }).catch((erpErr) => {
                            logger.warn(`[RUTERO WEEK] ERP delivery count error: ${erpErr.message}`);
                            return 0;
                        }),
                        this._repo.fetchAppDeliveredCount(cleanCodes).catch(() => 0),
                    ]);
                    // El mayor de los dos evita doble conteo.
                    deliveredToday = Math.max(erpDelivered, appDelivered);
                }
                weekProgress[todayName] = {
                    total: todayClients,
                    delivered: deliveredToday,
                    percentage: Math.round((deliveredToday / todayClients) * 100)
                };
            }
        } catch (progressErr) {
            logger.warn(`[RUTERO WEEK] Progress calc error: ${progressErr.message}`);
        }
        return weekProgress;
    }

    _fallbackPayload(fallbackCounts, todayName, currentRole, fallbackTotal) {
        return {
            week: fallbackCounts,
            todayName,
            role: currentRole,
            totalUniqueClients: fallbackTotal,
            cacheStatus: 'loading'
        };
    }

    /**
     * @param {object} p
     * @param {string} p.vendedorCodes crudo de querystring
     * @param {string} [p.role]
     * @param {boolean} [p.ignoreOverridesBool]
     * @param {Date} [p.now] fecha actual (inyectable en tests)
     * @returns {Promise<Object>} payload exacto que responde el endpoint
     */
    async obtenerRuteroSemanal({ vendedorCodes, role, ignoreOverridesBool = false, now = getCurrentDate() }) {
        const todayName = DAY_NAMES[now.getDay()];
        const currentRole = role || 'comercial';

        const cachedCounts = this._getWeekCountsFromCache(vendedorCodes, currentRole, ignoreOverridesBool);

        if (cachedCounts) {
            const totalClients = this._getTotalClientsFromCache(vendedorCodes, currentRole);
            const todayClients = cachedCounts[todayName] || 0;
            const weekProgress = await this._computeTodayProgress(todayName, todayClients, vendedorCodes);
            logger.info(`[RUTERO WEEK] From cache: ${JSON.stringify(cachedCounts)}, total: ${totalClients}, progress: ${JSON.stringify(weekProgress)}`);
            return {
                variant: 'cache',
                payload: {
                    week: cachedCounts,
                    todayName,
                    role: currentRole,
                    totalUniqueClients: totalClients,
                    weekProgress
                }
            };
        }

        // Fallback: cache no lista, query directa basica.
        logger.warn(`[RUTERO WEEK] Cache not ready, querying DB for basic counts`);
        try {
            const cleanCodes = RuteroSemanalService.cleanVendorCodes(vendedorCodes);
            const fallbackCounts = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 };
            let fallbackTotal = 0;

            const fbRows = await this._repo.fetchWeeklyVisitCounts(cleanCodes);
            if (fbRows.length > 0) {
                const r = fbRows[0];
                fallbackCounts.lunes = parseInt(r.LUNES) || 0;
                fallbackCounts.martes = parseInt(r.MARTES) || 0;
                fallbackCounts.miercoles = parseInt(r.MIERCOLES) || 0;
                fallbackCounts.jueves = parseInt(r.JUEVES) || 0;
                fallbackCounts.viernes = parseInt(r.VIERNES) || 0;
                fallbackCounts.sabado = parseInt(r.SABADO) || 0;
                fallbackCounts.domingo = parseInt(r.DOMINGO) || 0;
                fallbackTotal = Object.values(fallbackCounts).reduce((a, b) => a + b, 0);
            }

            return { variant: 'fallback', payload: this._fallbackPayload(fallbackCounts, todayName, currentRole, fallbackTotal) };
        } catch (fbErr) {
            logger.error(`[RUTERO WEEK] Fallback query also failed: ${fbErr.message}`);
            return {
                variant: 'error',
                payload: {
                    week: { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 },
                    todayName,
                    role: currentRole,
                    totalUniqueClients: 0,
                    cacheStatus: 'error'
                }
            };
        }
    }
}

module.exports = { RuteroSemanalService, DAY_NAMES };
