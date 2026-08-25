'use strict';

/**
 * Coerciones de querystring para dashboard/planner.
 * Replican EXACTAMENTE la tolerancia previa (parseInt con fallback), no anaden
 * rechazos: cambiar esto cambiaria el comportamiento observable.
 */

function coerceIntOr(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** metrics: year/month aceptan cualquier cosa y caen al periodo actual. */
function parsePeriodQuery(query, now) {
    return {
        year: coerceIntOr(query.year, now.getFullYear()),
        month: coerceIntOr(query.month, now.getMonth() + 1),
    };
}

/** sales-evolution: lista de years "2024,2023" o por defecto 3 ejercicios. */
function parseYearsParam(yearsRaw, now) {
    return yearsRaw
        ? yearsRaw.split(',').map(y => parseInt(y.trim()))
        : [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
}

/** sales-evolution: granularity/upToToday/months con defaults legacy. */
function parseEvolutionQuery(query) {
    return {
        granularity: query.granularity || 'month',
        upToToday: query.upToToday || 'false',
        months: query.months || 36,
    };
}

/** rutero/week: flags tal cual llegan (comparacion estricta === 'true'). */
function parseRuteroWeekQuery(query) {
    return {
        vendedorCodes: query.vendedorCodes,
        role: query.role,
        ignoreOverridesBool: query.ignoreOverrides === 'true',
    };
}

module.exports = {
    coerceIntOr,
    parsePeriodQuery,
    parseYearsParam,
    parseEvolutionQuery,
    parseRuteroWeekQuery,
};
