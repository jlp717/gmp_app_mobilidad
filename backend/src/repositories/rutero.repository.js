'use strict';

const { db } = require('../config');
const { resolveRepartoRuntime } = require('../../config/reparto-runtime');

/**
 * Acceso DB2 para /rutero/week. Solo lectura: DSEDAC (ERP) y JAVIER.DELIVERY_STATUS.
 */
class RuteroRepository {
    constructor(deps = {}) {
        this._queryWithParams = deps.queryWithParams || ((sql, params, ...rest) => db.queryWithParams(sql, params, ...rest));
    }

    /**
     * Entregas conformadas hoy segun ERP (OPP+CPC).
     * @returns {Promise<number>}
     */
    async fetchErpDeliveredCount(cleanCodes, { dia, mes, ano }) {
        const erpPlaceholders = cleanCodes.map(() => '?').join(',');
        const erpSql = `
            SELECT COUNT(DISTINCT CPC.NUMEROALBARAN) as DELIVERED
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${erpPlaceholders})
              AND OPP.DIAREPARTO = ?
              AND OPP.MESREPARTO = ?
              AND OPP.ANOREPARTO = ?
              AND (TRIM(CPC.CONFORMADOSN) = 'S' OR CPC.SITUACIONALBARAN IN ('F', 'R'))
        `;
        const rows = await this._queryWithParams(erpSql, [...cleanCodes, dia, mes, ano], false, false);
        return parseInt(rows[0]?.DELIVERED) || 0;
    }

    /**
     * Entregas confirmadas desde la app (DELIVERY_STATUS), esquema nuevo o legacy.
     * @returns {Promise<number>} 0 si la tabla no existe.
     */
    async fetchAppDeliveredCount(cleanCodes) {
        const { isDeliveryStatusNewSchema } = require('../../utils/delivery-status-check');
        const dsNew = isDeliveryStatusNewSchema();
        const { getDeliveryStatusTable } = require('../../utils/delivery-status-check');
        const runtime = resolveRepartoRuntime(process.env);
        const deliveryStatusTable = runtime?.valid
            ? runtime.tables?.notifications?.deliveryStatus
            : getDeliveryStatusTable();
        if (!/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/.test(String(deliveryStatusTable || ''))) {
            return 0;
        }
        const appPlaceholders = cleanCodes.map(() => '?').join(',');
        const countCol = dsNew ? 'COUNT(DISTINCT DS.IDEMPOTENCY_TOKEN)' : 'COUNT(DISTINCT DS.ID)';
        const repCol = dsNew ? 'DS.OPERADOR' : 'DS.REPARTIDOR_ID';
        const dateCol = dsNew ? 'DS.UPDATED_AT' : 'DS.FECHAACTUALIZACION';
        const appSql = `
            SELECT ${countCol} as DELIVERED
            FROM ${deliveryStatusTable} DS
            WHERE DS.STATUS = 'ENTREGADO'
              AND ${repCol} IN (${appPlaceholders})
              AND DATE(${dateCol}) = CURRENT DATE
        `;
        const rows = await this._queryWithParams(appSql, cleanCodes, false, false);
        return parseInt(rows[0]?.DELIVERED) || 0;
    }

    /**
     * Fallback: conteos semanales CDVI cuando la cache no esta lista.
     * @returns {Promise<Array<Object>>} filas con LUNES..DOMINGO
     */
    async fetchWeeklyVisitCounts(cleanCodes) {
        const baseSql = `
            SELECT 
                SUM(CASE WHEN DIAVISITALUNESSN = 'S' THEN 1 ELSE 0 END) as LUNES,
                SUM(CASE WHEN DIAVISITAMARTESSN = 'S' THEN 1 ELSE 0 END) as MARTES,
                SUM(CASE WHEN DIAVISITAMIERCOLESSN = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
                SUM(CASE WHEN DIAVISITAJUEVESSN = 'S' THEN 1 ELSE 0 END) as JUEVES,
                SUM(CASE WHEN DIAVISITAVIERNESSN = 'S' THEN 1 ELSE 0 END) as VIERNES,
                SUM(CASE WHEN DIAVISITASABADOSN = 'S' THEN 1 ELSE 0 END) as SABADO,
                SUM(CASE WHEN DIAVISITADOMINGOSN = 'S' THEN 1 ELSE 0 END) as DOMINGO
            FROM DSEDAC.CDVI
            WHERE 1=1
        `;
        if (cleanCodes.length > 0) {
            const placeholders = cleanCodes.map(() => '?').join(',');
            const fullSql = baseSql.replace('WHERE 1=1', `WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})`);
            return this._queryWithParams(fullSql, cleanCodes, false, false);
        }
        return [];
    }
}

module.exports = { RuteroRepository };
