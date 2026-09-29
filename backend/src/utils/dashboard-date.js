'use strict';

const DASHBOARD_TIME_ZONE = 'Europe/Madrid';

const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function normalizeInstant(value) {
    const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(instant.getTime())) {
        throw new TypeError('DASHBOARD_INVALID_AS_OF');
    }
    return instant;
}

function getMadridDateParts(asOf = new Date()) {
    const instant = normalizeInstant(asOf);
    const values = Object.fromEntries(
        formatter.formatToParts(instant)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    );
    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    return {
        instant,
        year,
        month,
        day,
        dateKey: `${values.year}-${values.month}-${values.day}`,
    };
}

function madridDateLike(asOf = new Date()) {
    const parts = getMadridDateParts(asOf);
    return {
        getFullYear: () => parts.year,
        getMonth: () => parts.month - 1,
        getDate: () => parts.day,
    };
}

module.exports = {
    DASHBOARD_TIME_ZONE,
    getMadridDateParts,
    madridDateLike,
};
