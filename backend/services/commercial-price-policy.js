'use strict';

// Domain arithmetic stays independent of HTTP, DB2 and runtime environment.
const crypto = require('crypto');
const { createVerifiedHardFloorPolicy, assertHardPriceFloor } = require('./pedidos/hard-price-floor');
const PRICE_MAX = 99999999999n;
const PERCENT_SCALE = 1000000n;
const VERIFIED_POLICIES = new WeakMap();
const UNITS = new Map([
  ['CAJA', 'CAJAS'], ['CAJAS', 'CAJAS'], ['ENVASE', 'CAJAS'], ['ENVASES', 'CAJAS'],
  ['KILO', 'KILO'], ['KILOS', 'KILO'], ['KILOGRAMO', 'KILO'], ['KILOGRAMOS', 'KILO'],
  ['UNIDAD', 'UNIDADES'], ['UNIDADES', 'UNIDADES'],
]);

class CommercialPricePolicyError extends Error {
  constructor(code, message, status = 422, details = {}) {
    super(message);
    this.name = 'CommercialPricePolicyError';
    this.code = code;
    this.status = status;
    this.details = Object.freeze({ ...details });
  }
}
function fail(code, message, status, details) { throw new CommercialPricePolicyError(code, message, status, details); }
function clean(value) { return String(value ?? '').trim(); }
function unit(value) { return typeof value === 'string' ? UNITS.get(value.trim().toUpperCase()) || null : null; }
function invalid(field) { fail('COMMERCIAL_PRICE_POLICY_INVALID', `Valor inválido: ${field}.`, 422, { field }); }
function decimal(raw, scale = 4, field = 'price', { required = false, max = PRICE_MAX } = {}) {
  if (raw === null || raw === undefined) {
    if (required) invalid(field);
    return null;
  }
  if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'number' && !Number.isFinite(raw))) invalid(field);
  const text = String(raw);
  // Bound before regex and BigInt: arbitrarily large request strings never enter arithmetic.
  if (text.length > String(max / (10n ** BigInt(scale))).length + scale + 1) invalid(field);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] || '').length > scale) invalid(field);
  const value = BigInt(match[1]) * (10n ** BigInt(scale)) + BigInt((match[2] || '').padEnd(scale, '0') || '0');
  if (value > max) invalid(field);
  return value;
}
function print(value, scale = 4) {
  const factor = 10n ** BigInt(scale);
  return `${value / factor}.${String(value % factor).padStart(scale, '0')}`;
}
function optionalDecimal(value, field) { const parsed = decimal(value, 4, field); return parsed === null ? null : print(parsed); }
function article(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,10}$/.test(value)) invalid('articleCode');
  return value;
}

function resolveCommercialPricePolicy(row = {}) {
  const articleCode = article(row.articleCode);
  const saleUnit = unit(row.saleUnit);
  if (!saleUnit) invalid('saleUnit');
  const policyUnit = unit(row.policyUnit);
  const masterUnit = unit(row.erpUnit);
  const state = clean(row.unitState).toUpperCase() || 'NO_VERIFICADA';
  const minimum = decimal(row.minimumPrice, 4, 'minimumPrice');
  const cost = decimal(row.manufacturingCost, 4, 'manufacturingCost');
  const margin = decimal(row.targetMarginPct, 4, 'targetMarginPct', { max: PERCENT_SCALE - 1n });
  if ((cost === null) !== (margin === null)) invalid('manufacturingCost/targetMarginPct');
  const hasOwned = minimum !== null || cost !== null;
  if (state === 'CONFLICTIVA' || (masterUnit && masterUnit !== saleUnit)
      || (policyUnit && policyUnit !== saleUnit) || (masterUnit && policyUnit && masterUnit !== policyUnit)) {
    fail('COMMERCIAL_PRICE_POLICY_UOM_MISMATCH', 'La unidad ha cambiado. Revisa y confirma la política.', 409, { articleCode, saleUnit, policyUnit });
  }
  if ((hasOwned && (state !== 'VERIFICADA' || !policyUnit))
      || (!masterUnit && (state !== 'VERIFICADA' || !policyUnit))) {
    fail('COMMERCIAL_PRICE_POLICY_UOM_UNVERIFIED', 'La unidad de precio necesita confirmación del responsable.', 409, { articleCode });
  }
  const tariffApplies = clean(row.tariffState).toUpperCase() === 'PRESENTE'
    && String(row.tariffCode).trim() === '2';
  const base = tariffApplies ? decimal(row.tariffPrice, 4, 'tariffPrice', { required: true }) : null;
  const marginFloor = cost === null ? null
    : (cost * PERCENT_SCALE + (PERCENT_SCALE - margin) - 1n) / (PERCENT_SCALE - margin);
  if (marginFloor !== null && marginFloor > PRICE_MAX) invalid('effectiveFloor');
  const candidates = [base, minimum, marginFloor].filter((value) => value !== null);
  const effective = candidates.length ? candidates.reduce((a, b) => a > b ? a : b, 0n) : null;
  const result = Object.freeze({
    articleCode, saleUnit,
    baseErpFloor: base === null ? null : print(base),
    ownedMinimumFloor: minimum === null ? null : print(minimum),
    costMarginFloor: marginFloor === null ? null : print(marginFloor),
    effectiveFloor: effective === null ? null : print(effective),
    enforceable: effective !== null && effective > 0n,
    provenance: Object.freeze([base !== null && 'ERP_TARIFA_2', minimum !== null && 'OWN_MINIMUM', marginFloor !== null && 'OWN_COST_MARGIN'].filter(Boolean)),
    policyRevision: Number(row.revision ?? 0), uomStatus: 'VERIFICADA',
  });
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
  VERIFIED_POLICIES.set(result, result.enforceable ? createVerifiedHardFloorPolicy({
    articleCode, unit: saleUnit, minimumUnitPrice: result.effectiveFloor,
    sourceFingerprint: fingerprint, policyStatus: 'VERIFICADA', unitStatus: 'VERIFICADA',
  }) : null);
  return result;
}

function assertCommercialPriceNetFloor({ policy, unitPrice, lineDiscountPct = 0, headerDiscountPct = 0 } = {}) {
  if (!policy || !VERIFIED_POLICIES.has(policy)) {
    fail('COMMERCIAL_PRICE_POLICY_UNVERIFIED', 'La política debe resolverse en el servidor.', 409);
  }
  decimal(unitPrice, 4, 'unitPrice', { required: true });
  decimal(lineDiscountPct, 2, 'lineDiscountPct', { required: true, max: 10000n });
  decimal(headerDiscountPct, 2, 'headerDiscountPct', { required: true, max: 10000n });
  if (!policy.enforceable) return Object.freeze({ allowed: true, netUnitPrice: null });
  return assertHardPriceFloor({
    policy: VERIFIED_POLICIES.get(policy), headerDiscountPct,
    line: { articleCode: policy.articleCode, unit: policy.saleUnit, unitPrice, lineDiscountPct },
  });
}

function managerActor(raw) {
  const role = raw?.role;
  if (!['ADMIN', 'JEFE_VENTAS'].includes(role)) fail('COMMERCIAL_PRICE_POLICY_MANAGER_REQUIRED', 'Se requiere un responsable autorizado.', 403);
  const code = raw?.code;
  if (typeof code !== 'string' || !/^[A-Za-z0-9._@-]{1,40}$/.test(code)) fail('COMMERCIAL_PRICE_POLICY_ACTOR_INVALID', 'La identidad firmada no es válida.', 403);
  return Object.freeze({ code, role });
}
function validateUpdate(articleCode, body, key, rawActor) {
  const actor = managerActor(rawActor);
  article(articleCode);
  const fields = ['confirmed', 'expectedRevision', 'reason', 'policyUnit', 'manufacturingCost', 'targetMarginPct', 'minimumPrice', 'minimumOrigin'];
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((field) => !fields.includes(field)) || fields.some((field) => !Object.hasOwn(body, field))) invalid('body');
  if (body.confirmed !== true) invalid('confirmed');
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= 2147483647) invalid('expectedRevision');
  if (typeof key !== 'string' || key.length > 96 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) invalid('Idempotency-Key');
  if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 250 || /[\x00-\x1f\x7f]/.test(body.reason)) invalid('reason');
  if (!['CAJAS', 'KILO', 'UNIDADES'].includes(body.policyUnit)) invalid('policyUnit');
  if (!['ERP_BASE', 'MANUAL'].includes(body.minimumOrigin)) invalid('minimumOrigin');
  const manufacturingCost = optionalDecimal(body.manufacturingCost, 'manufacturingCost');
  const marginUnits = decimal(body.targetMarginPct, 4, 'targetMarginPct', { max: PERCENT_SCALE - 1n });
  const targetMarginPct = marginUnits === null ? null : print(marginUnits);
  if ((manufacturingCost === null) !== (targetMarginPct === null)) invalid('manufacturingCost/targetMarginPct');
  const minimumPrice = optionalDecimal(body.minimumPrice, 'minimumPrice');
  if ((body.minimumOrigin === 'ERP_BASE' && minimumPrice !== null)
      || (body.minimumOrigin === 'MANUAL' && minimumPrice === null)) invalid('minimumPrice');
  const changes = { policyUnit: body.policyUnit, manufacturingCost, targetMarginPct, minimumPrice, minimumOrigin: body.minimumOrigin };
  const payload = { articleCode, expectedRevision: body.expectedRevision, reason: body.reason.trim(), ...changes };
  return Object.freeze({ ...payload, changes, actor, requestKey: key.toLowerCase(), payloadHash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') });
}
function pagination(raw = {}) {
  const parse = (value, fallback, max, field) => {
    if (value === undefined) return fallback;
    if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d{0,6}$/.test(String(value))) invalid(field);
    const number = Number(value);
    if (number > max) invalid(field);
    return number;
  };
  const page = parse(raw.page, 1, 1000000, 'page');
  const pageSize = parse(raw.pageSize, 50, 100, 'pageSize');
  const q = raw.q === undefined ? '' : raw.q;
  if (typeof q !== 'string' || q.length > 40 || /[\x00-\x1f\x7f]/.test(q)) invalid('q');
  const unitState = raw.unitState || null;
  if (unitState !== null && !['VERIFICADA', 'NO_VERIFICADA', 'CONFLICTIVA'].includes(unitState)) invalid('unitState');
  return { page, pageSize, offset: (page - 1) * pageSize, q: q.trim(), unitState };
}
function projectManagerPolicy(row) {
  let resolved;
  let coverageError = null;
  try { resolved = resolveCommercialPricePolicy({ ...row, saleUnit: row.policyUnit || unit(row.erpUnit) }); }
  catch (error) {
    if (!(error instanceof CommercialPricePolicyError)) throw error;
    coverageError = error.code;
  }
  return { ...row, effectiveFloor: resolved?.effectiveFloor ?? null, enforceable: resolved?.enforceable ?? false,
    provenance: resolved?.provenance ?? [], coverageError };
}

function createCommercialPricePolicyService({ repository, invalidate = async () => {} } = {}) {
  let persistence = repository;
  const repo = () => {
    if (!persistence) persistence = require('../repositories/commercial-price-policy.repository').createCommercialPricePolicyRepository();
    return persistence;
  };
  return Object.freeze({
    async listPricePolicies(query, actor) {
      managerActor(actor);
      const input = pagination(query);
      const result = await repo().list(input);
      return { ...result, page: input.page, pageSize: input.pageSize, items: result.items.map(projectManagerPolicy) };
    },
    async getPricePolicyAudit(articleCode, query, actor) {
      managerActor(actor);
      article(articleCode);
      const input = pagination(query);
      return { ...await repo().audit(articleCode, input), page: input.page, pageSize: input.pageSize };
    },
    async updatePricePolicy(articleCode, body, requestKey, actor) {
      const input = validateUpdate(articleCode, body, requestKey, actor);
      const ack = await repo().update(input, (current) => {
        const next = { ...current, ...input.changes, unitState: 'VERIFICADA' };
        const resolved = resolveCommercialPricePolicy({ ...next, saleUnit: input.policyUnit });
        return { ...input.changes, policyState: resolved.enforceable ? 'VERIFICADA' : 'SIN_EVIDENCIA' };
      });
      if (!ack.replayed) await invalidate(articleCode, ack.revision);
      return ack;
    },
  });
}
const defaultService = createCommercialPricePolicyService();
module.exports = {
  CommercialPricePolicyError, resolveCommercialPricePolicy, assertCommercialPriceNetFloor,
  createCommercialPricePolicyService, ...defaultService,
  _private: { decimal, unit, print, validateUpdate, pagination, managerActor, projectManagerPolicy },
};
