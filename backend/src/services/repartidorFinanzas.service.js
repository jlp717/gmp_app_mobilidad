'use strict';

/**
 * Casos de uso del perfil financiero del repartidor (Liquidacion Diaria,
 * Vencimientos, Comisiones). Delegan en el servicio canonico
 * services/repartidor-finance-service.js, que ya concentra la logica y los
 * repositories DB2. La inyeccion por constructor permite tests con mocks.
 */
class RepartidorFinanzasService {
    /**
     * @param {object} [deps]
     * @param {object} [deps.financeService] implementacion canonica o mock
     */
    constructor(deps = {}) {
        // Lazy por defecto: el servicio canonico valida runtime de reparto al
        // cargarse; los tests con DI nunca lo requieren.
        this._injected = deps.financeService || null;
    }

    _finance() {
        return this._injected || require('../../services/repartidor-finance-service');
    }

    /** GET /daily-summary/:repartidorId â€” Liquidacion Diaria. */
    getDailySummary({ repartidorId, date }) {
        return this._finance().getDailySummary({ repartidorId, date });
    }

    /** GET /vencimientos/:repartidorId â€” listado paginado por cursor. */
    getVencimientos({ repartidorId, from, to, limit, cursor, clientCode, search, estado, tipoDocumento }) {
        return this._finance().getVencimientos({ repartidorId, from, to, limit, cursor, clientCode, search, estado, tipoDocumento });
    }

    /** GET /commissions/summary/:repartidorId â€” resumen de comisiones. */
    getCommissionSummary({ repartidorId, from, to }) {
        return this._finance().getCommissionSummary({ repartidorId, from, to });
    }
}

module.exports = { RepartidorFinanzasService };
