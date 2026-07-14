/**
 * Cobros Repository Implementation - DB2
 *
 * DELEGATES TO LEGACY cobros.js routes for correct SQL
 * The legacy implementation has proper column names and business logic
 */
const { CobrosRepository } = require('../domain/cobros-repository');
const { query, queryWithParams, getPool } = require('../../../../config/db');
const logger = require('../../../../middleware/logger');
const { db2QualifiedTable, db2InsertSql } = require('../../../../utils/db2-identifiers');
const { getDb2WriteSchema } = require('../../../../utils/db2-schemas');
const {
  buildCvcVendorScopeFilter,
  getVendorColumnExpr,
  MIN_YEAR,
  normalizeCvcTipoDocumentoFilter,
} = require('../../../../utils/common');
const { getClientCodesFromCache } = require('../../../../services/laclae');

const APP_SCHEMA = getDb2WriteSchema();
const COBROS_CAB_TABLE = db2QualifiedTable(APP_SCHEMA, 'COBROS_CAB');
const COBROS_LIN_TABLE = db2QualifiedTable(APP_SCHEMA, 'COBROS_LIN');
const COBROS_IDEMPOTENCY_TABLE = db2QualifiedTable(APP_SCHEMA, 'COBROS_IDEMPOTENCY');
const COBROS_COUNTER_TABLE = db2QualifiedTable(APP_SCHEMA, 'COBROS_NUMERO_COUNTER');
const cobrosNumeroTails = new Map();

const FORMAS_PAGO_REPARTIDOR = ['01', 'CO', 'CTR', 'EF'];

function isFormaPagoRepartidorResponsibility(formaPago) {
  const code = trim(formaPago).toUpperCase();
  if (!code) return false;
  if (FORMAS_PAGO_REPARTIDOR.includes(code)) return true;
  return code.includes('CTR') || code.includes('REEMB');
}

function isCobradoPorRepartidor({ repartidorPaid = 0, formaPago }) {
  if ((parseFloat(repartidorPaid) || 0) > 0) return true;
  return isFormaPagoRepartidorResponsibility(formaPago);
}

function mapHistoricoRow(row) {
  const fechaRaw = row.FECHA;
  let fechaIso = null;
  if (fechaRaw instanceof Date) fechaIso = fechaRaw.toISOString();
  else if (fechaRaw != null && fechaRaw !== '') {
    const parsed = Date.parse(String(fechaRaw));
    fechaIso = Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(fechaRaw);
  }
  const importe = fromCents(toCents(row.IMPORTE));
  const formaPago = trim(row.FORMA_PAGO) || null;
  const referencia = trim(row.REFERENCIA) || null;
  const observaciones = String(row.OBSERVACIONES || '').trim();
  const id = row.ID;
  const codigoCliente = trim(row.CODIGO_CLIENTE);
  return {
    id,
    codigoCliente,
    importe,
    formaPago,
    referencia,
    observaciones,
    fecha: fechaIso,
    ID: id,
    CODIGO_CLIENTE: codigoCliente,
    IMPORTE: importe,
    FORMA_PAGO: formaPago,
    REFERENCIA: referencia,
    OBSERVACIONES: observaciones,
    FECHA: fechaIso,
  };
}

class CommercialCobrosError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'CommercialCobrosError';
    this.code = code;
    this.status = status;
  }
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function fromCents(value) {
  return Math.round(value) / 100;
}

function normalizeNumericCode(value) {
  const raw = trim(value);
  if (!/^\d+$/.test(raw)) return null;
  return raw.replace(/^0+/, '') || '0';
}

function codesMatch(left, right) {
  const leftCode = trim(left);
  const rightCode = trim(right);
  if (leftCode === rightCode) return true;
  const leftNumeric = normalizeNumericCode(leftCode);
  const rightNumeric = normalizeNumericCode(rightCode);
  return leftNumeric !== null && rightNumeric !== null && leftNumeric === rightNumeric;
}

function isColumnNotFound(err) {
  const msg = String(err?.message || '').toLowerCase();
  const codes = (err?.odbcErrors || []).map(e => e.code);
  const states = (err?.odbcErrors || []).map(e => e.state);
  return codes.includes(-205) || states.includes('42S22') || msg.includes('sql0205') || msg.includes('column not found');
}

function currentHhmmss(date = new Date()) {
  return parseInt(
    `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`,
    10,
  );
}

function isManagerContext(context = {}) {
  return context.isJefeVentas === true ||
    context.userRole === 'JEFE_VENTAS' ||
    context.userRole === 'ADMIN';
}

function normalizeVendorCodeList(value) {
  const values = Array.isArray(value) ? value : trim(value).split(',');
  return values
    .map((code) => trim(code))
    .filter((code) => code && code.toUpperCase() !== 'ALL');
}

function buildCvcClientScopeFilter(clientCodes) {
  const codes = [
    ...new Set((clientCodes || [])
      .map((code) => trim(code).substring(0, 10))
      .filter((code) => /^[A-Za-z0-9]+$/.test(code))),
  ];
  if (codes.length === 0) return null;
  if (codes.length > 80) return null;
  return {
    clause: `AND TRIM(CVC.CODIGOCLIENTEALBARAN) IN (${codes.map(() => 'CAST(? AS VARCHAR(10))').join(',')})`,
    params: codes,
  };
}

function expandVendorCodesForQuery(value) {
  const out = new Set();
  for (const raw of normalizeVendorCodeList(value)) {
    if (!/^[A-Za-z0-9]{1,10}$/.test(raw)) continue;
    const code = raw.substring(0, 10);
    out.add(code);
    if (/^\d+$/.test(code)) {
      const unpadded = code.replace(/^0+/, '') || '0';
      out.add(unpadded);
      if (unpadded.length <= 2) out.add(unpadded.padStart(2, '0'));
    }
  }
  return [...out];
}

function normalizeToken(rawToken) {
  const token = trim(rawToken);
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(token)) {
    throw new CommercialCobrosError(
      'INVALID_IDEMPOTENCY_TOKEN',
      'idempotencyToken requerido o invalido',
      400,
    );
  }
  if (token.length <= 64) return token;
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

function paymentIdFromIdempotencyToken(token) {
  const crypto = require('crypto');
  return `CBR-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

function requestHash(parts) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function cobrosScope(date = new Date()) {
  return {
    subempresa: String(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP').substring(0, 3),
    ejercicio: date.getFullYear(),
    serie: String(process.env.COBROS_SYSTEM_SERIE || process.env.PEDIDOS_SYSTEM_SERIE || 'R').substring(0, 1),
    terminal: parseInt(process.env.COBROS_SYSTEM_TERMINAL || process.env.PEDIDOS_SYSTEM_TERMINAL || '10', 10),
  };
}

function cobrosFormaPago(value) {
  return (trim(value || 'C') || 'C').substring(0, 1);
}

function documentKeyForLine(order, fallbackScope) {
  const cvcRef = parseCvcStableReference(stableOrderReference(order));
  if (cvcRef) {
    return {
      subempresa: cvcRef.subempresa || fallbackScope.subempresa,
      ejercicio: parseInt(cvcRef.ejercicioDocumento, 10) || fallbackScope.ejercicio,
      serie: (cvcRef.serie || '').substring(0, 1) || fallbackScope.serie,
      terminal: parseInt(cvcRef.terminalDocumento, 10) || fallbackScope.terminal,
      numero: parseInt(cvcRef.numero, 10) || 0,
    };
  }
  return {
    subempresa: fallbackScope.subempresa,
    ejercicio: parseInt(order.EJERCICIO, 10) || fallbackScope.ejercicio,
    serie: trim(order.SYSTEM_SERIEPEDIDO || order.SERIEPEDIDO).substring(0, 1) || fallbackScope.serie,
    terminal: parseInt(order.SYSTEM_TERMINALPEDIDO, 10) || fallbackScope.terminal,
    numero: parseInt(order.SYSTEM_NUMEROPEDIDO || order.NUMEROPEDIDO, 10) || 0,
  };
}

function supportUnavailable(message) {
  return new CommercialCobrosError(
    'COBROS_RUNTIME_SUPPORT_UNAVAILABLE',
    message || 'Servicio de cobros no disponible: soporte runtime no configurado',
    503,
  );
}

function cobrosNumeroLockKey(scope) {
  return [scope.subempresa, scope.ejercicio, scope.serie, scope.terminal].join('|');
}

function withCobrosNumeroLock(scope, callback) {
  const key = cobrosNumeroLockKey(scope);
  const tail = cobrosNumeroTails.get(key) || Promise.resolve();
  const run = tail.then(callback, callback);
  const nextTail = run.catch(() => {});
  cobrosNumeroTails.set(key, nextTail);
  nextTail.finally(() => {
    if (cobrosNumeroTails.get(key) === nextTail) cobrosNumeroTails.delete(key);
  }).catch(() => {});
  return run;
}

function legacyOrderReference(order) {
  return `${trim(order.SERIEPEDIDO)}-${trim(order.NUMERODOCUMENTO || order.NUMEROPEDIDO)}`;
}

function formatRepartidorDocKey(serie, numero) {
  return `${trim(serie)}-${trim(numero)}`;
}

function cvcPart(value) {
  return trim(value).replace(/:/g, '_');
}

function cvcLegacyDocKey(row) {
  return formatRepartidorDocKey(row.SERIE_DOCUMENTO || row.SERIEPEDIDO || row.SERIE, row.NUMERO_DOCUMENTO || row.NUMEROPEDIDO || row.NUMERO);
}

function cvcPartsFromRow(row = {}) {
  return {
    tipoDocumento: cvcPart(row.TIPO_DOCUMENTO || row.TIPODOCUMENTO),
    origenDocumento: cvcPart(row.ORIGEN_DOCUMENTO || row.ORIGENDOCUMENTO),
    subempresa: cvcPart(row.SUBEMPRESA || row.SUBEMPRESADOCUMENTO),
    ejercicioDocumento: cvcPart(row.EJERCICIO_DOCUMENTO || row.EJERCICIODOCUMENTO),
    serie: cvcPart(row.SERIE_DOCUMENTO || row.SERIEPEDIDO || row.SERIE || row.SERIEDOCUMENTO),
    terminalDocumento: cvcPart(row.TERMINAL_DOCUMENTO || row.TERMINALDOCUMENTO),
    numero: cvcPart(row.NUMERO_DOCUMENTO || row.NUMEROPEDIDO || row.NUMERO || row.NUMERODOCUMENTO),
    xde: cvcPart(row.XDE || row.XDE_DOCUMENTO || row.XDEDOCUMENTO),
    dex: cvcPart(row.DEX || row.DEX_DOCUMENTO || row.DEXDOCUMENTO),
  };
}

function hasFullCvcParts(parts) {
  return Boolean(
    parts.tipoDocumento &&
    parts.subempresa &&
    parts.ejercicioDocumento &&
    parts.serie &&
    parts.terminalDocumento &&
    parts.numero,
  );
}

function cvcFullDocKey(row) {
  const parts = cvcPartsFromRow(row);
  if (!hasFullCvcParts(parts)) return '';
  return [
    'CVC',
    parts.tipoDocumento,
    parts.origenDocumento,
    parts.subempresa,
    parts.ejercicioDocumento,
    parts.serie,
    parts.terminalDocumento,
    parts.numero,
    parts.xde || '0',
    parts.dex || '0',
  ].join(':');
}

function cvcPrimaryDocKey(row) {
  return cvcFullDocKey(row) || cvcLegacyDocKey(row);
}

function cvcReferenceSql(alias) {
  return [
    "'CVC:'",
    `COALESCE(TRIM(${alias}.TIPODOCUMENTO), '')`,
    "':'",
    `COALESCE(TRIM(${alias}.ORIGENDOCUMENTO), '')`,
    "':'",
    `COALESCE(TRIM(${alias}.SUBEMPRESADOCUMENTO), '')`,
    "':'",
    `COALESCE(TRIM(CAST(${alias}.EJERCICIODOCUMENTO AS VARCHAR(20))), '')`,
    "':'",
    `COALESCE(TRIM(${alias}.SERIEDOCUMENTO), '')`,
    "':'",
    `COALESCE(TRIM(CAST(${alias}.TERMINALDOCUMENTO AS VARCHAR(20))), '')`,
    "':'",
    `COALESCE(TRIM(CAST(${alias}.NUMERODOCUMENTO AS VARCHAR(20))), '')`,
    "':'",
    `COALESCE(TRIM(CAST(${alias}.XDEDOCUMENTO AS VARCHAR(20))), '0')`,
    "':'",
    `COALESCE(TRIM(CAST(${alias}.DEXDOCUMENTO AS VARCHAR(20))), '0')`,
  ].join(' || ');
}

function cvcLegacyReferenceSql(alias) {
  return `TRIM(${alias}.SERIEDOCUMENTO) || '-' || TRIM(CAST(${alias}.NUMERODOCUMENTO AS VARCHAR(20)))`;
}

function parseCvcStableReference(reference) {
  const value = trim(reference);
  if (!value.toUpperCase().startsWith('CVC:')) return null;
  const parts = value.slice(4).split(':');
  if (parts.length < 9) return null;
  return {
    fullReference: value,
    tipoDocumento: parts[0],
    origenDocumento: parts[1],
    subempresa: parts[2],
    ejercicioDocumento: parts[3],
    serie: parts[4],
    terminalDocumento: parts[5],
    numero: parts[6],
    xde: parts[7],
    dex: parts[8],
    legacyReference: `${parts[4]}-${parts[6]}`,
  };
}

function normalizeCobrosDocReference(reference) {
  const value = trim(reference);
  if (!value) return '';
  if (parseCvcStableReference(value)) return value;
  const stableMatch = value.match(/^CVC:([^:]+-\d+)$/);
  if (stableMatch) return stableMatch[1];
  const pedidoMatch = value.match(/^PEDIDO:[^:]+:(.+)$/);
  if (pedidoMatch) return pedidoMatch[1];
  return value;
}

function cvcDocKeySet(row, allowLegacy = true) {
  const keys = [];
  const full = cvcFullDocKey(row);
  const legacy = cvcLegacyDocKey(row);
  if (full) keys.push(full);
  if (allowLegacy && legacy && legacy !== '-') keys.push(legacy);
  return [...new Set(keys.filter(Boolean))];
}

function db2StringLiteral(value) {
  const escaped = trim(value).split('\'').join('\'\'');
  return '\'' + escaped + '\'';
}

function resolveDocAppPaid(clientCode, rowOrKey, portfolioAdjustments, appCobrosByDoc, repartidorByDoc) {
  const row = typeof rowOrKey === 'object' && rowOrKey !== null ? rowOrKey : null;
  const allowLegacy = row ? (parseInt(row.LEGACY_COLLISION_COUNT, 10) || 1) <= 1 : true;
  const keys = row ? cvcDocKeySet(row, allowLegacy) : [trim(rowOrKey)];
  let portfolioPaid = 0;
  let localPaid = 0;
  for (const docKey of keys) {
    const scopedKey = trim(clientCode) + '|' + docKey;
    portfolioPaid += portfolioAdjustments?.get(scopedKey) || 0;
    localPaid += (appCobrosByDoc?.get(docKey) || 0) + (repartidorByDoc?.get(docKey) || 0);
  }
  return Math.max(portfolioPaid, localPaid);
}

function groupCvcRowsByDocument(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const docKey = cvcPrimaryDocKey(row);
    if (!docKey || docKey === '-') continue;
    let current = grouped.get(docKey);
    if (!current) {
      current = {
        ...row,
        IMPORTE_TOTAL: 0,
        IMPORTE_COBRADO: 0,
        IMPORTE_PENDIENTE: 0,
        IMPORTE_VENCIDO: 0,
        _dueKey: Number.MAX_SAFE_INTEGER,
      };
      grouped.set(docKey, current);
    }
    const legacySet = current._legacyKeys || new Set();
    legacySet.add(cvcLegacyDocKey(row));
    current._legacyKeys = legacySet;

    current.IMPORTE_TOTAL = fromCents(toCents(current.IMPORTE_TOTAL) + toCents(row.IMPORTE_TOTAL));
    current.IMPORTE_COBRADO = fromCents(toCents(current.IMPORTE_COBRADO) + toCents(row.IMPORTE_COBRADO));
    current.IMPORTE_PENDIENTE = fromCents(toCents(current.IMPORTE_PENDIENTE) + toCents(row.IMPORTE_PENDIENTE));

    const dueIso = toIsoDate(row.ANO_VENCIMIENTO, row.MES_VENCIMIENTO, row.DIA_VENCIMIENTO);
    if (computeEstadoVencimiento(dueIso) === 'VENCIDO') {
      current.IMPORTE_VENCIDO = fromCents(toCents(current.IMPORTE_VENCIDO) + toCents(row.IMPORTE_PENDIENTE));
    }

    const dueKey =
      (parseInt(row.ANO_VENCIMIENTO, 10) || 9999) * 10000 +
      (parseInt(row.MES_VENCIMIENTO, 10) || 12) * 100 +
      (parseInt(row.DIA_VENCIMIENTO, 10) || 31);
    if (dueKey < current._dueKey) {
      current._dueKey = dueKey;
      current.ANO_VENCIMIENTO = row.ANO_VENCIMIENTO;
      current.MES_VENCIMIENTO = row.MES_VENCIMIENTO;
      current.DIA_VENCIMIENTO = row.DIA_VENCIMIENTO;
    }
  }
  const legacyCounts = new Map();
  for (const row of grouped.values()) {
    const legacyKey = cvcLegacyDocKey(row);
    if (!legacyKey || legacyKey === '-') continue;
    legacyCounts.set(legacyKey, (legacyCounts.get(legacyKey) || 0) + 1);
  }
  return [...grouped.values()].map(({ _dueKey, _legacyKeys, ...row }) => ({
    ...row,
    LEGACY_COLLISION_COUNT: legacyCounts.get(cvcLegacyDocKey(row)) || 1,
  }));
}

function computeClientPendingTotalGrouped(rows, clientCode, portfolioAdjustments, appCobrosByDoc, repartidorByDoc) {
  const rawByDoc = new Map();
  const rowByDoc = new Map();
  for (const row of rows || []) {
    const docKey = cvcPrimaryDocKey(row);
    rawByDoc.set(docKey, (rawByDoc.get(docKey) || 0) + (parseFloat(row.IMPORTE_PENDIENTE) || 0));
    rowByDoc.set(docKey, row);
  }
  let totalCents = 0;
  for (const [docKey, rawTotal] of rawByDoc) {
    const appPaid = resolveDocAppPaid(clientCode, rowByDoc.get(docKey) || docKey, portfolioAdjustments, appCobrosByDoc, repartidorByDoc);
    const net = Math.max(0, rawTotal - appPaid);
    if (toCents(net) > 0) totalCents += toCents(net);
  }
  return fromCents(totalCents);
}

function mapCvcRowsToPendientes(rows, clientCode, appCobrosByDoc, repartidorByDoc, portfolioAdjustments) {
  const paidBudgetByDoc = new Map();
  for (const row of rows || []) {
    const docKey = cvcPrimaryDocKey(row);
    if (!paidBudgetByDoc.has(docKey)) {
      paidBudgetByDoc.set(docKey, resolveDocAppPaid(clientCode, row, portfolioAdjustments, appCobrosByDoc, repartidorByDoc));
    }
  }
  const paidRemainingByDoc = new Map(paidBudgetByDoc);
  return (rows || [])
    .map((row) => {
      const docKey = cvcPrimaryDocKey(row);
      const erpPendiente = parseFloat(row.IMPORTE_PENDIENTE) || 0;
      const remainingPaid = paidRemainingByDoc.get(docKey) || 0;
      const appPaidThisLine = Math.min(remainingPaid, erpPendiente);
      paidRemainingByDoc.set(docKey, Math.max(0, remainingPaid - appPaidThisLine));
      const repartidorPaid = cvcDocKeySet(row, (parseInt(row.LEGACY_COLLISION_COUNT, 10) || 1) <= 1)
        .reduce((sum, key) => sum + (repartidorByDoc.get(key) || 0), 0);
      return mapCvcRowToCobro(
        row,
        appPaidThisLine,
        repartidorPaid,
      );
    })
    .filter((cobro) => toCents(cobro.importePendiente) > 0);
}

function parseDocReference(reference) {
  const value = trim(reference);
  const dashIndex = value.lastIndexOf('-');
  if (dashIndex <= 0) {
    return { serie: value, numero: null };
  }
  return {
    serie: value.slice(0, dashIndex),
    numero: value.slice(dashIndex + 1),
  };
}

function stableOrderReference(order) {
  if (trim(order.SOURCE).toUpperCase() === 'CVC') {
    const stable = trim(order.ID);
    if (stable.toUpperCase().startsWith('CVC:')) return stable;
    return cvcFullDocKey(order) || `CVC:${legacyOrderReference(order)}`;
  }
  return `PEDIDO:${trim(order.ID)}:${legacyOrderReference(order)}`;
}

function normalizePaymentOrderReference(value) {
  const reference = trim(value);
  if (parseCvcStableReference(reference)) return reference;
  const stableMatch = reference.match(/^(?:PEDIDO:[^:]+:|CVC:)(.+)$/);
  return stableMatch ? stableMatch[1] : reference;
}

function paymentMatchesOrder(paymentReference, order) {
  const reference = trim(paymentReference);
  const legacy = legacyOrderReference(order);
  return reference === stableOrderReference(order) || normalizeCobrosDocReference(reference) === legacy;
}

function statusForPendingCents(pendingAfterCents) {
  if (pendingAfterCents < 0) return 'SOBRECOBRADO';
  if (pendingAfterCents === 0) return 'COBRADO';
  return 'PARCIAL';
}

function format2(value) {
  return String(value).padStart(2, '0');
}

function toIsoDate(year, month, day) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (!Number.isFinite(y) || y <= 0 || !Number.isFinite(m) || m <= 0 || !Number.isFinite(d) || d <= 0) {
    return null;
  }
  return `${y}-${format2(m)}-${format2(d)}T00:00:00.000Z`;
}

function parseYmdInt(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(isoDate));
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return y * 10000 + m * 100 + d;
}

function buildCobrosDocumentFilters(filters = {}, alias = 'C') {
  const clauses = [];
  const params = [];
  const tipoDocumentoCodes = normalizeCvcTipoDocumentoFilter(filters.tipoDocumento);
  if (tipoDocumentoCodes.length > 0) {
    clauses.push(`AND TRIM(${alias}.TIPODOCUMENTO) IN (${tipoDocumentoCodes.map(() => '?').join(',')})`);
    params.push(...tipoDocumentoCodes);
  }
  const desde = parseYmdInt(filters.fechaDesde);
  if (desde != null) {
    clauses.push(`AND (${alias}.ANOVENCIMIENTO * 10000 + ${alias}.MESVENCIMIENTO * 100 + ${alias}.DIAVENCIMIENTO) >= ?`);
    params.push(desde);
  }
  const hasta = parseYmdInt(filters.fechaHasta);
  if (hasta != null) {
    clauses.push(`AND (${alias}.ANOVENCIMIENTO * 10000 + ${alias}.MESVENCIMIENTO * 100 + ${alias}.DIAVENCIMIENTO) <= ?`);
    params.push(hasta);
  }
  return { clause: clauses.length ? '\n          ' + clauses.join('\n          ') : '', params };
}

function buildAppOrderDateFilters(filters = {}, alias = 'PC') {
  const clauses = [];
  const params = [];
  const tipoDocumento = trim(filters.tipoDocumento).toUpperCase();
  if (tipoDocumento && !['PEDIDO', 'PEDIDO_APP', 'APP'].includes(tipoDocumento)) {
    return { clause: '\n        AND 1 = 0', params };
  }
  const desde = parseYmdInt(filters.fechaDesde);
  if (desde != null) {
    clauses.push(`AND (${alias}.ANODOCUMENTO * 10000 + ${alias}.MESDOCUMENTO * 100 + ${alias}.DIADOCUMENTO) >= ?`);
    params.push(desde);
  }
  const hasta = parseYmdInt(filters.fechaHasta);
  if (hasta != null) {
    clauses.push(`AND (${alias}.ANODOCUMENTO * 10000 + ${alias}.MESDOCUMENTO * 100 + ${alias}.DIADOCUMENTO) <= ?`);
    params.push(hasta);
  }
  return { clause: clauses.length ? '\n        ' + clauses.join('\n        ') : '', params };
}

function computeEstadoVencimiento(fechaVencimientoIso) {
  if (!fechaVencimientoIso) return 'PENDIENTE';
  const due = new Date(fechaVencimientoIso);
  if (Number.isNaN(due.getTime())) return 'PENDIENTE';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due.getTime() <= today.getTime() ? 'VENCIDO' : 'PENDIENTE';
}

function buildCvcVendorAccessClause(context = {}, cvcAlias = 'CVC') {
  const manager = isManagerContext(context);
  const userCode = trim(context.userId || context.userCode);
  const visibleCodes = normalizeVendorCodeList(context.vendedorCodes || context.vendorCodes || []);
  const vendorCodes = !manager && userCode
    ? [userCode]
    : (manager && visibleCodes.length > 0 ? visibleCodes : []);
  if (vendorCodes.length === 0) return { clause: '', params: [] };

  const safeCodes = vendorCodes
    .filter((v) => /^[A-Za-z0-9]{1,10}$/.test(v))
    .map((v) => v.trim());
  if (safeCodes.length === 0) return { clause: '', params: [] };

  const scoped = buildCvcVendorScopeFilter(safeCodes);
  return {
    clause: scoped.clause.replace(/\bCVC\./g, `${cvcAlias}.`),
    params: scoped.params,
  };
}

function buildAppOrderVendorAccessClause(context = {}, alias = 'PC') {
  const manager = isManagerContext(context);
  const userCode = trim(context.userId || context.userCode);
  const visibleCodes = normalizeVendorCodeList(context.vendedorCodes || context.vendorCodes || []);
  const vendorCodes = !manager && userCode
    ? [userCode]
    : (manager && visibleCodes.length > 0 ? visibleCodes : []);
  const safeCodes = expandVendorCodesForQuery(vendorCodes);
  if (safeCodes.length === 0) return { clause: '', params: [] };
  const canBindSafely = safeCodes.length <= 90 && safeCodes.every((code) => String(code).length <= 2);
  if (canBindSafely) {
    return {
      clause: ` AND TRIM(${alias}.CODIGOVENDEDOR) IN (${safeCodes.map(() => '?').join(',')})`,
      params: safeCodes,
    };
  }
  const literalCodes = safeCodes.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  return { clause: ` AND TRIM(${alias}.CODIGOVENDEDOR) IN (${literalCodes})`, params: [] };
}

function buildAppOrderGeneratedDocumentFilter(optionalColumns, alias = 'PC') {
  const clauses = [];
  if (optionalColumns.has('NUMEROALBARAN')) clauses.push(`COALESCE(${alias}.NUMEROALBARAN, 0) = 0`);
  if (optionalColumns.has('NUMEROFACTURA')) clauses.push(`COALESCE(${alias}.NUMEROFACTURA, 0) = 0`);
  if (optionalColumns.has('PROCESADOSN')) clauses.push(`COALESCE(TRIM(${alias}.PROCESADOSN), '') NOT IN ('S', 'F', 'R')`);
  if (optionalColumns.has('SITUACIONALBARAN')) clauses.push(`COALESCE(TRIM(${alias}.SITUACIONALBARAN), '') NOT IN ('F', 'R')`);
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
}

function mapCvcRowToCobro(row, appPaid = 0, repartidorPaid = 0) {
  const serie = trim(row.SERIE_DOCUMENTO);
  const numero = row.NUMERO_DOCUMENTO || 0;
  const xde = row.XDE || 1;
  const tipoDoc = trim(row.TIPO_DOCUMENTO || 'FAC');
  const docKey = cvcLegacyDocKey(row);
  const stableReference = cvcFullDocKey(row) || `CVC:${docKey}`;
  const fecha = toIsoDate(row.ANO_DOCUMENTO, row.MES_DOCUMENTO, row.DIA_DOCUMENTO);
  const fechaVencimiento = toIsoDate(row.ANO_VENCIMIENTO, row.MES_VENCIMIENTO, row.DIA_VENCIMIENTO);
  const erpPendienteCents = toCents(row.IMPORTE_PENDIENTE);
  const appPaidCents = toCents(appPaid);
  const pendingCents = Math.max(0, erpPendienteCents - appPaidCents);
  const vencidoCents = row.IMPORTE_VENCIDO == null
    ? null
    : Math.max(0, toCents(row.IMPORTE_VENCIDO) - appPaidCents);
  const estado = pendingCents <= 1
    ? 'COBRADO'
    : (vencidoCents == null
      ? computeEstadoVencimiento(fechaVencimiento)
      : (vencidoCents > 0 ? 'VENCIDO' : 'PENDIENTE'));
  return {
    id: stableReference,
    tipo: tipoDoc === 'CAC' ? 'albaran' : 'factura',
    referencia: docKey,
    fecha,
    fechaVencimiento,
    importeTotal: fromCents(toCents(row.IMPORTE_TOTAL)),
    importePendiente: fromCents(pendingCents),
    importeCobrado: fromCents(toCents(row.IMPORTE_COBRADO) + appPaidCents),
    estado,
    formaPago: trim(row.FORMA_PAGO) || null,
    descripcion: `${tipoDoc} ${docKey}`,
    docKey: {
      source: 'CVC',
      reference: stableReference,
      legacyReference: docKey,
      serie,
      numero,
      xde,
      dex: row.DEX || 0,
      subempresa: trim(row.SUBEMPRESA),
      ejercicioDocumento: row.EJERCICIO_DOCUMENTO || null,
      terminalDocumento: row.TERMINAL_DOCUMENTO || null,
      origenDocumento: trim(row.ORIGEN_DOCUMENTO),
      tipoDocumento: tipoDoc,
    },
    appPaymentApplied: appPaidCents > 0 ? fromCents(appPaidCents) : undefined,
    cobradoPorRepartidor: isCobradoPorRepartidor({ repartidorPaid, formaPago: trim(row.FORMA_PAGO) || null }),
    esCTR: isFormaPagoRepartidorResponsibility(trim(row.FORMA_PAGO) || null),
    responsabilidad: isCobradoPorRepartidor({ repartidorPaid, formaPago: trim(row.FORMA_PAGO) || null }) ? 'REPARTIDOR' : 'COMERCIAL',
  };
}

class Db2CobrosRepository extends CobrosRepository {
  /**
   * Get pending payments for a client (orders that are CONFIRMADO/ENVIADO but not yet paid)
   * Uses correct column names: DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, IMPORTETOTAL
   */
  async getPendientes(clientCode, context = {}) {
    await this.ensureCobrosTable();
    const access = buildCvcVendorAccessClause(context, 'C');
    const docFilters = buildCobrosDocumentFilters(context, 'C');
    try {
      const cvcSql = `
        SELECT
            TRIM(C.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
            C.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
            C.XDEDOCUMENTO AS XDE,
            C.DEXDOCUMENTO AS DEX,
            C.EJERCICIODOCUMENTO AS EJERCICIO_DOCUMENTO,
            C.TERMINALDOCUMENTO AS TERMINAL_DOCUMENTO,
            TRIM(C.ORIGENDOCUMENTO) AS ORIGEN_DOCUMENTO,
            TRIM(C.CODIGOCLIENTEALBARAN) AS CODIGO_CLIENTE,
            C.IMPORTEVENCIMIENTO AS IMPORTE_TOTAL,
            C.IMPORTECANCELADO AS IMPORTE_COBRADO,
            C.IMPORTEPENDIENTE AS IMPORTE_PENDIENTE,
            C.ANOEMISION AS ANO_DOCUMENTO,
            C.MESEMISION AS MES_DOCUMENTO,
            C.DIAEMISION AS DIA_DOCUMENTO,
            C.ANOVENCIMIENTO AS ANO_VENCIMIENTO,
            C.MESVENCIMIENTO AS MES_VENCIMIENTO,
            C.DIAVENCIMIENTO AS DIA_VENCIMIENTO,
            TRIM(C.SUBEMPRESADOCUMENTO) AS SUBEMPRESA,
            TRIM(C.TIPODOCUMENTO) AS TIPO_DOCUMENTO,
            TRIM(C.CODIGOFORMAPAGO) AS FORMA_PAGO
        FROM DSEDAC.CVC C
        WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
          AND C.IMPORTEPENDIENTE > 0.01
          AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
          ${docFilters.clause}
          ${access.clause}
        ORDER BY C.ANOVENCIMIENTO ASC, C.MESVENCIMIENTO ASC, C.DIAVENCIMIENTO ASC`;

      const rows = await queryWithParams(cvcSql, [trim(clientCode), ...docFilters.params, ...access.params], []);
      const appCobrosByDoc = await this.getAppSideCobrosByDoc(clientCode);
      const repartidorByDoc = await this.getAppSideRepartidorByDoc(clientCode);
      const groupedRows = groupCvcRowsByDocument(rows);
      const adjustmentVendorCodes = normalizeVendorCodeList(
        context.adjustmentVendorCode
          ? [context.adjustmentVendorCode]
          : (context.vendorCodes || context.vendedorCodes || []),
      );
      let portfolioAdjustments = null;
      if (groupedRows.length > 0 && adjustmentVendorCodes.length > 0) {
        const scoped = buildCvcVendorScopeFilter(adjustmentVendorCodes);
        portfolioAdjustments = await this.getAppSideCobrosByDocForVendorScope(scoped.clause, scoped.params);
      }
      const cobros = mapCvcRowsToPendientes(
        groupedRows,
        clientCode,
        appCobrosByDoc,
        repartidorByDoc,
        portfolioAdjustments,
      );
      const cvcTotalPendiente = computeClientPendingTotalGrouped(
        groupedRows,
        clientCode,
        portfolioAdjustments,
        appCobrosByDoc,
        repartidorByDoc,
      );

      const appOrders = await this.getAppOrderPendientes(clientCode, context);
      const mergedCobros = [
        ...cobros,
        ...(appOrders.cobros || []),
      ];
      const totalPendiente = fromCents(
        toCents(cvcTotalPendiente) +
        toCents(appOrders?.resumen?.totalPendiente || 0),
      );
      const totalVencido = mergedCobros
        .filter((c) => c.estado === 'VENCIDO')
        .reduce((sum, c) => sum + c.importePendiente, 0);
      return {
        cobros: mergedCobros,
        resumen: {
          totalPendiente,
          total: totalPendiente,
          totalVencido,
          numDocumentos: mergedCobros.length,
          numVencidos: mergedCobros.filter((c) => c.estado === 'VENCIDO').length,
          documentos: { cantidad: mergedCobros.length, total: totalPendiente },
          cvc: { cantidad: cobros.length, total: cvcTotalPendiente },
          pedidosApp: {
            cantidad: appOrders?.resumen?.pedidos?.cantidad || 0,
            total: appOrders?.resumen?.pedidos?.total || 0,
          },
          source: (appOrders?.resumen?.pedidos?.cantidad || 0) > 0 ? 'CVC+PEDIDOS_CAB' : 'CVC',
        },
      };
    } catch (cvcErr) {
      logger.warn(`[COBROS_REPO] CVC pendientes failed for ${clientCode}; using ${APP_SCHEMA}.PEDIDOS_CAB fallback: ${cvcErr.message}`);
    }

    return this.getAppOrderPendientes(clientCode, context);
  }

  async getPedidoCabOptionalColumns() {
    const optionalColumns = new Set();
    try {
      const columnRows = await query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS2
        WHERE TABLE_SCHEMA = '${APP_SCHEMA}' AND TABLE_NAME = 'PEDIDOS_CAB'
          AND COLUMN_NAME IN (
            'ORIGEN', 'NUMEROALBARAN', 'NUMEROFACTURA', 'PROCESADOSN',
            'SITUACIONALBARAN', 'IMPORTECOBRADO', 'SYSTEM_NUMEROPEDIDO',
            'SYSTEM_SERIEPEDIDO', 'SYSTEM_TERMINALPEDIDO'
          )
      `);
      for (const row of columnRows || []) optionalColumns.add(trim(row.COLUMN_NAME).toUpperCase());
    } catch (e) {
      logger.debug('[COBROS_REPO] PEDIDOS_CAB optional column detection skipped', {
        schema: APP_SCHEMA,
        table: 'PEDIDOS_CAB',
        reason: e?.code || e?.message || 'unknown',
      });
    }
    return optionalColumns;
  }

  async getAppOrderPendientes(clientCode, context = {}) {
    const optionalColumns = await this.getPedidoCabOptionalColumns();
    const origenExists = optionalColumns.has('ORIGEN');
    const vendorAccess = buildAppOrderVendorAccessClause(context, 'PC');
    const origenFilter = origenExists ? " AND PC.ORIGEN = 'A'" : '';
    const appDateFilters = buildAppOrderDateFilters(context, 'PC');
    const generatedFilter = buildAppOrderGeneratedDocumentFilter(optionalColumns, 'PC');
    const optionalSelect = {
      numeroAlbaran: optionalColumns.has('NUMEROALBARAN') ? 'PC.NUMEROALBARAN' : '0',
      numeroFactura: optionalColumns.has('NUMEROFACTURA') ? 'PC.NUMEROFACTURA' : '0',
      procesado: optionalColumns.has('PROCESADOSN') ? "TRIM(PC.PROCESADOSN)" : "''",
      situacionAlbaran: optionalColumns.has('SITUACIONALBARAN') ? "TRIM(PC.SITUACIONALBARAN)" : "''",
      importeCobrado: optionalColumns.has('IMPORTECOBRADO') ? 'PC.IMPORTECOBRADO' : '0',
      systemNumero: optionalColumns.has('SYSTEM_NUMEROPEDIDO') ? 'PC.SYSTEM_NUMEROPEDIDO' : '0',
      systemSerie: optionalColumns.has('SYSTEM_SERIEPEDIDO') ? 'TRIM(PC.SYSTEM_SERIEPEDIDO)' : "''",
      systemTerminal: optionalColumns.has('SYSTEM_TERMINALPEDIDO') ? 'PC.SYSTEM_TERMINALPEDIDO' : '0',
    };
    const sql = `
      SELECT
        PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
        PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
        PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO,
        ${optionalSelect.numeroAlbaran} AS NUMEROALBARAN,
        ${optionalSelect.numeroFactura} AS NUMEROFACTURA,
        ${optionalSelect.procesado} AS PROCESADOSN,
        ${optionalSelect.situacionAlbaran} AS SITUACIONALBARAN,
        ${optionalSelect.importeCobrado} AS IMPORTECOBRADO,
        ${optionalSelect.systemNumero} AS SYSTEM_NUMEROPEDIDO,
        ${optionalSelect.systemSerie} AS SYSTEM_SERIEPEDIDO,
        ${optionalSelect.systemTerminal} AS SYSTEM_TERMINALPEDIDO
      FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
      WHERE TRIM(PC.CODIGOCLIENTE) = ?
        ${origenFilter}
        AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
        AND PC.IMPORTETOTAL > 0
        ${generatedFilter}
        ${appDateFilters.clause}
        ${vendorAccess.clause}
      ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC, PC.DIADOCUMENTO DESC
      FETCH FIRST 100 ROWS ONLY`;

    const orderParams = [trim(clientCode), ...appDateFilters.params, ...vendorAccess.params];
    const resultado = await queryWithParams(sql, orderParams, []);
    const payments = await this.getPaymentsForClient(clientCode);

    const cobros = (resultado && resultado.length > 0 ? resultado : []).map(row => {
      const hasGeneratedDocument = (parseInt(row.NUMEROALBARAN, 10) || 0) > 0 ||
        (parseInt(row.NUMEROFACTURA, 10) || 0) > 0 ||
        ['S', 'F', 'R'].includes(trim(row.PROCESADOSN).toUpperCase()) ||
        ['F', 'R'].includes(trim(row.SITUACIONALBARAN).toUpperCase());
      if (hasGeneratedDocument) return null;
      const referencia = `${trim(row.SERIEPEDIDO)}-${row.NUMEROPEDIDO}`;
      const totalCents = toCents(row.IMPORTETOTAL);
      const paidCents = payments
        .filter((payment) => paymentMatchesOrder(payment.REFERENCIA, row))
        .reduce((sum, payment) => sum + toCents(payment.TOTAL_IMPORTE), 0);
      const pendingCents = Math.max(0, totalCents - paidCents);

      return {
        id: stableOrderReference(row),
        tipo: 'pedido_app',
        referencia,
        fecha: toIsoDate(row.ANODOCUMENTO, row.MESDOCUMENTO, row.DIADOCUMENTO),
        importeTotal: fromCents(totalCents),
        importePendiente: fromCents(pendingCents),
        descripcion: `Pedido ${referencia}`,
        estado: trim(row.ESTADO),
        ejercicio: row.EJERCICIO,
        numeroPedido: row.NUMEROPEDIDO,
        seriePedido: row.SERIEPEDIDO,
        docKey: {
          source: 'PEDIDOS_CAB',
          id: row.ID,
          serie: trim(row.SERIEPEDIDO),
          numero: row.NUMEROPEDIDO,
          systemSerie: trim(row.SYSTEM_SERIEPEDIDO),
          systemTerminal: row.SYSTEM_TERMINALPEDIDO,
          systemNumero: row.SYSTEM_NUMEROPEDIDO,
        },
        provisional: true,
      };
    }).filter((cobro) => cobro && toCents(cobro.importePendiente) > 0);

    const totalPendiente = cobros.reduce((sum, c) => sum + c.importePendiente, 0);
    return {
      cobros,
      resumen: {
        totalPendiente,
        total: totalPendiente,
        pedidos: { cantidad: cobros.length, total: totalPendiente },
        source: 'PEDIDOS_CAB',
      },
    };
  }

  async getAppOrderPendingSummary(context = {}) {
    const optionalColumns = await this.getPedidoCabOptionalColumns();
    const vendorAccess = buildAppOrderVendorAccessClause(context, 'PC');
    const origenFilter = optionalColumns.has('ORIGEN') ? " AND PC.ORIGEN = 'A'" : '';
    const generatedFilter = buildAppOrderGeneratedDocumentFilter(optionalColumns, 'PC');
    const appDateFilters = buildAppOrderDateFilters(context, 'PC');

    const sql = `
      WITH APP_DOCS AS (
        SELECT
          TRIM(PC.CODIGOCLIENTE) AS CLIENTE,
          COALESCE(NULLIF(TRIM(PC.NOMBRECLIENTE), ''), TRIM(PC.CODIGOCLIENTE)) AS NOMBRE,
          PC.ID AS PEDIDO_ID,
          TRIM(PC.SERIEPEDIDO) || '-' || TRIM(CAST(PC.NUMEROPEDIDO AS VARCHAR(20))) AS DOC_KEY,
          COALESCE(PC.IMPORTETOTAL, 0) AS IMPORTE_TOTAL
        FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
        WHERE PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
          AND PC.IMPORTETOTAL > 0
          AND TRIM(PC.CODIGOCLIENTE) <> ''
          ${origenFilter}
          ${generatedFilter}
          ${appDateFilters.clause}
          ${vendorAccess.clause}
      ), APP_PAID AS (
        SELECT D.CLIENTE, D.PEDIDO_ID, D.DOC_KEY, D.NOMBRE, D.IMPORTE_TOTAL,
               COALESCE(SUM(C.IMPORTECOBRADO), 0) AS IMPORTE_COBRADO
          FROM APP_DOCS D
          LEFT JOIN ${COBROS_LIN_TABLE} C
            ON TRIM(C.CLIENTE) = D.CLIENTE
           AND TRIM(C.DOCUMENTOSERIE) || '-' || TRIM(CAST(C.DOCUMENTONUMERO AS VARCHAR(20))) = D.DOC_KEY
         GROUP BY D.CLIENTE, D.PEDIDO_ID, D.DOC_KEY, D.NOMBRE, D.IMPORTE_TOTAL
      ), APP_NET AS (
        SELECT CLIENTE, NOMBRE,
               CASE WHEN IMPORTE_TOTAL - IMPORTE_COBRADO > 0 THEN IMPORTE_TOTAL - IMPORTE_COBRADO ELSE 0 END AS NET_TOTAL
          FROM APP_PAID
      )
      SELECT CLIENTE,
             COALESCE(NULLIF(TRIM(MIN(NOMBRE)), ''), CLIENTE) AS NOMBRE,
             COUNT(*) AS COUNT,
             COALESCE(SUM(NET_TOTAL), 0) AS TOTAL
        FROM APP_NET
       WHERE NET_TOTAL > 0
       GROUP BY CLIENTE
       ORDER BY TOTAL DESC, CLIENTE ASC`;

    try {
      const params = [...appDateFilters.params, ...vendorAccess.params];
      const rows = params.length > 0
        ? await queryWithParams(sql, params, [])
        : await query(sql, false);
      const summary = {};
      let total = 0;
      let clientCount = 0;
      for (const row of rows || []) {
        const code = trim(row.CLIENTE);
        const pending = fromCents(toCents(row.TOTAL));
        if (!code || toCents(pending) <= 0) continue;
        summary[code] = {
          nombre: trim(row.NOMBRE) || code,
          total: pending,
          vencido: 0,
          count: parseInt(row.COUNT, 10) || 0,
          estado: 'PENDIENTE',
          source: 'PEDIDOS_CAB',
        };
        total += pending;
        clientCount += 1;
      }
      return {
        summary,
        grandTotal: fromCents(toCents(total)),
        grandTotalVencido: 0,
        clientCount,
      };
    } catch (error) {
      logger.warn(`[COBROS_REPO] App provisional orders summary skipped: ${error.message}`);
      return { summary: {}, grandTotal: 0, grandTotalVencido: 0, clientCount: 0 };
    }
  }

  /**
   * Get pending payments summary for a vendor (all clients).
   *
   * FIX (2026-05-15): lee la deuda REAL desde DSEDAC.CVC (ERP) en vez de
   * JAVIER.PEDIDOS_CAB. CVC tiene ~730k filas vivas, PEDIDOS_CAB solo 15
   * (datos test). Por eso antes salian todos los clientes con check verde
   * cuando si tenian deuda real visible al entrar al detalle.
   *
   * IBM i ODBC tiene limite practico de ~90 parametros. Con >50 vendor codes
   * embebemos en SQL (codes validados 2-3 chars alfanumericos).
   */
  async getPendingSummary(vendorCode, context = {}) {
    const manager = isManagerContext(context);
    const requested = trim(vendorCode || context.userId || context.userCode);
    if (!requested) {
      throw new CommercialCobrosError('VENDOR_REQUIRED', 'vendedor requerido', 400);
    }
    if (!manager && requested.toUpperCase() === 'ALL') {
      throw new CommercialCobrosError('FORBIDDEN_VENDOR', 'COMERCIAL no puede consultar ALL', 403);
    }

    const userCode = trim(context.userId || context.userCode);
    const isAll = requested.toUpperCase() === 'ALL';
    const contextVendorCodes = normalizeVendorCodeList(
      context.vendedorCodes || context.vendorCodes || [],
    );
    const hasVisibleScope = manager && contextVendorCodes.length > 0;
    const vendorCodes = isAll
      ? (manager ? contextVendorCodes : [])
      : normalizeVendorCodeList(requested);
    if (!manager && vendorCodes.some((code) => !codesMatch(code, userCode))) {
      throw new CommercialCobrosError('FORBIDDEN_VENDOR', 'COMERCIAL solo puede consultar su vendedor', 403);
    }
    if (hasVisibleScope && vendorCodes.some((code) => !contextVendorCodes.some((visible) => codesMatch(code, visible)))) {
      throw new CommercialCobrosError('FORBIDDEN_VENDOR', 'JEFE_VENTAS no puede consultar vendedores fuera de su alcance', 403);
    }

    let vendorClause = '';
    let vendorParams = [];
    if (vendorCodes.length > 0) {
      const cachedClientScope = buildCvcClientScopeFilter(getClientCodesFromCache(vendorCodes.join(',')));
      const scoped = cachedClientScope || buildCvcVendorScopeFilter(vendorCodes);
      vendorClause = scoped.clause;
      vendorParams = scoped.params;
    }
    const docFilters = buildCobrosDocumentFilters(context, 'CVC');
    const queryParams = [...docFilters.params, ...vendorParams];

    // B7: exclude unassigned-client CVC rows from unscoped global summaries (~7.36MÃ¢â€šÂ¬ ERP noise).
    const emptyClientFilter = vendorCodes.length === 0
      ? "AND TRIM(CVC.CODIGOCLIENTEALBARAN) <> ''"
      : '';

    const requestedLimit = parseInt(context.limit, 10);
    const safeLimit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 100;
    const requestedOffset = parseInt(context.offset, 10);
    const hasOffset = Number.isFinite(requestedOffset);
    const safeOffset = hasOffset ? Math.max(requestedOffset, 0) : null;
    const requestedPage = parseInt(context.page, 10);
    const safePage = hasOffset
      ? Math.floor(safeOffset / safeLimit) + 1
      : (Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1);
    const pageOffset = hasOffset ? safeOffset : (safePage - 1) * safeLimit;
    const maxRank = pageOffset + safeLimit;

    // The mobile summary only needs client-level debt; DB2 computes totals and
    // returns the requested client page instead of materializing the portfolio in JS.
    const summarySql = `
      WITH CVC_DOCS AS (
        SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
               TRIM(CVC.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
               TRIM(CAST(CVC.NUMERODOCUMENTO AS VARCHAR(20))) AS NUMERO_DOCUMENTO,
               COALESCE(
                 NULLIF(MIN(TRIM(CLI.NOMBREALTERNATIVO)), ''),
                 MIN(TRIM(CLI.NOMBRECLIENTE)),
                 MIN(TRIM(CVC.CODIGOCLIENTEALBARAN))
               ) AS NOMBRE,
               SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
               SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                    <= (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                     THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO
         FROM DSEDAC.CVC CVC
         LEFT JOIN DSEDAC.CLI CLI
           ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
         WHERE CVC.IMPORTEPENDIENTE > 0.01
           AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
            ${docFilters.clause}
            ${emptyClientFilter}
            ${vendorClause}
          GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN), TRIM(CVC.SERIEDOCUMENTO), TRIM(CAST(CVC.NUMERODOCUMENTO AS VARCHAR(20)))
       ), COBROS_APP AS (
        SELECT D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO,
               COALESCE(SUM(C.IMPORTECOBRADO), 0) AS TOTAL_APP
          FROM CVC_DOCS D
          LEFT JOIN ${COBROS_LIN_TABLE} C
            ON TRIM(C.CLIENTE) = D.CLIENTE
           AND TRIM(C.DOCUMENTOSERIE) = D.SERIE_DOCUMENTO
           AND TRIM(CAST(C.DOCUMENTONUMERO AS VARCHAR(20))) = D.NUMERO_DOCUMENTO
         GROUP BY D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO
       ), REPARTIDOR_APP AS (
        SELECT D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO,
               COALESCE(SUM(R.IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
          FROM CVC_DOCS D
          LEFT JOIN ${APP_SCHEMA}.REPARTIDOR_COBROS R
            ON TRIM(R.CODIGOCLIENTEALBARAN) = D.CLIENTE
           AND TRIM(R.SERIEDOCUMENTO) = D.SERIE_DOCUMENTO
           AND TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20))) = D.NUMERO_DOCUMENTO
         GROUP BY D.CLIENTE, D.SERIE_DOCUMENTO, D.NUMERO_DOCUMENTO
       ), DOC_NET AS (
        SELECT D.CLIENTE, D.NOMBRE, D.TOTAL_PENDIENTE, D.TOTAL_VENCIDO,
               COALESCE(A.TOTAL_APP, 0) + COALESCE(R.TOTAL_REP, 0) AS APP_PAID,
               CASE WHEN D.TOTAL_PENDIENTE - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0) > 0
                    THEN D.TOTAL_PENDIENTE - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0)
                    ELSE 0 END AS NET_TOTAL,
               CASE WHEN D.TOTAL_VENCIDO - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0) > 0
                    THEN CASE WHEN D.TOTAL_PENDIENTE - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0) < D.TOTAL_VENCIDO - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0)
                              THEN D.TOTAL_PENDIENTE - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0)
                              ELSE D.TOTAL_VENCIDO - COALESCE(A.TOTAL_APP, 0) - COALESCE(R.TOTAL_REP, 0) END
                    ELSE 0 END AS NET_VENCIDO
          FROM CVC_DOCS D
          LEFT JOIN COBROS_APP A ON A.CLIENTE = D.CLIENTE AND A.SERIE_DOCUMENTO = D.SERIE_DOCUMENTO AND A.NUMERO_DOCUMENTO = D.NUMERO_DOCUMENTO
          LEFT JOIN REPARTIDOR_APP R ON R.CLIENTE = D.CLIENTE AND R.SERIE_DOCUMENTO = D.SERIE_DOCUMENTO AND R.NUMERO_DOCUMENTO = D.NUMERO_DOCUMENTO
       ), CLIENT_NET AS (
        SELECT CLIENTE, COALESCE(NULLIF(TRIM(MIN(NOMBRE)), ''), CLIENTE) AS NOMBRE,
               SUM(CASE WHEN NET_TOTAL > 0 THEN 1 ELSE 0 END) AS DOC_COUNT,
               SUM(NET_TOTAL) AS TOTAL_PENDIENTE,
               SUM(NET_VENCIDO) AS TOTAL_VENCIDO
          FROM DOC_NET
         GROUP BY CLIENTE
        HAVING SUM(NET_TOTAL) > 0
       ), SCOPE_TOTALS AS (
        SELECT COALESCE(SUM(NET_TOTAL), 0) AS GRAND_TOTAL,
               COALESCE(SUM(NET_VENCIDO), 0) AS GRAND_TOTAL_VENCIDO,
               COALESCE(SUM(TOTAL_PENDIENTE), 0) AS CVC_GRAND_TOTAL,
               COALESCE(SUM(TOTAL_VENCIDO), 0) AS CVC_GRAND_TOTAL_VENCIDO,
               COUNT(DISTINCT CASE WHEN NET_TOTAL > 0 THEN CLIENTE ELSE NULL END) AS CLIENT_COUNT,
               COUNT(DISTINCT CASE WHEN NET_VENCIDO > 0 THEN CLIENTE ELSE NULL END) AS VENCIDO_CLIENT_COUNT
          FROM DOC_NET
       ), CLIENT_RANKED AS (
        SELECT C.CLIENTE, C.NOMBRE, C.DOC_COUNT, C.TOTAL_PENDIENTE, C.TOTAL_VENCIDO,
               ROW_NUMBER() OVER (ORDER BY C.TOTAL_PENDIENTE DESC, C.CLIENTE ASC) AS RN
          FROM CLIENT_NET C
       )
       SELECT R.CLIENTE, R.NOMBRE, R.DOC_COUNT, R.TOTAL_PENDIENTE, R.TOTAL_VENCIDO,
              T.GRAND_TOTAL, T.GRAND_TOTAL_VENCIDO, T.CVC_GRAND_TOTAL,
              T.CVC_GRAND_TOTAL_VENCIDO, T.CLIENT_COUNT, T.VENCIDO_CLIENT_COUNT
         FROM SCOPE_TOTALS T
         LEFT JOIN CLIENT_RANKED R ON R.RN > ${pageOffset} AND R.RN <= ${maxRank}
        ORDER BY R.RN
    `;

    const runQuery = queryParams.length > 0
      ? (sql) => queryWithParams(sql, queryParams, [])
      : (sql) => query(sql, false);

    const appOrderContext = {
      ...context,
      vendedorCodes: vendorCodes,
      vendorCodes,
    };
    const [rows, appOrderSummary] = await Promise.all([
      runQuery(summarySql),
      this.getAppOrderPendingSummary(appOrderContext),
    ]);

    const cvcRows = Array.isArray(rows) ? rows : [];
    const cvcEntries = cvcRows.map((r) => {
      const code = trim(r.CLIENTE);
      const cvcTotalCents = toCents(r.TOTAL_PENDIENTE);
      const cvcVencidoCents = toCents(r.TOTAL_VENCIDO);
      return {
        code,
        nombre: trim(r.NOMBRE) || code,
        count: parseInt(r.DOC_COUNT, 10) || 0,
        cvcTotal: fromCents(cvcTotalCents),
        cvcVencido: fromCents(cvcVencidoCents),
        total: fromCents(cvcTotalCents),
        vencido: fromCents(cvcVencidoCents),
      };
    }).filter((entry) => entry.code && toCents(entry.total) > 0);

    const summary = {};
    for (const entry of cvcEntries) {
      const { code, total, vencido } = entry;
      summary[code] = {
        nombre: entry.nombre,
        total,
        vencido,
        count: entry.count,
        estado: vencido > 0 ? 'VENCIDO' : 'PENDIENTE',
      };
    }

    for (const [code, appEntry] of Object.entries(appOrderSummary.summary || {})) {
      if (!summary[code]) {
        summary[code] = {
          nombre: appEntry.nombre || code,
          total: 0,
          vencido: 0,
          count: 0,
          estado: 'AL_DIA',
          source: 'PEDIDOS_CAB',
        };
      }
      summary[code].total = fromCents(toCents(summary[code].total) + toCents(appEntry.total));
      summary[code].vencido = fromCents(toCents(summary[code].vencido) + toCents(appEntry.vencido || 0));
      summary[code].count += parseInt(appEntry.count, 10) || 0;
      summary[code].estado = summary[code].vencido > 0 ? 'VENCIDO' : 'PENDIENTE';
      summary[code].source = summary[code].source === 'PEDIDOS_CAB' ? 'PEDIDOS_CAB' : 'CVC+PEDIDOS_CAB';
    }

    const totalsRow = cvcRows[0] || {};
    const cvcNetTotal = parseFloat(totalsRow.GRAND_TOTAL) || 0;
    const cvcNetVencido = parseFloat(totalsRow.GRAND_TOTAL_VENCIDO) || 0;
    const appOrdersTotal = parseFloat(appOrderSummary.grandTotal) || 0;
    const grandTotal = cvcNetTotal + appOrdersTotal;
    const grandTotalVencido = cvcNetVencido + (parseFloat(appOrderSummary.grandTotalVencido) || 0);
    const cvcGrandTotal = parseFloat(totalsRow.CVC_GRAND_TOTAL) || cvcNetTotal;
    const cvcGrandTotalVencido = parseFloat(totalsRow.CVC_GRAND_TOTAL_VENCIDO) || cvcNetVencido;
    const appAdjustmentsTotal = Math.max(0, cvcGrandTotal - cvcNetTotal);
    const cvcClientCount = parseInt(totalsRow.CLIENT_COUNT, 10) || cvcEntries.length;
    const cvcVencidoClientCount = parseInt(totalsRow.VENCIDO_CLIENT_COUNT, 10) || cvcEntries.filter((entry) => toCents(entry.vencido) > 0).length;
    const appClientCount = parseInt(appOrderSummary.clientCount, 10) || 0;
    const mergedClientCount = Math.max(cvcClientCount, appClientCount, Object.keys(summary).length);
    const returnedDocuments = cvcEntries.length;

    return {
      summary,
      grandTotal: Math.round(grandTotal * 100) / 100,
      grandTotalVencido: Math.round(grandTotalVencido * 100) / 100,
      cvcGrandTotal: Math.round(cvcGrandTotal * 100) / 100,
      cvcGrandTotalVencido: Math.round(cvcGrandTotalVencido * 100) / 100,
      appAdjustmentsTotal: Math.round(appAdjustmentsTotal * 100) / 100,
      appOrdersTotal: Math.round(appOrdersTotal * 100) / 100,
      clientCount: mergedClientCount,
      vencidoClientCount: cvcVencidoClientCount,
      source: appOrdersTotal > 0 ? 'CVC+PEDIDOS_CAB' : 'CVC',
      pagination: {
        limit: safeLimit,
        page: safePage,
        offset: pageOffset,
        returnedDocuments,
      },
    };
  }

  async getAppSideCobrosByDocForVendorScope(vendorClause, queryParams) {
    const adjustments = new Map();
    const add = (clientCode, docKey, amount) => {
      const client = trim(clientCode);
      const doc = trim(docKey);
      if (!client || !doc) return;
      const key = client + '|' + doc;
      adjustments.set(key, (adjustments.get(key) || 0) + (parseFloat(amount) || 0));
    };

    const runQuery = queryParams.length > 0
      ? (sql, params) => queryWithParams(sql, params, [])
      : (sql) => query(sql, false);

    try {
      const comercialSql = `
        SELECT TRIM(C.CLIENTE) AS CLIENTE,
               TRIM(C.DOCUMENTOSERIE) || '-' || TRIM(CAST(C.DOCUMENTONUMERO AS VARCHAR(20))) AS REF,
               COALESCE(SUM(C.IMPORTECOBRADO), 0) AS TOTAL_APP
          FROM ${COBROS_LIN_TABLE} C
         WHERE EXISTS (
           SELECT 1
            FROM DSEDAC.CVC CVC
             WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(C.CLIENTE)
              AND CVC.IMPORTEPENDIENTE > 0.01
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${vendorClause}
         )
         GROUP BY TRIM(C.CLIENTE), TRIM(C.DOCUMENTOSERIE), TRIM(CAST(C.DOCUMENTONUMERO AS VARCHAR(20)))`;
      const rows = await runQuery(comercialSql, queryParams);
      for (const row of rows || []) {
        add(row.CLIENTE, normalizeCobrosDocReference(row.REF), row.TOTAL_APP);
      }
    } catch (error) {
      logger.warn('[COBROS_REPO] App-side COBROS portfolio subtract skipped: ' + error.message);
    }

    try {
      const repartidorSql = `
        SELECT TRIM(R.CODIGOCLIENTEALBARAN) AS CLIENTE,
               TRIM(R.TIPODOCUMENTO) AS TIPO_DOCUMENTO,
               TRIM(R.ORIGENDOCUMENTO) AS ORIGEN_DOCUMENTO,
               TRIM(R.SUBEMPRESADOCUMENTO) AS SUBEMPRESA,
               R.EJERCICIODOCUMENTO AS EJERCICIO_DOCUMENTO,
               TRIM(R.SERIEDOCUMENTO) AS SERIE,
               R.TERMINALDOCUMENTO AS TERMINAL_DOCUMENTO,
               TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20))) AS NUMERO,
               R.XDEDOCUMENTO AS XDE,
               R.DEXDOCUMENTO AS DEX,
               COALESCE(SUM(R.IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
          FROM ${APP_SCHEMA}.REPARTIDOR_COBROS R
         WHERE EXISTS (
           SELECT 1
             FROM DSEDAC.CVC CVC
            WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(R.CODIGOCLIENTEALBARAN)
              AND TRIM(CVC.SERIEDOCUMENTO) = TRIM(R.SERIEDOCUMENTO)
              AND TRIM(CAST(CVC.NUMERODOCUMENTO AS VARCHAR(20))) = TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20)))
              AND CVC.IMPORTEPENDIENTE > 0.01
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${vendorClause}
         )
         GROUP BY TRIM(R.CODIGOCLIENTEALBARAN), TRIM(R.TIPODOCUMENTO), TRIM(R.ORIGENDOCUMENTO),
                  TRIM(R.SUBEMPRESADOCUMENTO), R.EJERCICIODOCUMENTO, TRIM(R.SERIEDOCUMENTO),
                  R.TERMINALDOCUMENTO, TRIM(CAST(R.NUMERODOCUMENTO AS VARCHAR(20))),
                  R.XDEDOCUMENTO, R.DEXDOCUMENTO`;
      const rows = await runQuery(repartidorSql, queryParams);
      for (const row of rows || []) {
        add(row.CLIENTE, cvcPrimaryDocKey(row), row.TOTAL_REP);
      }
    } catch (error) {
      logger.warn('[COBROS_REPO] App-side REPARTIDOR_COBROS portfolio subtract skipped: ' + error.message);
    }

    return adjustments;
  }

  async getAppSideCobrosByClient(vendorClause, queryParams) {
    const adjustments = new Map();
    const add = (clientCode, amount) => {
      const code = trim(clientCode);
      if (!code) return;
      adjustments.set(code, (adjustments.get(code) || 0) + (parseFloat(amount) || 0));
    };

    try {
      const comercialSql = `
        SELECT TRIM(C.CLIENTE) AS CLIENTE,
               COALESCE(SUM(C.IMPORTECOBRADO), 0) AS TOTAL_APP
          FROM ${COBROS_CAB_TABLE} C
         WHERE EXISTS (
           SELECT 1
            FROM DSEDAC.CVC CVC
             WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(C.CLIENTE)
              AND CVC.IMPORTEPENDIENTE > 0.01
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${vendorClause}
         )
         GROUP BY TRIM(C.CLIENTE)`;
      const rows = queryParams.length > 0
        ? await queryWithParams(comercialSql, queryParams, [])
        : await query(comercialSql, false);
      for (const row of rows || []) add(row.CLIENTE, row.TOTAL_APP);
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side COBROS summary subtract skipped: ${error.message}`);
    }

    try {
      const repartidorSql = `
        SELECT TRIM(R.CODIGOCLIENTEALBARAN) AS CLIENTE,
               COALESCE(SUM(R.IMPORTEVENCIMIENTO), 0) AS TOTAL_APP
          FROM ${APP_SCHEMA}.REPARTIDOR_COBROS R
         WHERE EXISTS (
           SELECT 1
            FROM DSEDAC.CVC CVC
            WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(R.CODIGOCLIENTEALBARAN)
              AND CVC.IMPORTEPENDIENTE > 0.01
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${vendorClause}
         )
         GROUP BY R.CODIGOCLIENTEALBARAN`;
      const rows = queryParams.length > 0
        ? await queryWithParams(repartidorSql, queryParams, [])
        : await query(repartidorSql, false);
      for (const row of rows || []) add(row.CLIENTE, row.TOTAL_APP);
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side REPARTIDOR_COBROS summary subtract skipped: ${error.message}`);
    }

    return adjustments;
  }

  async getAppSideRepartidorByDoc(clientCode) {
    const repartidorByDoc = new Map();
    try {
      const repartidorRows = await queryWithParams(
        `SELECT TRIM(TIPODOCUMENTO) AS TIPO_DOCUMENTO,
                TRIM(ORIGENDOCUMENTO) AS ORIGEN_DOCUMENTO,
                TRIM(SUBEMPRESADOCUMENTO) AS SUBEMPRESA,
                EJERCICIODOCUMENTO AS EJERCICIO_DOCUMENTO,
                TRIM(SERIEDOCUMENTO) AS SERIE,
                TERMINALDOCUMENTO AS TERMINAL_DOCUMENTO,
                NUMERODOCUMENTO AS NUMERO,
                XDEDOCUMENTO AS XDE,
                DEXDOCUMENTO AS DEX,
                COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL
           FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
          WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
          GROUP BY TIPODOCUMENTO, ORIGENDOCUMENTO, SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO,
                   SERIEDOCUMENTO, TERMINALDOCUMENTO, NUMERODOCUMENTO, XDEDOCUMENTO, DEXDOCUMENTO`,
        [trim(clientCode)],
        [],
      );
      for (const row of repartidorRows || []) {
        const docKey = cvcPrimaryDocKey(row);
        repartidorByDoc.set(docKey, (repartidorByDoc.get(docKey) || 0) + (parseFloat(row.TOTAL) || 0));
      }
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side REPARTIDOR_COBROS doc subtract skipped: ${error.message}`);
    }
    return repartidorByDoc;
  }

  async getAppSideCobrosByDoc(clientCode) {
    const byDoc = new Map();

    try {
      const comercialRows = await queryWithParams(
        `SELECT TRIM(DOCUMENTOSERIE) || '-' || TRIM(CAST(DOCUMENTONUMERO AS VARCHAR(20))) AS REF,
                COALESCE(SUM(IMPORTECOBRADO), 0) AS TOTAL
           FROM ${COBROS_LIN_TABLE}
          WHERE TRIM(CLIENTE) = ?
          GROUP BY TRIM(DOCUMENTOSERIE), TRIM(CAST(DOCUMENTONUMERO AS VARCHAR(20)))`,
        [trim(clientCode)],
        [],
      );
      for (const row of comercialRows || []) {
        const docKey = normalizeCobrosDocReference(row.REF);
        byDoc.set(docKey, (byDoc.get(docKey) || 0) + (parseFloat(row.TOTAL) || 0));
      }
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side COBROS doc subtract skipped: ${error.message}`);
    }

    return byDoc;
  }

  /**
   * Register a payment
   */
  async registerPayment({
    clientCode,
    amount,
    paymentMethod,
    reference,
    observations,
    userId,
    userRole = 'COMERCIAL',
    isJefeVentas = false,
    idempotencyToken,
    allowOverpay = false,
    overrideReason = '',
  }) {
    await this.ensureCobrosTable();
    const normalizedIdempotencyToken = normalizeToken(idempotencyToken);
    const id = paymentIdFromIdempotencyToken(normalizedIdempotencyToken);
    const normalizedClient = trim(clientCode);
    const normalizedReference = trim(reference);
    const normalizedPaymentMethod = trim(paymentMethod || 'CONTADO') || 'CONTADO';
    const normalizedUserId = trim(userId);
    const amountCents = toCents(amount);
    if (!normalizedClient || !normalizedReference || amountCents <= 0) {
      throw new CommercialCobrosError('INVALID_PAYMENT_PAYLOAD', 'cliente, referencia e importe positivo requeridos', 400);
    }

    // ponytail: no LOCK TABLE / manual tx — legacy route uses queryWithParams; pool tx fails on IBM i ODBC.
    const order = await this.findOrderForPayment(normalizedClient, normalizedReference);
    if (!order) {
      throw new CommercialCobrosError('ORDER_NOT_FOUND_FOR_PAYMENT', 'Pedido pendiente no encontrado para el cobro', 404);
    }

    const manager = isManagerContext({ userRole, isJefeVentas });
    if (!manager && !codesMatch(order.CODIGOVENDEDOR, normalizedUserId)) {
      throw new CommercialCobrosError('FORBIDDEN_CLIENT_VENDOR', 'El comercial no puede cobrar pedidos de otro vendedor', 403);
    }

    const stableReference = stableOrderReference(order);
    const legacyReference = legacyOrderReference(order);
    const isCvcOrder = trim(order.SOURCE).toUpperCase() === 'CVC';
    const cvcStableReference = parseCvcStableReference(stableReference);
    const cvcLegacyIsSafe = !isCvcOrder || !cvcStableReference || ((parseInt(order.LEGACY_COLLISION_COUNT, 10) || 1) <= 1);
    const payloadHash = requestHash({
      clientCode: normalizedClient,
      reference: stableReference,
      amountCents,
      paymentMethod: normalizedPaymentMethod,
      userId: normalizedUserId,
    });
    const existingRows = await this.findCobroIdempotencyRows(id, normalizedIdempotencyToken);
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (trim(existing.REQUEST_HASH) !== payloadHash) {
        throw new CommercialCobrosError('IDEMPOTENCY_CONFLICT', 'Token de idempotencia reutilizado con otro payload', 409);
      }
      return {
        id,
        clientCode: normalizedClient,
        amount: fromCents(amountCents),
        paymentMethod: normalizedPaymentMethod,
        reference: stableReference,
        status: 'REGISTRADO',
        idempotent: true,
      };
    }

    const paymentReferences = [stableReference];
    if (legacyReference && cvcLegacyIsSafe) {
      paymentReferences.push(legacyReference);
      if (isCvcOrder) paymentReferences.push(`CVC:${legacyReference}`);
    }
    const uniquePaymentReferences = [...new Set(paymentReferences.map(trim).filter(Boolean))];
    const scope = cobrosScope();
    const docKey = documentKeyForLine(order, scope);
    const paidRows = await queryWithParams(
      `SELECT COALESCE(SUM(IMPORTECOBRADO), 0) AS TOTAL_COBRADO
         FROM ${COBROS_LIN_TABLE}
        WHERE TRIM(CLIENTE) = ?
          AND DOCUMENTOSUBEMPRESA = ?
          AND DOCUMENTOEJERCICIO = ?
          AND DOCUMENTOSERIE = ?
          AND DOCUMENTOTERMINAL = ?
          AND DOCUMENTONUMERO = ?`,
      [normalizedClient, docKey.subempresa, docKey.ejercicio, docKey.serie, docKey.terminal, docKey.numero],
      [],
    );
    const paidComercialCents = toCents(paidRows?.[0]?.TOTAL_COBRADO);

    let paidRepartidorCents = 0;
    try {
      let repartidorSql = `SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
           FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
          WHERE TRIM(CODIGOCLIENTEALBARAN) = ?`;
      let repartidorParams = [normalizedClient];
      if (cvcStableReference) {
        repartidorSql += `
            AND COALESCE(TRIM(TIPODOCUMENTO), '') = ?
            AND COALESCE(TRIM(ORIGENDOCUMENTO), '') = ?
            AND COALESCE(TRIM(SUBEMPRESADOCUMENTO), '') = ?
            AND COALESCE(EJERCICIODOCUMENTO, 0) = ?
            AND TRIM(SERIEDOCUMENTO) = ?
            AND COALESCE(TERMINALDOCUMENTO, 0) = ?
            AND NUMERODOCUMENTO = ?
            AND COALESCE(XDEDOCUMENTO, 0) = ?
            AND COALESCE(DEXDOCUMENTO, 0) = ?`;
        repartidorParams.push(
          cvcStableReference.tipoDocumento,
          cvcStableReference.origenDocumento,
          cvcStableReference.subempresa,
          parseInt(cvcStableReference.ejercicioDocumento, 10) || 0,
          cvcStableReference.serie,
          parseInt(cvcStableReference.terminalDocumento, 10) || 0,
          parseInt(cvcStableReference.numero, 10) || 0,
          parseInt(cvcStableReference.xde, 10) || 0,
          parseInt(cvcStableReference.dex, 10) || 0,
        );
      } else {
        const docRef = parseDocReference(legacyReference);
        repartidorSql += `
            AND TRIM(SERIEDOCUMENTO) = ?
            AND NUMERODOCUMENTO = ?`;
        repartidorParams.push(docRef.serie, docRef.numero);
      }
      const repartidorRows = await queryWithParams(repartidorSql, repartidorParams, []);
      paidRepartidorCents = toCents(repartidorRows?.[0]?.TOTAL_REP);
      if (paidRepartidorCents > 0) {
        logger.info(`[COBROS_REPO] Cross-table REPARTIDOR_COBROS ya tiene ${paidRepartidorCents}c para ${normalizedClient}/${stableReference}`);
      }
    } catch (xtableErr) {
      logger.warn(`[COBROS_REPO] Cross-table REPARTIDOR_COBROS check fallo (continuando): ${xtableErr.message}`);
    }

    const totalAlreadyPaidCents = paidComercialCents + paidRepartidorCents;
    const pendingBeforeCents = toCents(order.IMPORTETOTAL) - totalAlreadyPaidCents;
    if (pendingBeforeCents <= 0) {
      const source = paidRepartidorCents > 0 ? 'REPARTIDOR' : 'COMERCIAL';
      throw new CommercialCobrosError(
        'PAYMENT_ALREADY_REGISTERED',
        paidRepartidorCents > 0
          ? `El pedido ya esta cobrado por ${source} (entrega al cliente)`
          : 'El pedido ya esta cobrado',
        409,
      );
    }
    const pendingAfterCents = pendingBeforeCents - amountCents;
    if (pendingAfterCents < 0) {
      if (!manager || allowOverpay !== true) {
        throw new CommercialCobrosError('OVERPAY_NOT_ALLOWED', 'El importe supera el pendiente', 409);
      }
      if (!trim(overrideReason)) {
        throw new CommercialCobrosError('OVERRIDE_REASON_REQUIRED', 'Motivo obligatorio para sobrecobro', 400);
      }
      logger.warn(`[AUDIT] COMMERCIAL_OVERPAY_APPROVED order=${order.ID} user=${normalizedUserId} amount=${fromCents(amountCents)} pending=${fromCents(pendingBeforeCents)}`);
    }

    const insertPayload = {
      id,
      idempotencyToken: normalizedIdempotencyToken,
      payloadHash,
      scope,
      docKey,
      normalizedClient,
      stableReference,
      amount: fromCents(amountCents),
      paymentMethod: normalizedPaymentMethod,
      tipoVenta: 'CC',
      tipoModo: pendingAfterCents < 0 ? 'SOBRECOBRO' : 'NORMAL',
      tipoUsuario: manager ? 'JEFE_VENTAS' : 'COMERCIAL',
      codigoUsuario: normalizedUserId,
      observations: trim(observations || overrideReason).substring(0, 255),
    };
    try {
      await this.insertRuntimeCobro(insertPayload);
    } catch (insertErr) {
      const msg = String(insertErr.message || '');
      if (/DUPLICATE|PRIMARY|UNIQUE|SQL0803/i.test(msg)) {
        const replayRows = await this.findCobroIdempotencyRows(id, normalizedIdempotencyToken);
        if (replayRows.length > 0) {
          const existing = replayRows[0];
          if (trim(existing.REQUEST_HASH) !== payloadHash) {
            throw new CommercialCobrosError('IDEMPOTENCY_CONFLICT', 'Token de idempotencia reutilizado con otro payload', 409);
          }
          return {
            id,
            clientCode: normalizedClient,
            amount: fromCents(amountCents),
            paymentMethod: normalizedPaymentMethod,
            reference: stableReference,
            status: 'REGISTRADO',
            idempotent: true,
          };
        }
      }
      throw insertErr;
    }

    return {
      id,
      clientCode: normalizedClient,
      amount: fromCents(amountCents),
      paymentMethod: normalizedPaymentMethod,
      reference: stableReference,
      status: statusForPendingCents(pendingAfterCents),
      pendingBefore: fromCents(pendingBeforeCents),
      pendingAfter: fromCents(pendingAfterCents),
      idempotent: false,
    };
  }

  async findCobroIdempotencyRows(id, idempotencyToken) {
    await this.ensureCobrosTable();
    return await queryWithParams(
      `SELECT I.IDEMPOTENCY_TOKEN, I.REQUEST_HASH, I.STATUS,
              C.CLIENTE AS CODIGO_CLIENTE, C.IMPORTECOBRADO AS IMPORTE,
              C.FORMAPAGO AS FORMA_PAGO, C.USUARIO AS CODIGO_USUARIO,
              I.SUBEMPRESA, I.EJERCICIO, I.SERIE, I.TERMINAL, I.NUMERO
         FROM ${COBROS_IDEMPOTENCY_TABLE} I
         LEFT JOIN ${COBROS_CAB_TABLE} C
           ON C.SUBEMPRESA = I.SUBEMPRESA
          AND C.EJERCICIO = I.EJERCICIO
          AND C.SERIE = I.SERIE
          AND C.TERMINAL = I.TERMINAL
          AND C.NUMERO = I.NUMERO
        WHERE I.IDEMPOTENCY_TOKEN IN (?, ?)`,
      [id, idempotencyToken],
      [],
    ) || [];
  }

  async reserveCobroNumero(conn, scope) {
    return withCobrosNumeroLock(scope, async () => {
      const params = [scope.subempresa, scope.ejercicio, scope.serie, scope.terminal];
      const rows = await conn.query(
        `SELECT NEXT_NUMERO
           FROM ${COBROS_COUNTER_TABLE}
          WHERE SUBEMPRESA = ?
            AND EJERCICIO = ?
            AND SERIE = ?
            AND TERMINAL = ?
          FETCH FIRST 1 ROW ONLY`,
        params,
      );
      const numero = parseInt(rows?.[0]?.NEXT_NUMERO, 10);
      if (!Number.isFinite(numero) || numero <= 0) {
        throw supportUnavailable('Servicio de cobros no disponible: contador de cobros no inicializado');
      }
      await conn.query(
        [
          'UPDATE',
          COBROS_COUNTER_TABLE,
          'SET NEXT_NUMERO = NEXT_NUMERO + 1,',
          'UPDATED_AT = CURRENT TIMESTAMP',
          'WHERE SUBEMPRESA = ?',
          'AND EJERCICIO = ?',
          'AND SERIE = ?',
          'AND TERMINAL = ?',
          'AND NEXT_NUMERO = ?',
        ].join('\n'),
        [...params, numero],
      );
      const verifyRows = await conn.query(
        `SELECT NEXT_NUMERO
           FROM ${COBROS_COUNTER_TABLE}
          WHERE SUBEMPRESA = ?
            AND EJERCICIO = ?
            AND SERIE = ?
            AND TERMINAL = ?
          FETCH FIRST 1 ROW ONLY`,
        params,
      );
      if (parseInt(verifyRows?.[0]?.NEXT_NUMERO, 10) !== numero + 1) {
        throw supportUnavailable('Servicio de cobros no disponible: contador de cobros no inicializado');
      }
      return numero;
    });
  }

  async insertRuntimeCobro(payload) {
    const now = new Date();
    const conn = await getPool().connect();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const numero = await this.reserveCobroNumero(conn, payload.scope);
      await conn.query(
        db2InsertSql(COBROS_IDEMPOTENCY_TABLE, [
          'IDEMPOTENCY_TOKEN', 'SUBEMPRESA', 'EJERCICIO', 'SERIE', 'TERMINAL', 'NUMERO',
          'STATUS', 'REQUEST_HASH',
        ]),
        [
          payload.idempotencyToken,
          payload.scope.subempresa,
          payload.scope.ejercicio,
          payload.scope.serie,
          payload.scope.terminal,
          numero,
          'RESERVED',
          payload.payloadHash,
        ],
      );
      await conn.query(
        db2InsertSql(COBROS_CAB_TABLE, [
          'SUBEMPRESA', 'EJERCICIO', 'SERIE', 'TERMINAL', 'NUMERO', 'TIPO',
          'SUBDISTRIBUIDOR', 'CLIENTE', 'VENDEDOR', 'USUARIO', 'FORMAPAGO',
          'NUMEROTALON', 'BANCO', 'FECHAEMISIONDIA', 'FECHAEMISIONMES',
          'FECHAEMISIONANO', 'HORAEMISION', 'FECHAVENCIMIENTODIA',
          'FECHAVENCIMIENTOMES', 'FECHAVENCIMIENTOANO', 'IMPORTECOBRADO',
          'LIQUIDACIONMARCASINCRONIZACION', 'LIQUIDACIONSUBEMPRESA',
          'LIQUIDACIONEJERCICIO', 'LIQUIDACIONSERIE', 'LIQUIDACIONTERMINAL',
          'LIQUIDACIONNUMERO',
        ]),
        [
          payload.scope.subempresa,
          payload.scope.ejercicio,
          payload.scope.serie,
          payload.scope.terminal,
          numero,
          'C',
          '',
          payload.normalizedClient.substring(0, 10),
          payload.codigoUsuario.substring(0, 2),
          payload.codigoUsuario.substring(0, 2),
          cobrosFormaPago(payload.paymentMethod),
          '',
          '',
          now.getDate(),
          now.getMonth() + 1,
          now.getFullYear(),
          currentHhmmss(now),
          now.getDate(),
          now.getMonth() + 1,
          now.getFullYear(),
          payload.amount,
          '',
          '',
          0,
          '',
          0,
          0,
        ],
      );
      await conn.query(
        db2InsertSql(COBROS_LIN_TABLE, [
          'SUBEMPRESA', 'EJERCICIO', 'SERIE', 'TERMINAL', 'NUMERO', 'SECUENCIA',
          'CLIENTE', 'FORMAPAGO', 'BANCONOMBRE', 'BANCOCUENTA',
          'DOCUMENTOSUBEMPRESA', 'DOCUMENTOEJERCICIO', 'DOCUMENTOSERIE',
          'DOCUMENTOTERMINAL', 'DOCUMENTONUMERO', 'IMPORTECOBRADO', 'IMPORTEPENDIENTE',
        ]),
        [
          payload.scope.subempresa,
          payload.scope.ejercicio,
          payload.scope.serie,
          payload.scope.terminal,
          numero,
          1,
          payload.normalizedClient.substring(0, 10),
          cobrosFormaPago(payload.paymentMethod),
          '',
          '',
          payload.docKey.subempresa,
          payload.docKey.ejercicio,
          payload.docKey.serie,
          payload.docKey.terminal,
          payload.docKey.numero,
          payload.amount,
          0,
        ],
      );
      await conn.query(
        [
          'UPDATE', COBROS_IDEMPOTENCY_TABLE,
          "SET STATUS = 'COMPLETED', COMPLETED_AT = CURRENT TIMESTAMP, UPDATED_AT = CURRENT TIMESTAMP",
          'WHERE IDEMPOTENCY_TOKEN = ?',
        ].join(' '),
        [payload.idempotencyToken],
      );
      await conn.query('COMMIT');
    } catch (error) {
      try { await conn.query('ROLLBACK'); } catch (_) { /* rollback best effort */ }
      throw error;
    } finally {
      await conn.close();
    }
  }

  async ensureCobrosTable() {
    try {
      const rows = await queryWithParams(`
        SELECT COUNT(*) AS N
          FROM QSYS2.SYSTABLES
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME IN ('COBROS_CAB', 'COBROS_LIN', 'COBROS_IDEMPOTENCY', 'COBROS_NUMERO_COUNTER')`,
        [APP_SCHEMA],
      );
      if (rows?.[0] && (parseInt(rows[0].N, 10) || 0) < 4) throw supportUnavailable();
    } catch (error) {
      logger.error(`[COBROS] Soporte runtime ${APP_SCHEMA}.COBROS_* no disponible: ${error.message}`);
      throw supportUnavailable();
    }
  }

  async getPaymentsForClient(clientCode) {
    return await queryWithParams(`
      SELECT TRIM(DOCUMENTOSERIE) || '-' || TRIM(CAST(DOCUMENTONUMERO AS VARCHAR(20))) AS REFERENCIA,
             SUM(IMPORTECOBRADO) AS TOTAL_IMPORTE
      FROM ${COBROS_LIN_TABLE}
      WHERE TRIM(CLIENTE) = ?
      GROUP BY TRIM(DOCUMENTOSERIE), TRIM(CAST(DOCUMENTONUMERO AS VARCHAR(20)))
    `, [trim(clientCode)], []) || [];
  }

  async getAllPayments() {
    return await queryWithParams(`
      SELECT TRIM(CLIENTE) AS CODIGO_CLIENTE,
             TRIM(DOCUMENTOSERIE) || '-' || TRIM(CAST(DOCUMENTONUMERO AS VARCHAR(20))) AS REFERENCIA,
             SUM(IMPORTECOBRADO) AS TOTAL_IMPORTE
      FROM ${COBROS_LIN_TABLE}
      GROUP BY TRIM(CLIENTE), TRIM(DOCUMENTOSERIE), TRIM(CAST(DOCUMENTONUMERO AS VARCHAR(20)))
    `, [], []) || [];
  }

  async findOrderForPayment(clientCode, reference) {
    const rows = await queryWithParams(`
      SELECT
        PC.ID,
        'PEDIDOS_CAB' AS SOURCE,
        TRIM(PC.CODIGOCLIENTE) AS CODIGOCLIENTE,
        TRIM(PC.CODIGOVENDEDOR) AS CODIGOVENDEDOR,
        TRIM(PC.SERIEPEDIDO) AS SERIEPEDIDO,
        PC.NUMEROPEDIDO,
        PC.IMPORTETOTAL,
        TRIM(PC.ESTADO) AS ESTADO
      FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
      WHERE TRIM(PC.CODIGOCLIENTE) = ?
        AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
        AND PC.IMPORTETOTAL > 0
        AND (
          TRIM(PC.SERIEPEDIDO) || '-' || TRIM(CAST(PC.NUMEROPEDIDO AS VARCHAR(20))) = ?
          OR 'PEDIDO:' || TRIM(CAST(PC.ID AS VARCHAR(20))) || ':' || TRIM(PC.SERIEPEDIDO) || '-' || TRIM(CAST(PC.NUMEROPEDIDO AS VARCHAR(20))) = ?
        )
      FETCH FIRST 1 ROW ONLY
    `, [clientCode, reference, reference], []);
    if (rows?.[0]) return rows[0];

    const cvcReference = normalizePaymentOrderReference(reference);
    const parsedCvcReference = parseCvcStableReference(reference);
    const cvcRefWhere = parsedCvcReference
      ? `(${cvcReferenceSql('C')} = ?)`
      : `(
          ${cvcLegacyReferenceSql('C')} = ?
          OR 'CVC:' || ${cvcLegacyReferenceSql('C')} = ?
        )`;
    const cvcRefParams = parsedCvcReference
      ? [parsedCvcReference.fullReference]
      : [cvcReference, reference];
    const cvcRows = await queryWithParams(`
      SELECT
        ${cvcReferenceSql('C')} AS ID,
        'CVC' AS SOURCE,
        TRIM(C.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
        COALESCE((
          SELECT TRIM(MIN(CLP.VENDEDORCOMERCIAL))
            FROM DSEDAC.CLP CLP
           WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(C.CODIGOCLIENTEALBARAN)
        ), (
          SELECT TRIM(MIN(${getVendorColumnExpr('LAC')}))
            FROM DSED.LACLAE LAC
           WHERE TRIM(LAC.LCCDCL) = TRIM(C.CODIGOCLIENTEALBARAN)
             AND LAC.LCAADC >= ${MIN_YEAR}
             AND LAC.TPDC = 'LAC'
             AND LAC.LCTPVT IN ('CC', 'VC')
             AND LAC.LCCLLN IN ('AB', 'VT')
             AND LAC.LCSRAB NOT IN ('N', 'Z')
        ), '') AS CODIGOVENDEDOR,
        TRIM(C.TIPODOCUMENTO) AS TIPO_DOCUMENTO,
        TRIM(C.ORIGENDOCUMENTO) AS ORIGEN_DOCUMENTO,
        TRIM(C.SUBEMPRESADOCUMENTO) AS SUBEMPRESA,
        C.EJERCICIODOCUMENTO AS EJERCICIO_DOCUMENTO,
        TRIM(C.SERIEDOCUMENTO) AS SERIEPEDIDO,
        C.TERMINALDOCUMENTO AS TERMINAL_DOCUMENTO,
        C.NUMERODOCUMENTO AS NUMEROPEDIDO,
        C.XDEDOCUMENTO AS XDE,
        C.DEXDOCUMENTO AS DEX,
        C.IMPORTEPENDIENTE AS IMPORTETOTAL,
        'PENDIENTE' AS ESTADO,
        (
          SELECT COUNT(DISTINCT ${cvcReferenceSql('C2')})
            FROM DSEDAC.CVC C2
           WHERE TRIM(C2.CODIGOCLIENTEALBARAN) = TRIM(C.CODIGOCLIENTEALBARAN)
             AND ${cvcLegacyReferenceSql('C2')} = ${cvcLegacyReferenceSql('C')}
             AND C2.IMPORTEPENDIENTE > 0.01
             AND (C2.ANULADOSN IS NULL OR C2.ANULADOSN <> 'S')
        ) AS LEGACY_COLLISION_COUNT
      FROM DSEDAC.CVC C
      WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
        AND C.IMPORTEPENDIENTE > 0.01
        AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
        AND ${cvcRefWhere}
      FETCH FIRST 1 ROW ONLY
    `, [clientCode, ...cvcRefParams], []);
    return cvcRows?.[0] || null;
  }

  /**
   * Get payment history for a client
   */
  async getHistorico({ clientCode, limit = 20, offset = 0 }) {
    await this.ensureCobrosTable();
    // limit/offset llegan saneados desde el adaptador (enteros acotados).
    // Sintaxis DB2 for i: la clausula OFFSET va ANTES de FETCH FIRST.
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const sql = `
      SELECT
        TRIM(C.SUBEMPRESA) || '-' || C.EJERCICIO || '-' || TRIM(C.SERIE) || '-' || C.TERMINAL || '-' || C.NUMERO AS ID,
        C.CLIENTE AS CODIGO_CLIENTE, C.IMPORTECOBRADO AS IMPORTE, C.FORMAPAGO AS FORMA_PAGO,
        TRIM(L.DOCUMENTOSERIE) || '-' || TRIM(CAST(L.DOCUMENTONUMERO AS VARCHAR(20))) AS REFERENCIA,
        '' AS OBSERVACIONES,
        TIMESTAMP_FORMAT(CHAR(C.FECHAEMISIONANO * 10000 + C.FECHAEMISIONMES * 100 + C.FECHAEMISIONDIA), 'YYYYMMDD') AS FECHA
      FROM ${COBROS_CAB_TABLE} C
      LEFT JOIN ${COBROS_LIN_TABLE} L
        ON L.SUBEMPRESA = C.SUBEMPRESA
       AND L.EJERCICIO = C.EJERCICIO
       AND L.SERIE = C.SERIE
       AND L.TERMINAL = C.TERMINAL
       AND L.NUMERO = C.NUMERO
       AND L.SECUENCIA = 1
      WHERE TRIM(C.CLIENTE) = ?
      ORDER BY C.FECHAEMISIONANO DESC, C.FECHAEMISIONMES DESC, C.FECHAEMISIONDIA DESC, C.HORAEMISION DESC
      OFFSET ${safeOffset} ROWS FETCH FIRST ${safeLimit} ROWS ONLY
    `;

    const result = await queryWithParams(sql, [clientCode], []);
    return (result || []).map(mapHistoricoRow);
  }

  /**
   * Get totals by vendor
   */
  async getTotalesByVendor(vendorCode) {
    const sql = `
      SELECT
        COUNT(*) as TOTAL_COBROS,
        SUM(IMPORTECOBRADO) as TOTAL_IMPORTE,
        AVG(IMPORTECOBRADO) as PROMEDIO
          FROM ${COBROS_CAB_TABLE}
          WHERE USUARIO = ?
    `;

    const result = await queryWithParams(sql, [vendorCode], []);
    return result[0] || {};
  }

  async getCommercialMinimumObligation(vendorCode, context = {}) {
    const scope = buildCvcVendorAccessClause({ ...context, userId: vendorCode }, 'CVC');
    const safeDate = trim(context.date);
    const rows = await queryWithParams(`
      WITH COLLECTABLE AS (
        SELECT COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS AMOUNT
          FROM DSEDAC.CVC CVC
         WHERE CVC.IMPORTEPENDIENTE > 0.01
           AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
           ${scope.clause}
      ), REGISTERED AS (
        SELECT COALESCE(SUM(IMPORTECOBRADO), 0) AS AMOUNT
          FROM ${COBROS_CAB_TABLE}
         WHERE TRIM(USUARIO) = ?
           AND (? = '' OR (FECHAEMISIONANO * 10000 + FECHAEMISIONMES * 100 + FECHAEMISIONDIA) = INTEGER(REPLACE(?, '-', '')))
      )
      SELECT INTEGER(ROUND(COLLECTABLE.AMOUNT * 100, 0)) AS COLLECTABLE_CENTS,
             INTEGER(ROUND(REGISTERED.AMOUNT * 100, 0)) AS REGISTERED_CENTS
        FROM COLLECTABLE, REGISTERED`, [...scope.params, trim(vendorCode), safeDate, safeDate], []);
    const row = rows?.[0] || {};
    const collectableCents = Number(row.COLLECTABLE_CENTS) || 0;
    const registeredCents = Number(row.REGISTERED_CENTS) || 0;
    const requiredCents = Math.ceil(collectableCents * 0.6);
    return {
      minimumPercent: 60,
      collectableCents,
      registeredCents,
      requiredCents,
      remainingCents: Math.max(0, requiredCents - registeredCents),
      met: registeredCents >= requiredCents,
    };
  }
}

module.exports = { Db2CobrosRepository };
