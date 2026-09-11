'use strict';

function clampDiscountPct(value) {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(100, Math.round(n * 100) / 100);
}

function parseLineDiscountPct(line = {}) {
    return clampDiscountPct(
        line.descuentoLinea
        ?? line.lineDiscountPct
        ?? line.DESCUENTO_LINEA
        ?? line.PORCENTAJEDESCUENTO
        ?? 0,
    );
}

function parseGlobalDiscountPct(payload = {}) {
    return clampDiscountPct(
        payload.descuentoGlobal
        ?? payload.globalDiscountPct
        ?? payload.DESCUENTO_GLOBAL
        ?? payload.PORCENTAJEDESCUENTO1
        ?? 0,
    );
}

function applyPctToAmount(amount, pct) {
    const base = Number(amount) || 0;
    const discount = clampDiscountPct(pct);
    if (discount <= 0) return Math.round(base * 100) / 100;
    return Math.round(base * (1 - discount / 100) * 100) / 100;
}

function isCobroPropio(options = {}, header = {}) {
    const raw = options.cobroPropio
        ?? options.cobroEnMano
        ?? options.cobroPropioComercial
        ?? header.COBRO_PROPIO_SN;
    if (raw === true || raw === 1) return true;
    const token = String(raw ?? '').trim().toUpperCase();
    return token === 'S' || token === 'TRUE' || token === '1' || token === 'SI';
}

module.exports = {
    clampDiscountPct,
    parseLineDiscountPct,
    parseGlobalDiscountPct,
    applyPctToAmount,
    isCobroPropio,
};
