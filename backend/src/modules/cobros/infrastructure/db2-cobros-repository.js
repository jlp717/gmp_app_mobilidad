/**
 * Cobros Repository Implementation - DB2
 *
 * DELEGATES TO LEGACY cobros.js routes for correct SQL
 * The legacy implementation has proper column names and business logic
 */
const { CobrosRepository } = require('../domain/cobros-repository');
const { query, queryWithParams, getPool } = require('../../../../config/db');
const logger = require('../../../../middleware/logger');

// Schema dinamico para tablas APP (JAVIER en dev / DSEDAC en prod).
const APP_SCHEMA = String(process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER').trim().toUpperCase();

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
  return `${trim(order.SERIEPEDIDO)}-${trim(order.NUMEROPEDIDO)}`;
}

function stableOrderReference(order) {
  return `PEDIDO:${trim(order.ID)}:${legacyOrderReference(order)}`;
}

function normalizePaymentOrderReference(value) {
  const reference = trim(value);
  const stableMatch = reference.match(/^PEDIDO:[^:]+:(.+)$/);
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

class Db2CobrosRepository extends CobrosRepository {
  /**
   * Get pending payments for a client (orders that are CONFIRMADO/ENVIADO but not yet paid)
   * Uses correct column names: DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, IMPORTETOTAL
   */
  async getPendientes(clientCode, context = {}) {
    const cobrosTableExists = await this.ensureCobrosTable();

    // Check if ORIGEN column exists
    let origenExists = false;
    try {
      const colCheck = await query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS2
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'PEDIDOS_CAB' AND COLUMN_NAME = 'ORIGEN'
        FETCH FIRST 1 ROW ONLY
      `);
      origenExists = colCheck && colCheck.length > 0;
    } catch(e) {}

    const manager = isManagerContext(context);
    const userCode = trim(context.userId || context.userCode);
    const vendedorFilter = !manager && userCode
      ? ' AND TRIM(PC.CODIGOVENDEDOR) = ?'
      : '';

    // Build query with correct column names
    let sql;
    if (origenExists) {
      sql = `
        SELECT
          PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
          PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
          PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
        FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
        WHERE TRIM(PC.CODIGOCLIENTE) = ?
          AND PC.ORIGEN = 'A'
          AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
          AND PC.IMPORTETOTAL > 0
          ${vendedorFilter}
        ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC, PC.DIADOCUMENTO DESC
        FETCH FIRST 100 ROWS ONLY
      `;
    } else {
      sql = `
        SELECT
          PC.ID, PC.EJERCICIO, PC.NUMEROPEDIDO, PC.SERIEPEDIDO,
          PC.DIADOCUMENTO, PC.MESDOCUMENTO, PC.ANODOCUMENTO,
          PC.IMPORTETOTAL, PC.TIPOVENTA, PC.ESTADO
        FROM ${APP_SCHEMA}.PEDIDOS_CAB PC
        WHERE TRIM(PC.CODIGOCLIENTE) = ?
          AND PC.ESTADO IN ('CONFIRMADO', 'ENVIADO')
          AND PC.IMPORTETOTAL > 0
          ${vendedorFilter}
        ORDER BY PC.ANODOCUMENTO DESC, PC.MESDOCUMENTO DESC, PC.DIADOCUMENTO DESC
        FETCH FIRST 100 ROWS ONLY
      `;
    }

    const orderParams = [clientCode, ...(vendedorFilter ? [userCode] : [])];
    const resultado = await queryWithParams(sql, orderParams, []);
    const payments = cobrosTableExists
      ? await this.getPaymentsForClient(clientCode)
      : [];
    
    const ahora = new Date();
    const format2 = (n) => String(n).padStart(2, '0');

    const cobros = (resultado && resultado.length > 0 ? resultado : []).map(row => {
      const mes = Number(row.MESDOCUMENTO);
      const ano = Number(row.ANODOCUMENTO);
      const referencia = `${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`;
      const totalCents = toCents(row.IMPORTETOTAL);
      const paidCents = payments
        .filter((payment) => paymentMatchesOrder(payment.REFERENCIA, row))
        .reduce((sum, payment) => sum + toCents(payment.TOTAL_IMPORTE), 0);
      const pendingCents = Math.max(0, totalCents - paidCents);
      const dia = format2(row.DIADOCUMENTO);
      const mm = format2(row.MESDOCUMENTO);
      const fechaStr = `${ano}-${mm}-${dia}T00:00:00.000Z`;

      return {
        id: stableOrderReference(row),
        tipo: 'pedido_app',
        referencia,
        fecha: fechaStr,
        importeTotal: fromCents(totalCents),
        importePendiente: fromCents(pendingCents),
        descripcion: `Pedido ${row.SERIEPEDIDO}-${row.NUMEROPEDIDO}`,
        estado: row.ESTADO,
        ejercicio: row.EJERCICIO,
        numeroPedido: row.NUMEROPEDIDO,
        seriePedido: row.SERIEPEDIDO
      };
    }).filter((cobro) => toCents(cobro.importePendiente) > 0);

    let total = cobros.reduce((sum, c) => sum + c.importePendiente, 0);

    return {
      cobros,
      resumen: {
        totalPendiente: total,
        pedidos: { cantidad: cobros.length, total: total }
      }
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

    const sql = `
      SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
             SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE,
             COUNT(*) AS NUM_DOCS,
             SUM(CASE WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)
                 <= (YEAR(CURRENT_DATE) * 10000 + MONTH(CURRENT_DATE) * 100 + DAY(CURRENT_DATE))
                  THEN CVC.IMPORTEPENDIENTE ELSE 0 END) AS TOTAL_VENCIDO
       FROM DSEDAC.CVC CVC
       WHERE CVC.IMPORTEPENDIENTE <> 0
         AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
         ${vendorClause}
       GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN)
       ORDER BY TOTAL_PENDIENTE DESC
    `;

    const rows = queryParams.length > 0
      ? await queryWithParams(sql, queryParams, [])
      : await query(sql, false);

    const appAdjustments = await this.getAppSideCobrosByClient(vendorClause, queryParams);

    const summary = {};
    let grandTotal = 0;
    let grandTotalVencido = 0;
    let clientCount = 0;

    for (const r of rows || []) {
      const code = trim(r.CLIENTE);
      const appPaid = appAdjustments.get(code) || 0;
      const total = Math.max(0, (parseFloat(r.TOTAL_PENDIENTE) || 0) - appPaid);
      const vencido = Math.max(0, (parseFloat(r.TOTAL_VENCIDO) || 0) - appPaid);
      const docCount = parseInt(r.NUM_DOCS) || 0;
      const estado = vencido > 0 ? 'VENCIDO' : (total > 0 ? 'PENDIENTE' : 'AL_DIA');
      summary[code] = { total, vencido, count: docCount, estado };
      grandTotal += total;
      grandTotalVencido += vencido;
      clientCount++;
    }

    return {
      summary,
      grandTotal,
      grandTotalVencido,
      clientCount,
    };
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
         GROUP BY TRIM(R.CODIGOCLIENTEALBARAN)`;
      const rows = queryParams.length > 0
        ? await queryWithParams(repartidorSql, queryParams, [])
        : await query(repartidorSql, false);
      for (const row of rows || []) add(row.CLIENTE, row.TOTAL_APP);
    } catch (error) {
      logger.warn(`[COBROS_REPO] App-side REPARTIDOR_COBROS summary subtract skipped: ${error.message}`);
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
        const repartidorRows = await conn.query(
          `SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_REP
             FROM ${APP_SCHEMA}.REPARTIDOR_COBROS
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
              AND (TRIM(SERIEDOCUMENTO) || '-' || TRIM(CAST(NUMERODOCUMENTO AS VARCHAR(20)))) = ?`,
          [normalizedClient, legacyOrderReference(order)],
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

      await conn.query(`
        INSERT INTO ${APP_SCHEMA}.COBROS (
          ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO,
          TIPO_VENTA, TIPO_MODO, TIPO_USUARIO, CODIGO_USUARIO,
          OBSERVACIONES
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id,
          normalizedClient,
          stableReference,
          fromCents(amountCents),
          normalizedPaymentMethod,
          'CC',
          pendingAfterCents < 0 ? 'SOBRECOBRO' : 'NORMAL',
          manager ? 'JEFE_VENTAS' : 'COMERCIAL',
          normalizedUserId,
          trim(observations || overrideReason).substring(0, 500),
        ]);

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
      await query(`SELECT 1 FROM ${APP_SCHEMA}.COBROS FETCH FIRST 1 ROW ONLY`);
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
    return rows?.[0] || null;
  }

  /**
   * Get payment history for a client
   */
  async getHistorico({ clientCode, limit = 20, offset = 0 }) {
    const sql = `
      SELECT
        C.ID, C.CODIGO_CLIENTE, C.IMPORTE, C.FORMA_PAGO,
        C.REFERENCIA, C.OBSERVACIONES, C.FECHA
      FROM ${APP_SCHEMA}.COBROS C
      WHERE TRIM(C.CODIGO_CLIENTE) = ?
      ORDER BY C.FECHA DESC
      FETCH FIRST ${limit} ROWS ONLY OFFSET ${offset} ROWS
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
