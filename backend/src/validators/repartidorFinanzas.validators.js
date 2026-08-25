'use strict';

/**
 * Validadores de entrada para los endpoints de finanzas del repartidor.
 * Esquemas zod relocados verbatim desde routes/repartidor-finanzas.js:
 * mismas reglas, mismos mensajes => misma respuesta 400.
 * El route file importa desde aqui para que no existan dos fuentes de verdad.
 */
const { z } = require('zod');

const singleCodeSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/);
const numericCodeSchema = z.string().trim().min(1).max(20).regex(/^\d+$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((raw) => {
    const date = new Date(`${raw}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}, 'Fecha invalida');

const codeListSchema = z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_,-]+$/);

const listParamsSchema = z.object({
    repartidorId: codeListSchema,
});

const dailySummaryQuerySchema = z.object({
    date: dateSchema.default(() => new Date().toISOString().slice(0, 10)),
});

// Compat: APK 4.1.2+52 envia solo limit (a veces 200) sin from/to.
// Defaults = ventana ±180 dias; limit se clampea a 100.
const vencimientosDefaultFromIso = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 180);
    return d.toISOString().slice(0, 10);
};
const vencimientosDefaultToIso = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 180);
    return d.toISOString().slice(0, 10);
};
const vencimientosQuerySchema = z.object({
    from: dateSchema.default(vencimientosDefaultFromIso),
    to: dateSchema.default(vencimientosDefaultToIso),
    limit: z.preprocess(
        (raw) => {
            const n = Number(raw);
            if (!Number.isFinite(n)) return 50;
            return Math.min(100, Math.max(1, Math.trunc(n)));
        },
        z.number().int().min(1).max(100),
    ).default(50),
    cursor: z.string().trim().min(1).max(512).optional(),
    clientCode: z.string().trim().max(20).optional(),
    search: z.string().trim().max(80).optional(),
    estado: z.enum(['pendiente', 'vencido']).optional(),
}).refine((query) => query.from <= query.to, {
    path: ['to'],
    message: 'El final del rango debe ser igual o posterior al inicio',
});

const firstDayCurrentMonthIso = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const rangeQuerySchema = z.object({
    from: dateSchema.default(firstDayCurrentMonthIso),
    to: dateSchema.default(todayIso),
}).refine((query) => query.from <= query.to, {
    path: ['to'],
    message: 'El final del rango debe ser igual o posterior al inicio',
});

class UnsupportedRepartidorSelectorError extends Error {
    constructor() {
        super('Usa codigos de repartidor explicitos; el selector ALL no esta soportado');
        this.name = 'UnsupportedRepartidorSelectorError';
        this.code = 'UNSUPPORTED_REPARTIDOR_SELECTOR';
        this.statusCode = 422;
    }
}

function assertExplicitRepartidorSelector(repartidorId) {
    const codes = String(repartidorId || '').split(',').map((code) => code.trim().toUpperCase());
    if (codes.includes('ALL')) throw new UnsupportedRepartidorSelectorError();
}

module.exports = {
    singleCodeSchema,
    numericCodeSchema,
    dateSchema,
    codeListSchema,
    listParamsSchema,
    dailySummaryQuerySchema,
    vencimientosQuerySchema,
    rangeQuerySchema,
    UnsupportedRepartidorSelectorError,
    assertExplicitRepartidorSelector,
};
