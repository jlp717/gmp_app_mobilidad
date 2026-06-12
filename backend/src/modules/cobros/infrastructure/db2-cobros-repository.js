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

const APP_SCHEMA = getDb2WriteSchema();
const COBROS_TABLE = db2QualifiedTable(APP_SCHEMA, 'COBROS');
const COBROS_HEALTHCHECK_SQL = ['SELECT 1 FROM', COBROS_TABLE, 'FETCH FIRST 1 ROW ONLY'].join(' ');

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

function buildCobroInsert({
  id,
  normalizedClient,
  stableReference,
  amount,
  paymentMethod,
  tipoVenta,
  tipoModo,
  tipoUsuario,
  codigoUsuario,
  observations,
  includeErpColumns,
}) {
  const columns = [
    'ID', 'CODIGO_CLIENTE', 'REFERENCIA', 'IMPORTE', 'FORMA_PAGO',
    'TIPO_VENTA', 'TIPO_MODO', 'TIPO_USUARIO', 'CODIGO_USUARIO',
    'OBSERVACIONES',
  ];
  const params = [
    id,
    normalizedClient,
    stableReference,
    amount,
    paymentMethod,
    tipoVenta,
    tipoModo,
    tipoUsuario,
    codigoUsuario,
    observations,
  ];

  if (includeErpColumns) {
    const now = new Date();
    columns.push(
      'SUBEMPRESARECIBO', 'EJERCICIORECIBO', 'SERIERECIBO', 'TERMINALRECIBO',
      'CODIGOCLIENTEFACTURA', 'CODIGOVENDEDOR', 'TIPORECIBO',
      'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
      'IMPORTECOBRADO', 'IDMARCALIQUIDACION',
    );
    params.push(
      String(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP').substring(0, 3),
      now.getFullYear(),
      String(process.env.PEDIDOS_SYSTEM_SERIE || 'R').substring(0, 1),
      parseInt(process.env.PEDIDOS_SYSTEM_TERMINAL || '10', 10),
      String(normalizedClient || '').padEnd(10).slice(0, 10),
      String(codigoUsuario || '').padEnd(2).slice(0, 2),
      'C',
      now.getDate(),
      now.getMonth() + 1,
      now.getFullYear(),
      currentHhmmss(now),
      amount,
      String(id).slice(0, 30),
    );
  }

  return {
    sql: db2InsertSql(COBROS_TABLE, columns),
    params,
  };
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

function legacyOrderReference(order) {
  return `${trim(order.SERIEPEDIDO)}-${trim(order.NUMERODOCUMENTO || order.NUMEROPEDIDO)}`;
}

function formatRepartidorDocKey(serie, numero) {
  return `${trim(serie)}-${trim(numero)}`;
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
    return `CVC:${legacyOrderReference(order)}`;
  }
  return `PEDIDO:${trim(order.ID)}:${legacyOrderReference(order)}`;
}

function normalizePaymentOrderReference(value) {
  const reference = trim(value);
  const stableMatch = reference.match(/^(?:PEDIDO:[^:]+:|CVC:)(.+)$/);
  return stableMatch ? stableMatch[1] : reference;
}

function paymentMatchesOrder(paymentReference, order) {
  const reference = trim(paymentReference);
  const legacy = legacyOrderReference(order);
  return reference === stableOrderReference(order) || normalizePaymentOrderReference(reference) === legacy;
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

  if (safeCodes.length <= 50) {
    return {
      clause: `
          AND EXISTS (
            SELECT 1
              FROM DSEDAC.CLP CLP
             WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(${cvcAlias}.CODIGOCLIENTEALBARAN)
               AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${safeCodes.map(() => '?').join(',')})
          )`,
      params: safeCodes,
    };
  }

  const literalCodes = safeCodes.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  return {
    clause: `
          AND EXISTS (
            SELECT 1
              FROM DSEDAC.CLP CLP
             WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(${cvcAlias}.CODIGOCLIENTEALBARAN)
               AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${literalCodes})
          )`,
    params: [],
  };
}

function mapCvcRowToCobro(row, appPaid = 0) {
  const serie = trim(row.SERIE_DOCUMENTO);
  const numero = row.NUMERO_DOCUMENTO || 0;
  const xde = row.XDE || 1;
  const tipoDoc = trim(row.TIPO_DOCUMENTO || 'FAC');
  const docKey = `${serie}-${numero}`;
  const fecha = toIsoDate(row.ANO_DOCUMENTO, row.MES_DOCUMENTO, row.DIA_DOCUMENTO);
  const fechaVencimiento = toIsoDate(row.ANO_VENCIMIENTO, row.MES_VENCIMIENTO, row.DIA_VENCIMIENTO);
  const erpPendienteCents = toCents(row.IMPORTE_PENDIENTE);
  const appPaidCents = toCents(appPaid);
  const pendingCents = Math.max(0, erpPendienteCents - appPaidCents);
  const estado = pendingCents <= 1 ? 'COBRADO' : computeEstadoVencimiento(fechaVencimiento);
  return {
    id: `cvc_${serie}_${numero}_${xde}`,
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
      serie,
      numero,
      xde,
      subempresa: trim(row.SUBEMPRESA),
      tipoDocumento: tipoDoc,
    },
    appPaymentApplied: appPaidCents > 0 ? fromCents(appPaidCents) : undefined,
  };
}

class Db2CobrosRepository extends CobrosRepository {
  /**
   * Get pending payments for a client (orders that are CONFIRMADO/ENVIADO but not yet paid)
   * Uses correct column names: DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, IMPORTETOTAL
   */
  async getPendientes(clientCode, context = {}) {
    const cobrosTableExists = await this.ensureCobrosTable();
    const access = buildCvcVendorAccessClause(context, 'C');
    try {
      const cvcSql = `
        SELECT
            TRIM(C.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
            C.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
            C.XDEDOCUMENTO AS XDE,
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
          ${access.clause}
        ORDER BY C.ANOVENCIMIENTO ASC, C.MESVENCIMIENTO ASC, C.DIAVENCIMIENTO ASC
        FETCH FIRST 100 ROWS ONLY`;

      const rows = await queryWithParams(cvcSql, [trim(clientCode), ...access.params], []);
      const appCobrosByDoc = cobrosTableExists
        ? await this.getAppSideCobrosByDoc(clientCode)
        : new Map();
      const cobros = (rows || [])
        .map((row) => mapCvcRowToCobro(
          row,
          appCobrosByDoc.get(`${trim(row.SERIE_DOCUMENTO)}-${row.NUMERO_DOCUMENTO}`) || 0,
        ))
        .filter((cobro) => toCents(cobro.importePendiente) > 0);
      const totalPendiente = cobros.reduce((sum, c) => sum + c.importePendiente, 0);
      const totalVencido = cobros
        .filter((c) => c.estado === 'VENCIDO')
        .reduce((sum, c) => sum + c.importePendiente, 0);
      return {
        cobros,
        resumen: {
          totalPendiente,
          total: totalPendiente,
          totalVencido,
          numDocumentos: cobros.length,
          numVencidos: cobros.filter((c) => c.estado === 'VENCIDO').length,
          documentos: { cantidad: cobros.length, total: totalPendiente },
          source: 'CVC',
        },
      };
    } catch (cvcErr) {
      logger.warn(`[COBROS_REPO] CVC pendientes failed for ${clientCode}; using ${APP_SCHEMA}.PEDIDOS_CAB fallback: ${cvcErr.message}`);
    }

    return this.getAppOrderPendientes(clientCode, context, cobrosTableExists);
  }

  async getAppOrderPendientes(clientCode, context = {}, cobrosTableExists = true) {
    let origenExists = false;
    try {
      const colCheck = await query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS2
        WHERE TABLE_SCHEMA = '${APP_SCHEMA}' AND TABLE_NAME = 'PEDIDOS_CAB' AND COLUMN_NAME = 'ORIGEN'
        FETCH FIRST 1 ROW ONLY
      `);
      origenExists = colCheck && colCheck.length > 0;
    } catch (e) {
      logger.debug('[COBROS_REPO] ORIGEN column detection skipped', {
        schema: APP_SCHEMA,
        table: 'PEDIDOS_CAB',
        column: 'ORIGEN',
        reason: e?.code || e?.message || 'unknown',
      });
    }

    const manager = isManagerContext(context);
    const userCode = trim(context.userId || context.userCode);
    const vendedorFilter = !manager && userCode
      ? ' AND TRIM(PC.CODIGOVENDEDOR) = ?'
      : '';
    const origenFilter = origenExists ? " AND PC.ORIGEN = 'A'" : '';
    const sql = `
      SELECT
        PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
        PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
        PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
      FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
      WHERE TRIM(PC.CODIGOCLIENTE) = ?
        ${origenFilter}
        AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
        AND PC.IMPORTETOTAL > 0
        ${vendedorFilter}
      ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC, PC.DIADOCUMENTO DESC
      FETCH FIRST 100 ROWS ONLY`;

    const orderParams = [trim(clientCode), ...(vendedorFilter ? [userCode] : [])];
    const resultado = await queryWithParams(sql, orderParams, []);
    const payments = cobrosTableExists
      ? await this.getPaymentsForClient(clientCode)
      : [];

    const cobros = (resultado && resultado.length > 0 ? resultado : []).map(row => {
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
      };
    }).filter((cobro) => toCents(cobro.importePendiente) > 0);

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

    const MAX_PARAMS = 50;
    let vendorClause = '';
    let queryParams = [];
    if (vendorCodes.length > 0) {
      if (vendorCodes.length <= MAX_PARAMS) {
        vendorClause = `
          AND EXISTS (
            SELECT 1
              FROM DSEDAC.CLP CLP
             WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
               AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${vendorCodes.map(() => '?').join(',')})
          )`;
        queryParams = vendorCodes;
      } else {
        const safeCodes = vendorCodes
          .filter((v) => /^[A-Za-z0-9]{1,10}$/.test(v))
          .map((v) => `'${v.replace(/'/g, "''")}'`)
          .join(',');
        if (safeCodes) {
          vendorClause = `
          AND EXISTS (
            SELECT 1
              FROM DSEDAC.CLP CLP
             WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
               AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${safeCodes})
          )`;
        }
      }
    }

    // B7: exclude unassigned-client CVC rows from unscoped global summaries (~7.36M€ ERP noise).
    const emptyClientFilter = vendorCodes.length === 0
      ? "AND TRIM(CVC.CODIGOCLIENTEALBARAN) <> ''"
      : '';

    const sql = `
      SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
             COALESCE(NULLIF(TRIM(MIN(CLI.NOMBREALTERNATIVO)), ''), TRIM(MIN(CLI.NOMBRECLIENTE)), '') AS NOMBRE,
             TRIM(CVC.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
             CVC.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
             SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
             SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                 <= (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                  THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO
       FROM DSEDAC.CVC CVC
       LEFT JOIN DSEDAC.CLI CLI
         ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
       WHERE CVC.IMPORTEPENDIENTE <> 0
         AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
         ${emptyClientFilter}
         ${vendorClause}
       GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN), TRIM(CVC.SERIEDOCUMENTO), CVC.NUMERODOCUMENTO
       ORDER BY TOTAL_PENDIENTE DESC
    `;

    const rows = queryParams.length > 0
      ? await queryWithParams(sql, queryParams, [])
      : await query(sql, false);

    const appAdjustments = await this.getAppSideCobrosByDocForSummary(
      vendorClause,
      queryParams,
      emptyClientFilter,
    );

    const summary = {};
    let grandTotal = 0;
    let grandTotalVencido = 0;

    for (const r of rows || []) {
      const code = trim(r.CLIENTE);
      const docKey = `${trim(r.SERIE_DOCUMENTO)}-${r.NUMERO_DOCUMENTO}`;
      const appPaid = appAdjustments.get(`${code}|${docKey}`) || 0;
      const rawTotal = parseFloat(r.TOTAL_PENDIENTE) || 0;
      const rawVencido = parseFloat(r.TOTAL_VENCIDO) || 0;
      const total = Math.max(0, rawTotal - appPaid);
      if (toCents(total) <= 0) continue;
      const vencido = rawVencido > 0 ? Math.min(total, Math.max(0, rawVencido - appPaid)) : 0;
      if (!summary[code]) {
        summary[code] = {
          nombre: trim(r.NOMBRE) || code,
          total: 0,
          vencido: 0,
          count: 0,
          estado: 'AL_DIA',
        };
      }
      summary[code].total += total;
      summary[code].vencido += vencido;
      summary[code].count += 1;
      summary[code].estado = summary[code].vencido > 0 ? 'VENCIDO' : 'PENDIENTE';
      grandTotal += total;
      grandTotalVencido += vencido;
    }

    return {
      summary,
      grandTotal,
      grandTotalVencido,
      clientCount: Object.keys(summary).length,
    };
  }

  async getAppSideCobrosByDocForSummary(vendorClause, queryParams, emptyClientFilter = '') {
    const adjustments = new Map();
    const add = (clientCode, docKey, amount) => {
      const client = trim(clientCode);
      const doc = trim(docKey);
      if (!client || !doc) return;
      const key = `${client}|${doc}`;
      adjustments.set(key, (adjustments.get(key) || 0) + (parseFloat(amount) || 0));
    };

    try {
      const comercialSql = `
        SELECT TRIM(C.CODIGO_CLIENTE) AS CLIENTE,
               TRIM(C.REFERENCIA) AS REF,
               COALESCE(SUM(C.IMPORTE), 0) AS TOTAL_APP
          FROM ${APP_SCHEMA}.COBROS C
         WHERE EXISTS (
           SELECT 1
             FROM DSEDAC.CVC CVC
            WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(C.CODIGO_CLIENTE)
              AND CVC.IMPORTEPENDIENTE <> 0
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${emptyClientFilter}
              ${vendorClause}
         )
         GROUP BY TRIM(C.CODIGO_CLIENTE), TRIM(C.REFERENCIA)`;
      const rows = queryParams.length > 0
        ? await queryWithParams(comercialSql, queryParams, [])
        : await query(comercialSql, false);
      for (const row of rows || []) {
        const reference = trim(row.REF);
        const match = reference.match(/([^:]+-\d+)$/);
        add(row.CLIENTE, match ? match[1] : reference, row.TOTAL_APP);
      }
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side COBROS doc summary subtract skipped: ${error.message}`);
    }

    try {
      const repartidorSql = `
        SELECT TRIM(R.CODIGOCLIENTEALBARAN) AS CLIENTE,
               TRIM(R.SERIEDOCUMENTO) AS SERIE,
               R.NUMERODOCUMENTO AS NUMERO,
               COALESCE(SUM(R.IMPORTEVENCIMIENTO), 0) AS TOTAL_APP
          FROM ${APP_SCHEMA}.REPARTIDOR_COBROS R
         WHERE EXISTS (
           SELECT 1
             FROM DSEDAC.CVC CVC
            WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(R.CODIGOCLIENTEALBARAN)
              AND CVC.IMPORTEPENDIENTE <> 0
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${emptyClientFilter}
              ${vendorClause}
         )
         GROUP BY R.CODIGOCLIENTEALBARAN, R.SERIEDOCUMENTO, R.NUMERODOCUMENTO`;
      const rows = queryParams.length > 0
        ? await queryWithParams(repartidorSql, queryParams, [])
        : await query(repartidorSql, false);
      for (const row of rows || []) {
        add(row.CLIENTE, formatRepartidorDocKey(row.SERIE, row.NUMERO), row.TOTAL_APP);
      }
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side REPARTIDOR_COBROS doc summary subtract skipped: ${error.message}`);
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
        SELECT TRIM(C.CODIGO_CLIENTE) AS CLIENTE,
               COALESCE(SUM(C.IMPORTE), 0) AS TOTAL_APP
          FROM ${APP_SCHEMA}.COBROS C
         WHERE EXISTS (
           SELECT 1
             FROM DSEDAC.CVC CVC
            WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(C.CODIGO_CLIENTE)
              AND CVC.IMPORTEPENDIENTE <> 0
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              ${vendorClause}
         )
         GROUP BY TRIM(C.CODIGO_CLIENTE)`;
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
              AND CVC.IMPORTEPENDIENTE <> 0
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

  async getAppSideCobrosByDoc(clientCode) {
    const adjustments = new Map();
    const add = (docKey, amount) => {
      const key = trim(docKey);
      if (!key) return;
      adjustments.set(key, (adjustments.get(key) || 0) + (parseFloat(amount) || 0));
    };

    try {
      const repartidorRows = await queryWithParams(
        `SELECT TRIM(SERIEDOCUMENTO) AS SERIE,
                NUMERODOCUMENTO AS NUMERO,
                COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL
           FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
          WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
          GROUP BY SERIEDOCUMENTO, NUMERODOCUMENTO`,
        [trim(clientCode)],
        [],
      );
      for (const row of repartidorRows || []) {
        add(formatRepartidorDocKey(row.SERIE, row.NUMERO), row.TOTAL);
      }
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side REPARTIDOR_COBROS doc subtract skipped: ${error.message}`);
    }

    try {
      const comercialRows = await queryWithParams(
        `SELECT TRIM(REFERENCIA) AS REF, COALESCE(SUM(IMPORTE), 0) AS TOTAL
           FROM ${APP_SCHEMA}.COBROS
          WHERE TRIM(CODIGO_CLIENTE) = ?
          GROUP BY TRIM(REFERENCIA)`,
        [trim(clientCode)],
        [],
      );
      for (const row of comercialRows || []) {
        const reference = trim(row.REF);
        const match = reference.match(/([^:]+-\d+)$/);
        add(match ? match[1] : reference, row.TOTAL);
      }
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side COBROS doc subtract skipped: ${error.message}`);
    }

    return adjustments;
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
    const id = normalizeToken(idempotencyToken);
    const normalizedClient = trim(clientCode);
    const normalizedReference = trim(reference);
    const normalizedPaymentMethod = trim(paymentMethod || 'CONTADO') || 'CONTADO';
    const normalizedUserId = trim(userId);
    const amountCents = toCents(amount);
    if (!normalizedClient || !normalizedReference || amountCents <= 0) {
      throw new CommercialCobrosError('INVALID_PAYMENT_PAYLOAD', 'cliente, referencia e importe positivo requeridos', 400);
    }

    const pool = getPool();
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN WORK');
      await conn.query(`LOCK TABLE ${APP_SCHEMA}.COBROS IN EXCLUSIVE MODE`);

      const order = await this.findOrderForPayment(conn, normalizedClient, normalizedReference);
      if (!order) {
        throw new CommercialCobrosError('ORDER_NOT_FOUND_FOR_PAYMENT', 'Pedido pendiente no encontrado para el cobro', 404);
      }

      const manager = isManagerContext({ userRole, isJefeVentas });
      if (!manager && !codesMatch(order.CODIGOVENDEDOR, normalizedUserId)) {
        throw new CommercialCobrosError('FORBIDDEN_CLIENT_VENDOR', 'El comercial no puede cobrar pedidos de otro vendedor', 403);
      }

      const stableReference = stableOrderReference(order);
      const existingRows = await conn.query(
        `SELECT ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO, CODIGO_USUARIO
         FROM ${APP_SCHEMA}.COBROS WHERE ID = ?`,
        [id],
      );
      if (existingRows.length > 0) {
        const existing = existingRows[0];
        const samePayload = trim(existing.CODIGO_CLIENTE) === normalizedClient &&
          trim(existing.REFERENCIA) === stableReference &&
          toCents(existing.IMPORTE) === amountCents &&
          trim(existing.FORMA_PAGO) === normalizedPaymentMethod &&
          codesMatch(existing.CODIGO_USUARIO, normalizedUserId);
        if (!samePayload) {
          throw new CommercialCobrosError('IDEMPOTENCY_CONFLICT', 'Token de idempotencia reutilizado con otro payload', 409);
        }
        await conn.query('COMMIT');
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

      const paidRows = await conn.query(
        `SELECT COALESCE(SUM(IMPORTE), 0) AS TOTAL_COBRADO
         FROM ${APP_SCHEMA}.COBROS
         WHERE TRIM(CODIGO_CLIENTE) = ?
           AND (TRIM(REFERENCIA) = ? OR TRIM(REFERENCIA) = ?)`,
        [normalizedClient, stableReference, legacyOrderReference(order)],
      );
      const paidComercialCents = toCents(paidRows?.[0]?.TOTAL_COBRADO);

      // CROSS-TABLE: tambien restamos cobros REPARTIDOR para el mismo documento.
      // El comercial NO puede recobrar lo que el repartidor ya cobro al entregar.
      let paidRepartidorCents = 0;
      try {
        const docRef = parseDocReference(legacyOrderReference(order));
        const repartidorRows = await conn.query(
          `SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
             FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
              AND TRIM(SERIEDOCUMENTO) = ?
              AND NUMERODOCUMENTO = ?`,
          [normalizedClient, docRef.serie, docRef.numero],
        );
        paidRepartidorCents = toCents(repartidorRows?.[0]?.TOTAL_REP);
        if (paidRepartidorCents > 0) {
          logger.info(`[COBROS_REPO] Cross-table REPARTIDOR_COBROS ya tiene ${paidRepartidorCents}c para ${normalizedClient}/${legacyOrderReference(order)}`);
        }
      } catch (xtableErr) {
        // Si la tabla no existe en este entorno, log y seguimos sin restar.
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

      let insert = buildCobroInsert({
        id,
        normalizedClient,
        stableReference,
        amount: fromCents(amountCents),
        paymentMethod: normalizedPaymentMethod,
        tipoVenta: 'CC',
        tipoModo: pendingAfterCents < 0 ? 'SOBRECOBRO' : 'NORMAL',
        tipoUsuario: manager ? 'JEFE_VENTAS' : 'COMERCIAL',
        codigoUsuario: normalizedUserId,
        observations: trim(observations || overrideReason).substring(0, 500),
        includeErpColumns: true,
      });
      try {
        await conn.query(insert.sql, insert.params);
      } catch (erpInsertErr) {
        if (!isColumnNotFound(erpInsertErr)) throw erpInsertErr;
        logger.warn(`[COBROS_REPO] ERP-compatible columns missing in ${APP_SCHEMA}.COBROS, using legacy insert`);
        insert = buildCobroInsert({
          id,
          normalizedClient,
          stableReference,
          amount: fromCents(amountCents),
          paymentMethod: normalizedPaymentMethod,
          tipoVenta: 'CC',
          tipoModo: pendingAfterCents < 0 ? 'SOBRECOBRO' : 'NORMAL',
          tipoUsuario: manager ? 'JEFE_VENTAS' : 'COMERCIAL',
          codigoUsuario: normalizedUserId,
          observations: trim(observations || overrideReason).substring(0, 500),
          includeErpColumns: false,
        });
        await conn.query(insert.sql, insert.params);
      }

      await conn.query('COMMIT');

      // EXPORT al ERP DSEDAC (best-effort, no rompe el flujo si falla).
      // Solo se ejecuta si PEDIDOS_EXPORT_TO_SYSTEM=true en .env.
      try {
        const dsedacExports = require('../../../../services/dsedac-exports.service');
        await dsedacExports.exportCobroToSystem({
          IDEMPOTENCY_TOKEN: id,
          CODIGO_CLIENTE: normalizedClient,
          CODIGOVENDEDOR: order.CODIGOVENDEDOR || normalizedUserId,
          IMPORTE: fromCents(amountCents),
          CODIGO_USUARIO: normalizedUserId,
        });
      } catch (exportErr) {
        logger.warn(`[COBROS] dsedac export best-effort fail: ${exportErr.message}`);
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
    } catch (error) {
      try { await conn.query('ROLLBACK'); } catch (_) { /* ignore rollback failures */ }
      throw error;
    } finally {
      if (conn && typeof conn.close === 'function') await conn.close();
    }
  }

  async ensureCobrosTable() {
    try {
      await query(COBROS_HEALTHCHECK_SQL);
      return true;
    } catch(e) {
      try {
        await query(`
          CREATE TABLE ${APP_SCHEMA}.COBROS (
            ID VARCHAR(64) PRIMARY KEY,
            CODIGO_CLIENTE VARCHAR(20),
            REFERENCIA VARCHAR(100),
            IMPORTE DECIMAL(10,2),
            FORMA_PAGO VARCHAR(50),
            TIPO_VENTA VARCHAR(20),
            TIPO_MODO VARCHAR(20),
            TIPO_USUARIO VARCHAR(20),
            CODIGO_USUARIO VARCHAR(20),
            OBSERVACIONES VARCHAR(500),
            FECHA TIMESTAMP DEFAULT CURRENT TIMESTAMP
          )
        `);
        return true;
      } catch(createErr) {
        logger.error(`[COBROS] Error creando tabla ${APP_SCHEMA}.COBROS: ${createErr.message}`);
        return false;
      }
    }
  }

  async getPaymentsForClient(clientCode) {
    return await queryWithParams(`
      SELECT REFERENCIA, SUM(IMPORTE) AS TOTAL_IMPORTE
      FROM ${APP_SCHEMA}.COBROS
      WHERE TRIM(CODIGO_CLIENTE) = ?
      GROUP BY REFERENCIA
    `, [trim(clientCode)], []) || [];
  }

  async getAllPayments() {
    return await queryWithParams(`
      SELECT TRIM(CODIGO_CLIENTE) AS CODIGO_CLIENTE, REFERENCIA, SUM(IMPORTE) AS TOTAL_IMPORTE
      FROM ${APP_SCHEMA}.COBROS
      GROUP BY TRIM(CODIGO_CLIENTE), REFERENCIA
    `, [], []) || [];
  }

  async findOrderForPayment(conn, clientCode, reference) {
    const rows = await conn.query(`
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
    `, [clientCode, reference, reference]);
    if (rows?.[0]) return rows[0];

    const cvcReference = normalizePaymentOrderReference(reference);
    const cvcRows = await conn.query(`
      SELECT
        'CVC:' || TRIM(C.SERIEDOCUMENTO) || '-' || TRIM(CAST(C.NUMERODOCUMENTO AS VARCHAR(20))) AS ID,
        'CVC' AS SOURCE,
        TRIM(C.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
        COALESCE((
          SELECT TRIM(MIN(CLP.VENDEDORCOMERCIAL))
            FROM DSEDAC.CLP CLP
           WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(C.CODIGOCLIENTEALBARAN)
        ), '') AS CODIGOVENDEDOR,
        TRIM(C.SERIEDOCUMENTO) AS SERIEPEDIDO,
        C.NUMERODOCUMENTO AS NUMEROPEDIDO,
        C.IMPORTEPENDIENTE AS IMPORTETOTAL,
        'PENDIENTE' AS ESTADO
      FROM DSEDAC.CVC C
      WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
        AND C.IMPORTEPENDIENTE > 0.01
        AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
        AND (
          TRIM(C.SERIEDOCUMENTO) || '-' || TRIM(CAST(C.NUMERODOCUMENTO AS VARCHAR(20))) = ?
          OR 'CVC:' || TRIM(C.SERIEDOCUMENTO) || '-' || TRIM(CAST(C.NUMERODOCUMENTO AS VARCHAR(20))) = ?
        )
      FETCH FIRST 1 ROW ONLY
    `, [clientCode, cvcReference, reference]);
    return cvcRows?.[0] || null;
  }

  /**
   * Get payment history for a client
   */
  async getHistorico({ clientCode, limit = 20, offset = 0 }) {
    // limit/offset llegan saneados desde el adaptador (enteros acotados).
    // Sintaxis DB2 for i: la clausula OFFSET va ANTES de FETCH FIRST.
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const sql = `
      SELECT
        C.ID, C.CODIGO_CLIENTE, C.IMPORTE, C.FORMA_PAGO,
        C.REFERENCIA, C.OBSERVACIONES, C.FECHA
      FROM ${APP_SCHEMA}.COBROS C
      WHERE TRIM(C.CODIGO_CLIENTE) = ?
      ORDER BY C.FECHA DESC
      OFFSET ${safeOffset} ROWS FETCH FIRST ${safeLimit} ROWS ONLY
    `;

    const result = await queryWithParams(sql, [clientCode], []);
    return result || [];
  }

  /**
   * Get totals by vendor
   */
  async getTotalesByVendor(vendorCode) {
    const sql = `
      SELECT
        COUNT(*) as TOTAL_COBROS,
        SUM(IMPORTE) as TOTAL_IMPORTE,
        AVG(IMPORTE) as PROMEDIO
      FROM ${APP_SCHEMA}.COBROS
      WHERE CODIGO_USUARIO = ?
    `;

    const result = await queryWithParams(sql, [vendorCode], []);
    return result[0] || {};
  }
}

module.exports = { Db2CobrosRepository };
