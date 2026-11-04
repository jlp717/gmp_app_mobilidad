'use strict';

const VERIFIED_POLICY = Symbol('verified-hard-price-floor-policy');
const PRICE_SCALE = 10000n;
const PCT_100 = 10000n;
const NET_DENOMINATOR = PRICE_SCALE * PCT_100 * PCT_100;
const DECIMAL_11_4_MAX_UNITS = 99999999999n;
const NON_CANONICAL_LINE_FIELDS = Object.freeze([
  'codigoArticulo', 'CODIGOARTICULO',
  'unidadMedida', 'UNIDADMEDIDA',
  'precioVenta', 'PRECIOVENTA', 'precio',
  'descuentoLinea', 'DESCUENTO_LINEA', 'PORCENTAJEDESCUENTO',
]);

class HardPriceFloorError extends Error {
  constructor(code, message, status, details = {}) {
    super(message);
    this.name = 'HardPriceFloorError';
    this.code = code;
    this.status = status;
    this.details = Object.freeze({ ...details });
  }
}

function typedError(code, message, status, details) {
  return new HardPriceFloorError(code, message, status, details);
}

function scaledUnsigned(raw, scale, field, maxUnits) {
  if (raw === null || raw === undefined) {
    throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', `${field} es obligatorio.`, 422, { field });
  }
  if (!['string', 'number'].includes(typeof raw)
    || (typeof raw === 'number' && !Number.isFinite(raw))) {
    throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', `${field} no tiene un tipo válido.`, 422, { field });
  }
  const rawText = String(raw);
  if (maxUnits !== undefined) {
    const factor = 10n ** BigInt(scale);
    const maximumWholeDigits = String(maxUnits / factor).length;
    const maximumTextLength = maximumWholeDigits + (scale > 0 ? scale + 1 : 0);
    if (rawText.length > maximumTextLength) {
      throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', `${field} excede el máximo admitido.`, 422, { field });
    }
  }
  const text = rawText.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] || '').length > scale) {
    throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', `${field} no tiene un formato válido.`, 422, { field });
  }
  const factor = 10n ** BigInt(scale);
  const significantWhole = match[1].replace(/^0+/u, '') || '0';
  if (maxUnits !== undefined
    && significantWhole.length > String(maxUnits / factor).length) {
    throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', `${field} excede el máximo admitido.`, 422, { field });
  }
  const units = (BigInt(match[1]) * factor)
    + BigInt((match[2] || '').padEnd(scale, '0') || '0');
  if (maxUnits !== undefined && units > maxUnits) {
    throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', `${field} excede el máximo admitido.`, 422, { field });
  }
  return units;
}

function normalizedUnit(raw) {
  if (typeof raw !== 'string') {
    throw typedError('HARD_PRICE_FLOOR_UNIT_INVALID', 'La unidad de venta no es válida.', 422, {});
  }
  const unit = raw.trim().toUpperCase();
  if (!unit || unit.length > 10) {
    throw typedError('HARD_PRICE_FLOOR_UNIT_INVALID', 'La unidad de venta no es válida.', 422, {});
  }
  return unit;
}

function normalizedArticle(raw) {
  if (typeof raw !== 'string') {
    throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', 'El artículo no es válido.', 422, { field: 'articleCode' });
  }
  const article = raw.trim();
  if (!article || article.length > 10) {
    throw typedError('HARD_PRICE_FLOOR_INPUT_INVALID', 'El artículo no es válido.', 422, { field: 'articleCode' });
  }
  return article;
}

function formatScaled(units, scale) {
  const factor = 10n ** BigInt(scale);
  const whole = units / factor;
  const fraction = String(units % factor).padStart(scale, '0');
  return `${whole}.${fraction}`;
}

function formatRational(numerator, denominator, scale = 12) {
  const factor = 10n ** BigInt(scale);
  const scaled = (numerator * factor) / denominator;
  const whole = scaled / factor;
  const fraction = String(scaled % factor).padStart(scale, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}.0000`;
}

function createVerifiedHardFloorPolicy({
  articleCode,
  unit,
  minimumUnitPrice,
  sourceFingerprint,
  policyStatus,
  unitStatus,
} = {}) {
  const article = normalizedArticle(articleCode);
  const saleUnit = normalizedUnit(unit);
  const minimumUnits = scaledUnsigned(
    minimumUnitPrice,
    4,
    'minimumUnitPrice',
    DECIMAL_11_4_MAX_UNITS,
  );
  const fingerprint = typeof sourceFingerprint === 'string'
    ? sourceFingerprint.trim().toLowerCase()
    : '';
  const verifiedPolicyStatus = String(policyStatus ?? '').trim().toUpperCase();
  const verifiedUnitStatus = String(unitStatus ?? '').trim().toUpperCase();
  if (minimumUnits <= 0n || !/^[a-f0-9]{64}$/.test(fingerprint)
    || verifiedPolicyStatus !== 'VERIFICADA' || verifiedUnitStatus !== 'VERIFICADA') {
    throw typedError(
      'HARD_PRICE_FLOOR_POLICY_UNVERIFIED',
      'La política de precio del artículo todavía no está verificada.',
      409,
      { articleCode: article },
    );
  }
  return Object.freeze({
    [VERIFIED_POLICY]: true,
    articleCode: article,
    unit: saleUnit,
    minimumUnits,
    sourceFingerprint: fingerprint,
    policyStatus: verifiedPolicyStatus,
    unitStatus: verifiedUnitStatus,
  });
}

function requireVerifiedPolicy(policy, articleCode) {
  if (!policy || policy[VERIFIED_POLICY] !== true || !Object.isFrozen(policy)) {
    throw typedError(
      'HARD_PRICE_FLOOR_POLICY_UNAVAILABLE',
      'No hay una política de precio verificada para este artículo.',
      409,
      { articleCode },
    );
  }
  if (policy.articleCode !== articleCode) {
    throw typedError(
      'HARD_PRICE_FLOOR_POLICY_MISMATCH',
      'La política verificada no corresponde al artículo solicitado.',
      409,
      { articleCode },
    );
  }
  return policy;
}

function assertHardPriceFloor({ line, policy, headerDiscountPct = 0 } = {}) {
  const sourceLine = line && typeof line === 'object' ? line : {};
  const conflictingField = NON_CANONICAL_LINE_FIELDS.find((field) => (
    Object.prototype.hasOwnProperty.call(sourceLine, field)
  ));
  if (conflictingField) {
    throw typedError(
      'HARD_PRICE_FLOOR_INPUT_AMBIGUOUS',
      'La línea contiene campos de precio no canónicos.',
      422,
      { field: conflictingField },
    );
  }
  const articleCode = normalizedArticle(sourceLine.articleCode);
  const verified = requireVerifiedPolicy(policy, articleCode);
  const saleUnit = normalizedUnit(sourceLine.unit);
  if (saleUnit !== verified.unit) {
    throw typedError(
      'HARD_PRICE_FLOOR_UNIT_MISMATCH',
      'La unidad de venta no coincide con la política verificada. Revisa el pedido.',
      409,
      { articleCode, saleUnit, policyUnit: verified.unit },
    );
  }

  const priceUnits = scaledUnsigned(
    sourceLine.unitPrice,
    4,
    'unitPrice',
    DECIMAL_11_4_MAX_UNITS,
  );
  const lineDiscountUnits = scaledUnsigned(
    sourceLine.lineDiscountPct ?? 0,
    2,
    'lineDiscountPct',
    PCT_100,
  );
  const headerDiscountUnits = scaledUnsigned(
    headerDiscountPct,
    2,
    'headerDiscountPct',
    PCT_100,
  );

  const netNumerator = priceUnits
    * (PCT_100 - lineDiscountUnits)
    * (PCT_100 - headerDiscountUnits);
  const minimumNumerator = verified.minimumUnits * PCT_100 * PCT_100;
  const details = {
    articleCode,
    saleUnit,
    minimumUnitPrice: formatScaled(verified.minimumUnits, 4),
    netUnitPrice: formatRational(netNumerator, NET_DENOMINATOR),
  };
  if (netNumerator < minimumNumerator) {
    throw typedError(
      'HARD_PRICE_FLOOR_BREACH',
      'El precio neto queda por debajo del mínimo permitido. Revisa precio y descuentos.',
      409,
      details,
    );
  }
  return Object.freeze({ allowed: true, ...details });
}

module.exports = {
  HardPriceFloorError,
  createVerifiedHardFloorPolicy,
  assertHardPriceFloor,
};
