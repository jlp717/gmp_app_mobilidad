'use strict';

const { queryWithParams } = require('../config/db');
const { comercialErpTable, comercialErpSchemaAndName } = require('../utils/comercial-erp-tables');
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

function applyGiftPromotionsToLines(lines, promotions) {
  const next = Array.isArray(lines) ? [...lines] : [];
  const selected = selectedPromoCodes(next);
  const gifts = (promotions || []).filter((promo) => {
    const type = trim(promo.promoType).toUpperCase();
    return type === 'GIFT' && toNumber(promo.minQty) > 0 && toNumber(promo.giftQty) > 0;
  });

  for (const promo of gifts) {
    const promoCode = trim(promo.promoCode || promo.code);
    const productCode = trim(promo.productCode);
    const giftSkus = Array.isArray(promo.giftSkus) ? promo.giftSkus.map(trim).filter(Boolean) : [];
    const matchArticle = (article) => {
      if (productCode && article === productCode) return true;
      if (giftSkus.includes(article)) return true;
      if (!productCode && giftSkus.length === 0 && selected.has(promoCode)) return true;
      return false;
    };

    const already = next.some((line) => (
      isGiftLine(line)
      && (
        (promoCode && trim(line.promotionCode || line.promoCode) === promoCode)
        || (productCode && lineArticle(line) === productCode)
      )
    ));
    if (already) continue;

    const saleQty = next
      .filter((line) => !isGiftLine(line) && matchArticle(lineArticle(line)))
      .reduce((sum, line) => sum + lineBillingQty(line), 0);
    if (saleQty + 1e-9 < toNumber(promo.minQty)) continue;

    const multiplier = promo.cumulative === true ? Math.floor(saleQty / toNumber(promo.minQty)) : 1;
    const giftCount = Math.floor(multiplier * toNumber(promo.giftQty));
    if (giftCount <= 0) continue;

    const sourceLine = next.find((line) => !isGiftLine(line) && matchArticle(lineArticle(line)))
      || next.find((line) => !isGiftLine(line));
    if (!sourceLine) continue;
    const giftArticle = productCode || lineArticle(sourceLine);
    const unit = trim(sourceLine.unidadMedida || 'CAJAS').toUpperCase() || 'CAJAS';
    const desc = `${String(sourceLine.descripcion || promo.promoDesc || 'Regalo').slice(0, 28)} (Regalo)`;
    for (let i = 0; i < giftCount; i += 1) {
      next.push({
        ...sourceLine,
        codigoArticulo: giftArticle,
        descripcion: desc,
        cantidadEnvases: unit === 'CAJAS' ? 1 : 0,
        cantidadUnidades: unit === 'CAJAS' ? 0 : 1,
        unidadMedida: unit,
        precio: 0,
        precioVenta: 0,
        descuentoLinea: 0,
        lineDiscountPct: 0,
        tipoLinea: 'G',
        claseLinea: 'SC',
        isAutoGift: true,
        promotionCode: promoCode,
      });
    }
  }
  return next;
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
      const rows = await queryWithParams(
        `SELECT TRIM(COBRORIGUROSOSN) AS SN,
                COALESCE(PORCENTAJECOBRORIGUROSO, 0) AS PCT
           FROM ${comercialErpTable('CLX')}
          WHERE CODIGOCLIENTE = CAST(? AS CHAR(10))
          FETCH FIRST 1 ROW ONLY`,
        [client],
        [],
      );
      cobroRiguroso = trim(rows?.[0]?.SN).toUpperCase() === 'S';
      clientPct = toNumber(rows?.[0]?.PCT);
    }

    if (cobroRiguroso) {
      const minPct = clientPct > 0 ? clientPct : vendorPct;
      return {
        cobroRiguroso: true,
        minPct,
        vendorPct,
        clientPct,
        source: clientPct > 0
          ? `${comercialErpTable('CLX')}.PORCENTAJECOBRORIGUROSO`
          : `${comercialErpTable('VDDX')}.PORCENTAJEMINIMOCOBRO`,
      };
    }
    return {
      cobroRiguroso: false,
      minPct: vendorPct,
      vendorPct,
      clientPct: 0,
      source: `${comercialErpTable('VDDX')}.PORCENTAJEMINIMOCOBRO`,
    };
  } catch (error) {
    logger.warn(`[PEDIDOS] min cobro rule skipped: ${error.message}`);
    return empty;
  }
}

async function carteraCollectionPct({ clientCode, vendorCode, clientScoped }) {
  const client = trim(clientCode).substring(0, 10);
  const vendor = trim(vendorCode).substring(0, 2);
  const view = getDebtView();
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
