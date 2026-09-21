'use strict';

const { queryWithParams } = require('../config/db');
const { comercialErpTable, comercialErpSchemaAndName, comercialErpSnapshotTable, isIsolatedCommercialTest } = require('../utils/comercial-erp-tables');
const { getDebtView } = require('./debt-view-contract');
const logger = require('../middleware/logger');

function trim(value) {
  return String(value == null ? '' : value).trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isGiftLine(line) {
  if (!line || typeof line !== 'object') return false;
  if (line.isAutoGift === true) return true;
  const tipo = trim(line.tipoLinea || line.TIPOLINEA).toUpperCase();
  if (tipo === 'G') return true;
  const clase = trim(line.claseLinea || line.CLASELINEA).toUpperCase();
  const price = toNumber(line.precioVenta ?? line.precio ?? line.PRECIOVENTA);
  return clase === 'SC' && price <= 0;
}

function lineArticle(line) {
  return trim(line.codigoArticulo || line.CODIGOARTICULO).substring(0, 10);
}

function lineBillingQty(line) {
  const unit = trim(line.unidadMedida || line.UNIDADMEDIDA || 'CAJAS').toUpperCase();
  if (unit === 'CAJAS' || unit === '') return toNumber(line.cantidadEnvases || line.CANTIDADENVASES);
  return toNumber(line.cantidadUnidades || line.cantidad || line.CANTIDADUNIDADES);
}

function selectedPromoCodes(lines) {
  return new Set(
    (lines || [])
      .map((line) => trim(line.promotionCode || line.promoCode || line.CODIGOPROMOCION))
      .filter(Boolean),
  );
}

function giftError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  error.statusCode = 409;
  return error;
}

function giftPromoGroups(promotions) {
  const groups = new Map();
  for (const promo of promotions || []) {
    if (trim(promo?.promoType).toUpperCase() !== 'GIFT') continue;
    const code = trim(promo.promoCode || promo.code);
    if (!code || toNumber(promo.minQty) <= 0 || toNumber(promo.giftQty) <= 0) continue;
    const group = groups.get(code) || {
      code, minQty: toNumber(promo.minQty), giftQty: toNumber(promo.giftQty),
      cumulative: promo.cumulative === true, noGiftBought: promo.noGiftBought === true,
      giftSkus: new Set(), rows: [], promoDesc: trim(promo.promoDesc),
    };
    group.minQty = Math.max(group.minQty, toNumber(promo.minQty));
    group.giftQty = Math.max(group.giftQty, toNumber(promo.giftQty));
    group.cumulative = group.cumulative || promo.cumulative === true;
    group.noGiftBought = group.noGiftBought || promo.noGiftBought === true;
    const productCode = trim(promo.productCode);
    if (productCode) group.giftSkus.add(productCode);
    for (const sku of Array.isArray(promo.giftSkus) ? promo.giftSkus : []) {
      const normalized = trim(sku);
      if (normalized) group.giftSkus.add(normalized);
    }
    group.rows.push(promo);
    groups.set(code, group);
  }
  return groups;
}

function validatedGiftQuantity(line) {
  const unit = trim(line.unidadMedida || line.UNIDADMEDIDA || 'CAJAS').toUpperCase();
  if (!['CAJAS', 'UNIDADES'].includes(unit)) {
    throw giftError('INVALID_PROMOTION_GIFT', 'La unidad del regalo no es válida');
  }
  const raw = unit === 'CAJAS'
    ? (line.cantidadEnvases ?? line.CANTIDADENVASES)
    : (line.cantidadUnidades ?? line.cantidad ?? line.CANTIDADUNIDADES);
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw giftError('INVALID_PROMOTION_GIFT', 'La cantidad del regalo debe ser un entero positivo');
  }
  const price = Number(line.precioVenta ?? line.precio ?? line.PRECIOVENTA ?? 0);
  if (!Number.isFinite(price) || price !== 0) {
    throw giftError('INVALID_PROMOTION_GIFT', 'El regalo debe tener precio cero');
  }
  return { unit, quantity };
}

// Server owns promotion entitlement and SKU selection.  A client may select an
// eligible gift, but never invent a promotion, SKU, or quantity.
function applyGiftPromotionsToLines(lines, promotions) {
  const submitted = Array.isArray(lines) ? [...lines] : [];
  const paidLines = submitted.filter((line) => !isGiftLine(line));
  const submittedGifts = submitted.filter(isGiftLine);
  const groups = giftPromoGroups(promotions);
  const giftsByPromo = new Map();

  for (const gift of submittedGifts) {
    const promoCode = trim(gift.promotionCode || gift.promoCode || gift.CODIGOPROMOCION);
    const group = groups.get(promoCode);
    if (!group) throw giftError('INVALID_PROMOTION_GIFT', 'El regalo no pertenece a una promoción activa');
    const sku = lineArticle(gift);
    if (!sku || group.giftSkus.size === 0 || !group.giftSkus.has(sku)) {
      throw giftError('INVALID_PROMOTION_GIFT', 'El artículo regalo no está permitido por la promoción');
    }
    const normalized = validatedGiftQuantity(gift);
    const current = giftsByPromo.get(promoCode) || [];
    current.push({ ...gift, _giftUnit: normalized.unit, _giftQuantity: normalized.quantity });
    giftsByPromo.set(promoCode, current);
  }

  const rebuilt = [...paidLines];
  for (const group of groups.values()) {
    const paidForPromo = paidLines.filter((line) => trim(line.promotionCode || line.promoCode || line.CODIGOPROMOCION) === group.code);
    // Older clients only mark the paid line with the promotion code.  When a
    // PMP set exists, do not let unrelated paid products grant entitlement.
    const selected = giftsByPromo.get(group.code) || [];
    const explicitlySelectedPromo = selected.length > 0;
    const eligiblePaid = paidLines.filter((line) => group.giftSkus.has(lineArticle(line)));
    const qualifying = group.giftSkus.size === 0
      ? paidForPromo
      : (explicitlySelectedPromo ? eligiblePaid : paidForPromo.filter((line) => group.giftSkus.has(lineArticle(line))));
    const paidQty = qualifying.reduce((sum, line) => sum + lineBillingQty(line), 0);
    const entitlement = paidQty + 1e-9 < group.minQty
      ? 0
      : Math.floor((group.cumulative ? Math.floor(paidQty / group.minQty) : 1) * group.giftQty);
    const selectedQty = selected.reduce((sum, line) => sum + line._giftQuantity, 0);
    if (selectedQty > entitlement + 1e-9) {
      throw giftError('INVALID_PROMOTION_GIFT', 'La cantidad de regalo supera el derecho de la promoción');
    }
    const boughtSkus = new Set(qualifying.map(lineArticle));
    if (group.noGiftBought && selected.some((line) => boughtSkus.has(lineArticle(line)))) {
      throw giftError('INVALID_PROMOTION_GIFT', 'La promoción no permite regalar un artículo ya comprado');
    }
    if (selected.length) {
      const sourceLine = qualifying[0];
      rebuilt.push(...selected.map((line) => ({ ...sourceLine, codigoArticulo: lineArticle(line),
        cantidadEnvases: line._giftUnit === 'CAJAS' ? line._giftQuantity : 0,
        cantidadUnidades: line._giftUnit === 'UNIDADES' ? line._giftQuantity : 0,
        unidadMedida: line._giftUnit, precio: 0, precioVenta: 0, descuentoLinea: 0, lineDiscountPct: 0,
        tipoLinea: 'G', claseLinea: 'SC', isAutoGift: true, promotionCode: group.code })));
      continue;
    }
    if (entitlement <= 0) continue;
    const candidates = group.giftSkus.size ? [...group.giftSkus] : qualifying.map(lineArticle);
    const giftArticle = group.noGiftBought
      ? candidates.find((sku) => !boughtSkus.has(sku))
      : qualifying.map(lineArticle).find((sku) => candidates.includes(sku)) || candidates[0];
    if (!giftArticle) {
      throw giftError('GIFT_SELECTION_REQUIRED', 'La promoción requiere seleccionar un artículo regalo válido');
    }
    const sourceLine = qualifying.find((line) => lineArticle(line) === giftArticle) || qualifying[0];
    if (!sourceLine) continue;
    const unit = trim(sourceLine.unidadMedida || 'CAJAS').toUpperCase() || 'CAJAS';
    for (let i = 0; i < entitlement; i += 1) {
      rebuilt.push({ ...sourceLine, codigoArticulo: giftArticle,
        descripcion: `${String(sourceLine.descripcion || group.promoDesc || 'Regalo').slice(0, 28)} (Regalo)`,
        cantidadEnvases: unit === 'CAJAS' ? 1 : 0, cantidadUnidades: unit === 'CAJAS' ? 0 : 1,
        unidadMedida: unit, precio: 0, precioVenta: 0, descuentoLinea: 0, lineDiscountPct: 0,
        tipoLinea: 'G', claseLinea: 'SC', isAutoGift: true, promotionCode: group.code });
    }
  }
  return rebuilt;
}

function minCobroOrderError({ minPct, actualPct, source, clientCode, vendorCode }) {
  const err = new Error(
    `Pedido bloqueado: el cobro de cartera (${actualPct.toFixed(1)}%) no alcanza el minimo ${minPct}% (${source})`,
  );
  err.code = 'MIN_COBRO_ORDER_BLOCKED';
  err.status = 403;
  err.statusCode = 403;
  err.details = { minPct, actualPct, source, clientCode, vendorCode };
  return err;
}

let vddxMinColumn = null;
let clxColumns = null;

async function hasColumn(schemaTable, column) {
  const cols = await queryWithParams(
    `SELECT COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schemaTable.schema, schemaTable.table, column],
    [],
  );
  return Array.isArray(cols) && cols.length > 0;
}

async function resolveMinCobroRule({ clientCode, vendorCode }) {
  const client = trim(clientCode).substring(0, 10);
  const vendor = trim(vendorCode).substring(0, 2);
  const empty = {
    cobroRiguroso: false,
    minPct: 0,
    vendorPct: 0,
    clientPct: 0,
    source: 'NONE',
  };
  if (!client && !vendor) return empty;

  try {
    if (vddxMinColumn == null) {
      vddxMinColumn = await hasColumn(comercialErpSchemaAndName('VDDX'), 'PORCENTAJEMINIMOCOBRO');
    }
    let vendorPct = 0;
    if (vddxMinColumn && vendor) {
      const rows = await queryWithParams(
        `SELECT COALESCE(PORCENTAJEMINIMOCOBRO, 0) AS PCT
           FROM ${comercialErpTable('VDDX')}
          WHERE TRIM(CODIGOVENDEDOR) = ?
          FETCH FIRST 1 ROW ONLY`,
        [vendor],
        [],
      );
      vendorPct = toNumber(rows?.[0]?.PCT);
    }

    if (clxColumns == null) {
      const clx = comercialErpSchemaAndName('CLX');
      const sn = await hasColumn(clx, 'COBRORIGUROSOSN');
      const pct = await hasColumn(clx, 'PORCENTAJECOBRORIGUROSO');
      clxColumns = { sn, pct };
    }

    let cobroRiguroso = false;
    let clientPct = 0;
    if (clxColumns.sn && clxColumns.pct && client) {
      const readClx = (table) => queryWithParams(
        `SELECT TRIM(COBRORIGUROSOSN) AS SN,
                COALESCE(PORCENTAJECOBRORIGUROSO, 0) AS PCT
           FROM ${table}
          WHERE CODIGOCLIENTE = CAST(? AS CHAR(10))
          FETCH FIRST 1 ROW ONLY`,
        [client],
        [],
      );
      let rows = await readClx(comercialErpTable('CLX'));
      let snapshot = false;
      if ((!rows || !rows[0]) && isIsolatedCommercialTest()) {
        rows = await readClx(comercialErpSnapshotTable('CLX'));
        snapshot = Array.isArray(rows) && rows.length > 0;
      }
      cobroRiguroso = trim(rows?.[0]?.SN).toUpperCase() === 'S';
      clientPct = toNumber(rows?.[0]?.PCT);
      if (cobroRiguroso) {
        const minPct = clientPct > 0 ? clientPct : vendorPct;
        return {
          cobroRiguroso: true,
          minPct,
          vendorPct,
          clientPct,
          snapshot,
          source: clientPct > 0
            ? `${snapshot ? comercialErpSnapshotTable('CLX') : comercialErpTable('CLX')}.PORCENTAJECOBRORIGUROSO`
            : `${comercialErpTable('VDDX')}.PORCENTAJEMINIMOCOBRO`,
        };
      }
      return {
        cobroRiguroso: false,
        minPct: vendorPct,
        vendorPct,
        clientPct: 0,
        snapshot,
        source: `${comercialErpTable('VDDX')}.PORCENTAJEMINIMOCOBRO`,
      };
    }
    return {
      cobroRiguroso: false,
      minPct: vendorPct,
      vendorPct,
      clientPct: 0,
      snapshot: false,
      source: `${comercialErpTable('VDDX')}.PORCENTAJEMINIMOCOBRO`,
    };
  } catch (error) {
    logger.warn(`[PEDIDOS] min cobro rule skipped: ${error.message}`);
    return empty;
  }
}

async function carteraCollectionPct({ clientCode, vendorCode, clientScoped, useSnapshot }) {
  const client = trim(clientCode).substring(0, 10);
  const vendor = trim(vendorCode).substring(0, 2);
  const view = useSnapshot === true
    ? comercialErpSnapshotTable('CVC')
    : getDebtView();
  const notCancelled = `(CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')`;
  let sql;
  let params;
  if (clientScoped && client) {
    sql = `
      SELECT COALESCE(SUM(CVC.IMPORTEVENCIMIENTO), 0) AS TOTAL_DOC,
             COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS PENDIENTE
        FROM ${view} CVC
       WHERE CVC.CODIGOCLIENTEALBARAN = CAST(? AS CHAR(10))
         AND ${notCancelled}
    `;
    params = [client];
  } else if (vendor) {
    sql = `
      SELECT COALESCE(SUM(CVC.IMPORTEVENCIMIENTO), 0) AS TOTAL_DOC,
             COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS PENDIENTE
        FROM ${view} CVC
       WHERE TRIM(CVC.CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
         AND ${notCancelled}
    `;
    params = [vendor];
  } else {
    return { total: 0, pending: 0, pct: 100 };
  }

  const rows = await queryWithParams(sql, params, []);
  const total = toNumber(rows?.[0]?.TOTAL_DOC);
  const pending = toNumber(rows?.[0]?.PENDIENTE);
  if (total <= 0) return { total: 0, pending: 0, pct: 100 };
  const collected = Math.max(0, total - pending);
  return {
    total,
    pending,
    pct: Math.round((collected / total) * 10000) / 100,
  };
}

async function evaluateMinCobroOrderGate({ clientCode, vendorCode }) {
  const rule = await resolveMinCobroRule({ clientCode, vendorCode });
  if (!rule.minPct || rule.minPct <= 0) {
    return { ...rule, actualPct: 100, blocked: false, total: 0 };
  }
  const cartera = await carteraCollectionPct({
    clientCode,
    vendorCode,
    clientScoped: rule.cobroRiguroso === true,
    useSnapshot: rule.snapshot === true,
  });
  if (cartera.total <= 0) {
    return { ...rule, actualPct: 100, blocked: false, total: 0 };
  }
  const blocked = cartera.pct + 0.0001 < rule.minPct;
  return {
    ...rule,
    actualPct: cartera.pct,
    total: cartera.total,
    pending: cartera.pending,
    blocked,
  };
}

async function assertMinCobroAllowsOrder({ clientCode, vendorCode }) {
  const gate = await evaluateMinCobroOrderGate({ clientCode, vendorCode });
  if (gate.blocked) {
    throw minCobroOrderError({
      minPct: gate.minPct,
      actualPct: gate.actualPct,
      source: gate.source,
      clientCode,
      vendorCode,
    });
  }
  return gate;
}

function capPendingToDocument(pendingAmount, documentAmount) {
  const pending = toNumber(pendingAmount);
  const document = toNumber(documentAmount);
  if (document <= 0) return Math.max(0, pending);
  return Math.max(0, Math.min(pending, document));
}

function resetMinCobroColumnCache() {
  vddxMinColumn = null;
  clxColumns = null;
}

module.exports = {
  isGiftLine,
  applyGiftPromotionsToLines,
  evaluateMinCobroOrderGate,
  assertMinCobroAllowsOrder,
  resolveMinCobroRule,
  capPendingToDocument,
  resetMinCobroColumnCache,
};
