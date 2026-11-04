'use strict';

const crypto = require('crypto');
const { getAppliedAppProfile } = require('../../config/app-profile');
const { comercialErpLiveTable } = require('../../utils/comercial-erp-tables');
const { createVerifiedHardFloorPolicy, assertHardPriceFloor } = require('./hard-price-floor');

const QUANTITY_SCALE = 1000000n;
const PRICE_SCALE = 10000n;
const PERCENT_SCALE = 10000n;
const MONEY_SCALE = 100n;
const SUPPORTED_UNITS = new Map([
    ['CAJA', 'CAJAS'], ['CAJAS', 'CAJAS'], ['ENVASE', 'CAJAS'], ['ENVASES', 'CAJAS'],
    ['UNIDAD', 'UNIDADES'], ['UNIDADES', 'UNIDADES'],
    ['KILO', 'KILO'], ['KILOS', 'KILO'], ['KILOGRAMO', 'KILO'], ['KILOGRAMOS', 'KILO'],
]);

class ErpTariffFloorError extends Error {
    constructor(code, message, status, details = {}) {
        super(message);
        this.name = 'ErpTariffFloorError';
        this.code = code;
        this.status = status;
        this.details = Object.freeze({ ...details });
    }
}

function floorError(code, message, status, details) {
    return new ErpTariffFloorError(code, message, status, details);
}

function clean(raw) { return String(raw ?? '').trim(); }
function canonicalUnit(raw) { return SUPPORTED_UNITS.get(clean(raw).toUpperCase()) || null; }
function articleCodeFromLine(line) {
    return clean(line?.CODIGOARTICULO ?? line?.articleCode ?? line?.codigoArticulo).substring(0, 10);
}

function decimalUnits(raw, scale, field, articleCode) {
    const text = ['string', 'number'].includes(typeof raw) ? String(raw).trim() : '';
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match || (match[2] || '').length > scale) {
        throw floorError(
            'HARD_PRICE_FLOOR_STORED_LINE_INVALID',
            'La línea guardada no contiene importes válidos. Revisa el pedido.',
            409,
            { articleCode, field },
        );
    }
    const factor = 10n ** BigInt(scale);
    return (BigInt(match[1]) * factor) + BigInt((match[2] || '').padEnd(scale, '0') || '0');
}

function storedLineDiscount(line, articleCode) {
    const erpDiscount = Number.parseFloat(line?.PORCENTAJEDESCUENTO);
    const raw = Number.isFinite(erpDiscount) && erpDiscount > 0
        ? line.PORCENTAJEDESCUENTO
        : (line?.DESCUENTO_LINEA ?? 0);
    const units = decimalUnits(raw, 2, 'lineDiscountPct', articleCode);
    if (units > PERCENT_SCALE) {
        throw floorError(
            'HARD_PRICE_FLOOR_STORED_LINE_INVALID',
            'La línea guardada contiene un descuento no válido. Revisa el pedido.',
            409,
            { articleCode, field: 'lineDiscountPct' },
        );
    }
    return { raw, units };
}

function billingQuantity(line, unit, articleCode) {
    const envases = decimalUnits(line?.CANTIDADENVASES ?? 0, 6, 'cantidadEnvases', articleCode);
    const unidades = decimalUnits(line?.CANTIDADUNIDADES ?? 0, 6, 'cantidadUnidades', articleCode);
    if (unit !== 'CAJAS') return { numerator: unidades, denominator: QUANTITY_SCALE };
    const unidadesCaja = decimalUnits(line?.UNIDADESCAJA ?? 0, 6, 'unidadesCaja', articleCode);
    if (unidadesCaja <= 0n) return { numerator: envases, denominator: QUANTITY_SCALE };
    const hasLooseUnits = envases > 0n && unidades > 0n
        && (unidades * QUANTITY_SCALE) < (envases * unidadesCaja);
    return hasLooseUnits
        ? {
            numerator: (envases * unidadesCaja) + (unidades * QUANTITY_SCALE),
            denominator: QUANTITY_SCALE * unidadesCaja,
        }
        : { numerator: envases, denominator: QUANTITY_SCALE };
}

function assertStoredBillingConsistency(line, unit, articleCode, lineDiscount) {
    const quantity = billingQuantity(line, unit, articleCode);
    const isNoCharge = clean(line?.CLASELINEA).toUpperCase() === 'SC';
    const price = isNoCharge
        ? 0n
        : decimalUnits(line?.PRECIOVENTA ?? 0, 4, 'unitPrice', articleCode);
    const storedCents = decimalUnits(line?.IMPORTEVENTA ?? 0, 2, 'importeVenta', articleCode);
    // Canonical writer rounds gross to cents first (calculateLineImporte), then
    // rounds the line discount again (applyPctToAmount). Keep that exact order.
    const grossNumerator = quantity.numerator * price;
    const grossDenominator = quantity.denominator * PRICE_SCALE;
    const grossCents = ((grossNumerator * MONEY_SCALE) + (grossDenominator / 2n)) / grossDenominator;
    const discountedNumerator = grossCents * (PERCENT_SCALE - lineDiscount.units);
    const expectedCents = (discountedNumerator + (PERCENT_SCALE / 2n)) / PERCENT_SCALE;
    if (expectedCents !== storedCents) {
        throw floorError(
            'HARD_PRICE_FLOOR_BILLING_MISMATCH',
            'El importe guardado no coincide con cantidad, unidad, precio y descuento. Revisa la línea.',
            409,
            { articleCode, saleUnit: unit },
        );
    }
}

function pilotActivation(profile, requireVerifiedProfile = false) {
    const name = clean(profile?.profile).toLowerCase();
    if (name === 'production') return { active: false };
    if (name === 'unverified' || !name) {
        if (!requireVerifiedProfile) return { active: false };
        throw floorError(
            'HARD_PRICE_FLOOR_PROFILE_UNAVAILABLE',
            'No se puede comprobar el mínimo de precio con el perfil activo. El pedido sigue en borrador.',
            503,
            {},
        );
    }
    const active = profile?.verified === true && ['test', 'demo'].includes(name)
        && clean(profile.readSchema).toUpperCase() === 'DSEDAC'
        && clean(profile.writeSchema).toUpperCase() === 'JAVIER'
        && clean(profile.tableSet).toLowerCase() === 'isolated_test'
        && profile.writesEnabled === true && profile.productionWritesEnabled === false
        && profile.erpExportEnabled === false;
    if (!active) {
        throw floorError(
            'HARD_PRICE_FLOOR_PROFILE_UNAVAILABLE',
            'No se puede comprobar el mínimo de precio con el perfil activo. El pedido sigue en borrador.',
            503,
            {},
        );
    }
    return { active: true };
}

function readAuthoritySql(codes, artTable, araTable) {
    const placeholders = codes.map(() => '?').join(', ');
    return `
        WITH T2_VARIANTS AS (
            SELECT TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
                   DECIMAL(PRECIOTARIFA, 11, 4) AS PRECIOTARIFA
              FROM ${araTable}
             WHERE CODIGOTARIFA = ?
               AND PRECIOTARIFA > 0
               AND TRIM(CODIGOARTICULO) IN (${placeholders})
             GROUP BY TRIM(CODIGOARTICULO), DECIMAL(PRECIOTARIFA, 11, 4)
        ), T2 AS (
            SELECT CODIGOARTICULO,
                   MIN(PRECIOTARIFA) AS TARIFA2_MIN,
                   MAX(PRECIOTARIFA) AS TARIFA2_MAX,
                   COUNT(*) AS TARIFA2_VARIANTS
              FROM T2_VARIANTS
             GROUP BY CODIGOARTICULO
        )
        SELECT TRIM(A.CODIGOARTICULO) AS CODIGOARTICULO,
               TRIM(A.UNIDADMEDIDA) AS UNIDADMEDIDA,
               T2.TARIFA2_MIN,
               T2.TARIFA2_MAX,
               COALESCE(T2.TARIFA2_VARIANTS, 0) AS TARIFA2_VARIANTS
          FROM ${artTable} A
          LEFT JOIN T2 ON T2.CODIGOARTICULO = TRIM(A.CODIGOARTICULO)
         WHERE TRIM(A.CODIGOARTICULO) IN (${placeholders})`;
}

function fingerprint(articleCode, unit, minimumUnitPrice) {
    return crypto.createHash('sha256')
        .update(JSON.stringify({ source: 'DSEDAC.ARA:2', articleCode, unit, minimumUnitPrice }))
        .digest('hex');
}

function createErpTariffFloorPilot({
    profileProvider = getAppliedAppProfile,
    artTable = comercialErpLiveTable('ART'),
    araTable = comercialErpLiveTable('ARA'),
} = {}) {
    async function assertOrderFloor({
        queryFn,
        lines = [],
        headerDiscountPct = 0,
        requireVerifiedProfile = false,
    } = {}) {
        const activation = pilotActivation(profileProvider(), requireVerifiedProfile);
        if (!activation.active) return { active: false, covered: 0, skipped: [] };
        if (typeof queryFn !== 'function') {
            throw floorError(
                'HARD_PRICE_FLOOR_AUTHORITY_UNAVAILABLE',
                'No se pudo comprobar el mínimo de precio. El pedido sigue en borrador.',
                503,
                {},
            );
        }
        const normalizedLines = Array.isArray(lines) ? lines : [];
        const codes = [...new Set(normalizedLines.map(articleCodeFromLine).filter(Boolean))];
        if (codes.length === 0) return { active: true, covered: 0, skipped: [] };

        let rows;
        try {
            rows = await queryFn(readAuthoritySql(codes, artTable, araTable), ['2', ...codes, ...codes]);
        } catch (cause) {
            const error = floorError(
                'HARD_PRICE_FLOOR_AUTHORITY_UNAVAILABLE',
                'No se pudo comprobar el mínimo de precio. El pedido sigue en borrador.',
                503,
                {},
            );
            error.cause = cause;
            throw error;
        }
        const byCode = new Map();
        for (const row of rows || []) {
            const code = clean(row.CODIGOARTICULO ?? row.codigoArticulo);
            const previous = byCode.get(code);
            if (previous && (
                clean(previous.UNIDADMEDIDA) !== clean(row.UNIDADMEDIDA)
                || String(previous.TARIFA2_MIN) !== String(row.TARIFA2_MIN)
                || String(previous.TARIFA2_MAX) !== String(row.TARIFA2_MAX)
            )) {
                throw floorError(
                    'HARD_PRICE_FLOOR_AUTHORITY_CONFLICT',
                    'La autoridad ERP del artículo es contradictoria. El pedido sigue en borrador.',
                    503,
                    { articleCode: code },
                );
            }
            byCode.set(code, row);
        }
        const skipped = [];
        let covered = 0;
        for (const line of normalizedLines) {
            const articleCode = articleCodeFromLine(line);
            const authority = byCode.get(articleCode);
            if (!authority) {
                throw floorError(
                    'HARD_PRICE_FLOOR_AUTHORITY_UNAVAILABLE',
                    'No se encontró la autoridad de precio y unidad del artículo. El pedido sigue en borrador.',
                    503,
                    { articleCode },
                );
            }
            const authorityUnit = canonicalUnit(authority.UNIDADMEDIDA ?? authority.unidadMedida);
            if (!authorityUnit) {
                throw floorError(
                    'HARD_PRICE_FLOOR_UNCOVERED_ARTICLE',
                    'El artículo no tiene una unidad maestra compatible con la política piloto. Revisa la línea.',
                    409,
                    { articleCode, reason: 'UNSUPPORTED_MASTER_UNIT' },
                );
            }
            const variants = Number.parseInt(authority.TARIFA2_VARIANTS ?? authority.tarifa2Variants, 10) || 0;
            const minimum = authority.TARIFA2_MIN ?? authority.tarifa2Min;
            const maximum = authority.TARIFA2_MAX ?? authority.tarifa2Max;
            if (variants === 0 || minimum === null || minimum === undefined) {
                throw floorError(
                    'HARD_PRICE_FLOOR_UNCOVERED_ARTICLE',
                    'El artículo no tiene una tarifa 2 única y positiva para aplicar la política piloto. Revisa la línea.',
                    409,
                    { articleCode, reason: 'TARIFF_2_MISSING' },
                );
            }
            const minimumText = Number(minimum).toFixed(4);
            const maximumText = Number(maximum).toFixed(4);
            if (variants !== 1 || minimumText !== maximumText) {
                throw floorError(
                    'HARD_PRICE_FLOOR_AUTHORITY_CONFLICT',
                    'Hay varias tarifas mínimas vigentes para el artículo. El pedido sigue en borrador.',
                    503,
                    { articleCode },
                );
            }
            const lineUnit = canonicalUnit(line?.UNIDADMEDIDA ?? line?.unit);
            if (lineUnit !== authorityUnit) {
                throw floorError(
                    'HARD_PRICE_FLOOR_UNIT_MISMATCH',
                    'La unidad del pedido no coincide con la unidad maestra. Revisa la línea.',
                    409,
                    { articleCode, saleUnit: lineUnit || 'UNSUPPORTED', policyUnit: authorityUnit },
                );
            }
            const lineDiscount = storedLineDiscount(line, articleCode);
            assertStoredBillingConsistency(line, authorityUnit, articleCode, lineDiscount);
            const policy = createVerifiedHardFloorPolicy({
                articleCode,
                unit: authorityUnit,
                minimumUnitPrice: minimumText,
                sourceFingerprint: fingerprint(articleCode, authorityUnit, minimumText),
                policyStatus: 'VERIFICADA',
                unitStatus: 'VERIFICADA',
            });
            assertHardPriceFloor({
                line: {
                    articleCode,
                    unit: authorityUnit,
                    unitPrice: clean(line?.CLASELINEA).toUpperCase() === 'SC'
                        ? 0
                        : (line?.PRECIOVENTA ?? line?.unitPrice ?? 0),
                    lineDiscountPct: lineDiscount.raw,
                },
                policy,
                headerDiscountPct,
            });
            covered += 1;
        }
        return { active: true, covered, skipped };
    }

    return Object.freeze({ assertOrderFloor });
}

const defaultPilot = createErpTariffFloorPilot();

module.exports = {
    ErpTariffFloorError,
    createErpTariffFloorPilot,
    assertErpTariffFloorForOrder: defaultPilot.assertOrderFloor,
    _private: { canonicalUnit, pilotActivation, readAuthoritySql },
};
