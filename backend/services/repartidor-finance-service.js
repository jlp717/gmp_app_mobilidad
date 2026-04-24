'use strict';

const PDFDocument = require('pdfkit');
const { queryWithParams, getPool, initDb } = require('../config/db');
const logger = require('../middleware/logger');
const { sendEmailWithPdf } = require('./emailPdfService');

const INTERNAL_LIQUIDATION_RECIPIENTS = [
  'carmen@mari-pepa.com',
  'marisol@mari-pepa.com',
  'diegocorbalan@mari-pepa.com',
];

function value(row, key, fallback = undefined) {
  if (!row) return fallback;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];
  return fallback;
}

function toNumber(raw) {
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function toInt(raw) {
  const num = parseInt(raw, 10);
  return Number.isFinite(num) ? num : 0;
}

function roundMoney(raw) {
  return Math.round((toNumber(raw) + Number.EPSILON) * 100) / 100;
}

function firstRow(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
}

function pad(raw, size) {
  return String(raw ?? '').trim().padStart(size, '0');
}

function compactDate(dateString) {
  const [year, month, day] = String(dateString).split('-').map((part) => parseInt(part, 10));
  if (!year || !month || !day) throw new Error(`Invalid ISO date: ${dateString}`);
  return year * 10000 + month * 100 + day;
}

function dateParts(dateString) {
  const [year, month, day] = String(dateString).split('-').map((part) => parseInt(part, 10));
  if (!year || !month || !day) throw new Error(`Invalid ISO date: ${dateString}`);
  return { year, month, day };
}

function currentHhmmss() {
  const now = new Date();
  return now.getHours() * 10000 + now.getMinutes() * 100 + now.getSeconds();
}

function formatDateFromParts(row, prefix) {
  const year = toInt(value(row, `${prefix}ANO`) || value(row, `ANO${prefix}`) || value(row, `ANO${prefix}DOCUMENTO`));
  const month = toInt(value(row, `${prefix}MES`) || value(row, `MES${prefix}`) || value(row, `MES${prefix}DOCUMENTO`));
  const day = toInt(value(row, `${prefix}DIA`) || value(row, `DIA${prefix}`) || value(row, `DIA${prefix}DOCUMENTO`));
  if (!year || !month || !day) return null;
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`;
}

function formatCvcDueDate(row) {
  const year = toInt(value(row, 'ANOVENCIMIENTO'));
  const month = toInt(value(row, 'MESVENCIMIENTO'));
  const day = toInt(value(row, 'DIAVENCIMIENTO'));
  if (!year || !month || !day) return null;
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`;
}

function buildDocument(row) {
  const year = toInt(value(row, 'EJERCICIODOCUMENTO') || value(row, 'EJERCICIO_DOCUMENTO'));
  const origin = String(value(row, 'ORIGENDOCUMENTO', 'B') || 'B').trim() || 'B';
  const serie = String(value(row, 'SERIEDOCUMENTO') || value(row, 'SERIE_DOCUMENTO') || '').trim();
  const terminal = toInt(value(row, 'TERMINALDOCUMENTO') || value(row, 'TERMINAL_DOCUMENTO'));
  const numero = toInt(value(row, 'NUMERODOCUMENTO') || value(row, 'NUMERO_DOCUMENTO'));
  const xde = toInt(value(row, 'XDEDOCUMENTO') || value(row, 'XDE_DOCUMENTO') || 1);

  if (!year || !numero) return String(value(row, 'DOCUMENTO', '') || '').trim();
  return `E ${year}-${origin}-${serie}-${pad(terminal, 3)}-${pad(numero, 6)}-${pad(xde, 2)}`;
}

function mapCobro(row) {
  const importe = roundMoney(value(row, 'IMPORTE_COBRADO'));
  const pendiente = roundMoney(value(row, 'IMPORTE_PENDIENTE'));
  return {
    id: value(row, 'ID') == null ? null : String(value(row, 'ID')),
    fecha: value(row, 'FECHA_COBRO') || value(row, 'fecha_cobro'),
    codigoCliente: String(value(row, 'CODIGO_CLIENTE', '') || '').trim(),
    nombreCliente: String(value(row, 'NOMBRE_CLIENTE', '') || '').trim(),
    tipoCobro: String(value(row, 'FORMA_PAGO', '') || '').trim(),
    tipoDocumento: String(value(row, 'TIPO_DOCUMENTO', '') || '').trim(),
    documento: buildDocument(row),
    importe,
    cobrado: importe,
    pendiente,
  };
}

function mapVencimiento(row) {
  return {
    tipoDocumento: String(value(row, 'TIPODOCUMENTO', '') || '').trim(),
    codigoCliente: String(value(row, 'CODIGOCLIENTEALBARAN', '') || '').trim(),
    nombreCliente: String(value(row, 'NOMBRE_CLIENTE', '') || '').trim(),
    nombreAlternativo: String(value(row, 'NOMBREALTERNATIVO', '') || '').trim(),
    poblacion: String(value(row, 'POBLACION', '') || '').trim(),
    fechaVencimiento: formatCvcDueDate(row),
    documento: buildDocument(row),
    importe: roundMoney(value(row, 'IMPORTEVENCIMIENTO')),
    importePendiente: roundMoney(value(row, 'IMPORTEPENDIENTE')),
    keys: {
      tipoDocumento: String(value(row, 'TIPODOCUMENTO', '') || '').trim(),
      origenDocumento: String(value(row, 'ORIGENDOCUMENTO', '') || '').trim(),
      subempresaDocumento: String(value(row, 'SUBEMPRESADOCUMENTO', '') || '').trim(),
      ejercicioDocumento: toInt(value(row, 'EJERCICIODOCUMENTO')),
      serieDocumento: String(value(row, 'SERIEDOCUMENTO', '') || '').trim(),
      terminalDocumento: toInt(value(row, 'TERMINALDOCUMENTO')),
      numeroDocumento: toInt(value(row, 'NUMERODOCUMENTO')),
      xdeDocumento: toInt(value(row, 'XDEDOCUMENTO')),
      dexDocumento: toInt(value(row, 'DEXDOCUMENTO')),
    },
  };
}

function mapLiquidacion(row) {
  if (!row || Object.keys(row).length === 0) return null;
  return {
    id: value(row, 'ID') == null ? null : String(value(row, 'ID')),
    idempotencyToken: value(row, 'IDEMPOTENCY_TOKEN'),
    repartidorId: value(row, 'CODIGO_REPARTIDOR'),
    numero: {
      subempresa: value(row, 'SUBEMPRESA_LIQ'),
      ejercicio: toInt(value(row, 'EJERCICIO_LIQ')),
      serie: value(row, 'SERIE_LIQ'),
      terminal: toInt(value(row, 'TERMINAL_LIQ')),
      numero: toInt(value(row, 'NUMERO_LIQ')),
      display: `${value(row, 'EJERCICIO_LIQ')}-${value(row, 'SERIE_LIQ')}-${pad(value(row, 'TERMINAL_LIQ'), 3)}-${pad(value(row, 'NUMERO_LIQ'), 6)}`,
    },
    totals: {
      totalEfectivo: roundMoney(value(row, 'TOTAL_EFECTIVO')),
      totalCheques: roundMoney(value(row, 'TOTAL_CHEQUES')),
      totalTarjeta: roundMoney(value(row, 'TOTAL_TARJETA')),
      totalPostdatados: roundMoney(value(row, 'TOTAL_POSTDATADOS')),
      saldoAnterior: roundMoney(value(row, 'SALDO_ANTERIOR')),
      totalCobrosDia: roundMoney(value(row, 'TOTAL_COBROS_DIA')),
      totalAIngresar: roundMoney(value(row, 'TOTAL_A_INGRESAR')),
      ingresoBanco: roundMoney(value(row, 'INGRESO_BANCO')),
      saldoResultante: roundMoney(value(row, 'SALDO_RESULTANTE')),
    },
    status: value(row, 'STATUS'),
  };
}

class AlreadyDeliveredError extends Error {
  constructor(row) {
    super('Esta entrega ya fue confirmada anteriormente');
    this.name = 'AlreadyDeliveredError';
    this.code = 'ALREADY_DELIVERED';
    this.previousRepartidor = value(row, 'REPARTIDOR_ID');
    this.previousDate = value(row, 'UPDATED_AT');
  }
}

async function findLiquidacionByToken(idempotencyToken) {
  const rows = await queryWithParams(`
    SELECT *
    FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS
    WHERE IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [idempotencyToken], false, false);
  return mapLiquidacion(firstRow(rows));
}

async function getDailySummary({ repartidorId, date }) {
  const totalsRows = await queryWithParams(`
    SELECT
      COALESCE(SUM(CASE WHEN UPPER(TRIM(FORMA_PAGO)) IN ('EFECTIVO', 'E', 'CONTADO') THEN IMPORTE_COBRADO ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(FORMA_PAGO)) IN ('CHEQUE', 'TALON', 'TALON BANCARIO') THEN IMPORTE_COBRADO ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(FORMA_PAGO)) IN ('TARJETA', 'TPV', 'BIZUM') THEN IMPORTE_COBRADO ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(FORMA_PAGO)) IN ('POSTDATADO', 'POSTDATADOS') THEN IMPORTE_COBRADO ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(IMPORTE_COBRADO), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE TRIM(CODIGO_REPARTIDOR) = ?
      AND DATE(FECHA_COBRO) = DATE(?)
      AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
  `, [repartidorId, date], false, false);

  const balanceRows = await queryWithParams(`
    SELECT SALDO_PENDIENTE
    FROM JAVIER.REPARTIDOR_FINANCIAL_BALANCES
    WHERE TRIM(CODIGO_REPARTIDOR) = ?
    FETCH FIRST 1 ROW ONLY
  `, [repartidorId], false, false);

  const cobroRows = await queryWithParams(`
    SELECT
      ID,
      FECHA_COBRO,
      CODIGO_CLIENTE,
      NOMBRE_CLIENTE,
      FORMA_PAGO,
      TIPO_DOCUMENTO,
      ORIGEN_DOCUMENTO AS ORIGENDOCUMENTO,
      SERIE_DOCUMENTO,
      TERMINAL_DOCUMENTO,
      NUMERO_DOCUMENTO,
      EJERCICIO_DOCUMENTO,
      XDE_DOCUMENTO,
      IMPORTE_COBRADO,
      IMPORTE_PENDIENTE
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE TRIM(CODIGO_REPARTIDOR) = ?
      AND DATE(FECHA_COBRO) = DATE(?)
      AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
    ORDER BY FECHA_COBRO, ID
  `, [repartidorId, date], false, false);

  const totals = firstRow(totalsRows);
  const saldoActual = roundMoney(value(firstRow(balanceRows), 'SALDO_PENDIENTE', 0));
  const totalCobrosDia = roundMoney(value(totals, 'TOTAL_COBROS_DIA'));
  const gastos = 0;

  return {
    repartidorId,
    date,
    summary: {
      totalEfectivo: roundMoney(value(totals, 'TOTAL_EFECTIVO')),
      totalCheques: roundMoney(value(totals, 'TOTAL_CHEQUES')),
      totalTarjeta: roundMoney(value(totals, 'TOTAL_TARJETA')),
      totalPostdatados: roundMoney(value(totals, 'TOTAL_POSTDATADOS')),
      saldoActual,
      totalCobrosDia,
      gastos,
      totalAIngresar: roundMoney(saldoActual + totalCobrosDia - gastos),
      ingresoBanco: 0,
      totalEfectivo2: roundMoney(value(totals, 'TOTAL_EFECTIVO')),
      entregado: 0,
      cobrosCount: toInt(value(totals, 'COBROS_COUNT')),
    },
    cobros: cobroRows.map(mapCobro),
  };
}

async function getSummary({ repartidorId, year, month }) {
  const today = new Date();
  const todayYmd = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const rows = await queryWithParams(`
    SELECT
      COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS TOTAL_PENDIENTE,
      COALESCE(SUM(CASE
        WHEN (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO) < ?
        THEN CVC.IMPORTEPENDIENTE ELSE 0 END), 0) AS TOTAL_VENCIDO,
      COUNT(*) AS DOCUMENTOS_PENDIENTES,
      COUNT(DISTINCT TRIM(CVC.CODIGOCLIENTEALBARAN)) AS CLIENTES_PENDIENTES
    FROM DSEDAC.CVC CVC
    INNER JOIN DSEDAC.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    INNER JOIN DSEDAC.OPP OPP
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
    WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
      AND CVC.ANOEMISION = ?
      AND CVC.MESEMISION = ?
      AND COALESCE(CVC.ANULADOSN, '') <> 'S'
      AND CVC.TIPODOCUMENTO IN ('CAC', 'COB', 'DEV')
      AND CVC.IMPORTEPENDIENTE <> 0
  `, [todayYmd, repartidorId, year, month], false, false);

  const row = firstRow(rows);
  return {
    repartidorId,
    period: { year, month },
    summary: {
      totalPendiente: roundMoney(value(row, 'TOTAL_PENDIENTE')),
      totalVencido: roundMoney(value(row, 'TOTAL_VENCIDO')),
      documentosPendientes: toInt(value(row, 'DOCUMENTOS_PENDIENTES')),
      clientesPendientes: toInt(value(row, 'CLIENTES_PENDIENTES')),
    },
  };
}

async function getVencimientos({ repartidorId, from, to, limit, clientCode, estado }) {
  const params = [repartidorId, compactDate(from), compactDate(to)];
  let clientFilter = '';
  if (clientCode) {
    clientFilter = ' AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?';
    params.push(clientCode.trim());
  }
  if (estado === 'vencido') {
    const now = new Date();
    const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    clientFilter += ' AND (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO) < ?';
    params.push(ymd);
  }
  params.push(limit);

  const rows = await queryWithParams(`
    SELECT *
    FROM (
      SELECT
        CVC.TIPODOCUMENTO,
        CVC.ORIGENDOCUMENTO,
        CVC.SUBEMPRESADOCUMENTO,
        CVC.EJERCICIODOCUMENTO,
        CVC.SERIEDOCUMENTO,
        CVC.TERMINALDOCUMENTO,
        CVC.NUMERODOCUMENTO,
        CVC.XDEDOCUMENTO,
        CVC.DEXDOCUMENTO,
        CVC.CODIGOCLIENTEALBARAN,
        TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBRECLIENTE), ''), CVC.CODIGOCLIENTEALBARAN)) AS NOMBRE_CLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, '')) AS NOMBREALTERNATIVO,
        TRIM(COALESCE(CLI.POBLACION, '')) AS POBLACION,
        CVC.DIAVENCIMIENTO,
        CVC.MESVENCIMIENTO,
        CVC.ANOVENCIMIENTO,
        CVC.IMPORTEVENCIMIENTO,
        CVC.IMPORTEPENDIENTE,
        ROW_NUMBER() OVER (
          ORDER BY CVC.ANOVENCIMIENTO, CVC.MESVENCIMIENTO, CVC.DIAVENCIMIENTO, CVC.NUMERODOCUMENTO
        ) AS RN
      FROM DSEDAC.CVC CVC
      INNER JOIN DSEDAC.CPC CPC
        ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
        AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
        AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
        AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
        AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
      INNER JOIN DSEDAC.OPP OPP
        ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      LEFT JOIN DSEDAC.CLI CLI
        ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
      WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
        AND (CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO) BETWEEN ? AND ?
        AND COALESCE(CVC.ANULADOSN, '') <> 'S'
        AND CVC.TIPODOCUMENTO IN ('CAC', 'COB', 'DEV')
        AND CVC.IMPORTEPENDIENTE <> 0
        ${clientFilter}
    ) V
    WHERE V.RN <= ?
    ORDER BY V.ANOVENCIMIENTO, V.MESVENCIMIENTO, V.DIAVENCIMIENTO, V.NUMERODOCUMENTO
  `, params, false, false);

  return rows.map(mapVencimiento);
}

async function registerCobro(input) {
  const existingRows = await queryWithParams(`
    SELECT ID FROM JAVIER.REPARTIDOR_COBROS
    WHERE IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [input.idempotencyToken], false, false);

  if (existingRows.length > 0) {
    return { created: false, id: String(value(existingRows[0], 'ID')) };
  }

  await queryWithParams(`
    INSERT INTO JAVIER.REPARTIDOR_COBROS (
      ENTREGA_APP_ID,
      CODIGO_CLIENTE,
      NOMBRE_CLIENTE,
      CODIGO_REPARTIDOR,
      TIPO_DOCUMENTO,
      ORIGEN_DOCUMENTO,
      SUBEMPRESA_DOCUMENTO,
      EJERCICIO_DOCUMENTO,
      SERIE_DOCUMENTO,
      TERMINAL_DOCUMENTO,
      NUMERO_DOCUMENTO,
      XDE_DOCUMENTO,
      IMPORTE_COBRADO,
      IMPORTE_PENDIENTE,
      FORMA_PAGO,
      IDEMPOTENCY_TOKEN,
      PANTALLA_ORIGEN,
      OPERADOR,
      NOTAS
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.entregaId || null,
    input.codigoCliente,
    input.nombreCliente || null,
    input.codigoRepartidor,
    input.tipoDocumento,
    input.origenDocumento || 'B',
    input.subempresaDocumento || 'GMP',
    input.ejercicioDocumento,
    input.serieDocumento,
    input.terminalDocumento,
    input.numeroDocumento,
    input.xdeDocumento || 1,
    roundMoney(input.importeCobrado),
    roundMoney(input.importePendiente),
    input.formaPago,
    input.idempotencyToken,
    input.pantallaOrigen,
    input.operador,
    input.notas || null,
  ], false, false);

  const row = firstRow(await queryWithParams(`
    SELECT ID FROM JAVIER.REPARTIDOR_COBROS
    WHERE IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [input.idempotencyToken], false, false));

  return { created: true, id: String(value(row, 'ID', '')) };
}

async function confirmRuteroDeliveryWithCobro({ delivery, cobro }) {
  return withTransaction(async (conn) => {
    const tokenRows = await conn.query(`
      SELECT ID
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [cobro.idempotencyToken]);

    const deliveryRows = await conn.query(`
      SELECT STATUS, UPDATED_AT, REPARTIDOR_ID
      FROM JAVIER.DELIVERY_STATUS
      WHERE ID = ?
      FETCH FIRST 1 ROW ONLY
    `, [delivery.itemId]);
    const existingDelivery = firstRow(deliveryRows);
    const isDelivered =
      String(value(existingDelivery, 'STATUS', '') || '').trim() === 'ENTREGADO';

    if (tokenRows.length > 0) {
      if (isDelivered) {
        return {
          created: false,
          idempotent: true,
          deliveryStatus: 'ENTREGADO',
          cobroId: String(value(tokenRows[0], 'ID', '')),
        };
      }

      const error = new Error(
        'Token de cobro existente sin entrega confirmada; requiere revision manual',
      );
      error.code = 'INCONSISTENT_IDEMPOTENCY';
      throw error;
    }

    if (isDelivered && !delivery.forceUpdate) {
      throw new AlreadyDeliveredError(existingDelivery);
    }

    const lat = toNumber(delivery.latitud);
    const lon = toNumber(delivery.longitud);
    let repartidorId = String(delivery.repartidorId || '').trim();
    if (repartidorId.length > 20) repartidorId = repartidorId.substring(0, 20);

    await conn.query(`
      DELETE FROM JAVIER.DELIVERY_STATUS
      WHERE ID = ?
    `, [delivery.itemId]);

    await conn.query(`
      INSERT INTO JAVIER.DELIVERY_STATUS (
        ID,
        STATUS,
        OBSERVACIONES,
        FIRMA_PATH,
        LATITUD,
        LONGITUD,
        REPARTIDOR_ID,
        UPDATED_AT
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
    `, [
      delivery.itemId,
      delivery.status || 'ENTREGADO',
      delivery.observaciones || '',
      delivery.firma || '',
      lat,
      lon,
      repartidorId,
    ]);

    await conn.query(`
      INSERT INTO JAVIER.REPARTIDOR_COBROS (
        ENTREGA_APP_ID,
        CODIGO_CLIENTE,
        NOMBRE_CLIENTE,
        CODIGO_REPARTIDOR,
        TIPO_DOCUMENTO,
        ORIGEN_DOCUMENTO,
        SUBEMPRESA_DOCUMENTO,
        EJERCICIO_DOCUMENTO,
        SERIE_DOCUMENTO,
        TERMINAL_DOCUMENTO,
        NUMERO_DOCUMENTO,
        XDE_DOCUMENTO,
        IMPORTE_COBRADO,
        IMPORTE_PENDIENTE,
        FORMA_PAGO,
        IDEMPOTENCY_TOKEN,
        PANTALLA_ORIGEN,
        OPERADOR,
        NOTAS
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      cobro.entregaId || delivery.itemId,
      cobro.codigoCliente,
      cobro.nombreCliente || null,
      cobro.codigoRepartidor || repartidorId,
      cobro.tipoDocumento,
      cobro.origenDocumento || 'B',
      cobro.subempresaDocumento || 'GMP',
      cobro.ejercicioDocumento,
      cobro.serieDocumento,
      cobro.terminalDocumento,
      cobro.numeroDocumento,
      cobro.xdeDocumento || 1,
      roundMoney(cobro.importeCobrado),
      roundMoney(cobro.importePendiente),
      cobro.formaPago,
      cobro.idempotencyToken,
      cobro.pantallaOrigen || 'RUTERO',
      cobro.operador || 'unknown',
      cobro.notas || null,
    ]);

    return {
      created: true,
      idempotent: false,
      deliveryStatus: delivery.status || 'ENTREGADO',
    };
  });
}

async function nextLiquidacionNumber({ subempresa, ejercicio, serie, terminal }) {
  const row = firstRow(await queryWithParams(`
    SELECT COALESCE(MAX(NUMEROLIQUIDACION), 0) + 1 AS NEXT_NUMERO
    FROM DSEDAC.LQD
    WHERE SUBEMPRESALIQUIDACION = ?
      AND EJERCICIOLIQUIDACION = ?
      AND SERIELIQUIDACION = ?
      AND TERMINALLIQUIDACION = ?
  `, [subempresa, ejercicio, serie, terminal], false, false));
  return toInt(value(row, 'NEXT_NUMERO', 1));
}

async function withTransaction(callback) {
  let pool = getPool();
  if (!pool) {
    await initDb();
    pool = getPool();
  }
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN WORK');
    const result = await callback(conn);
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error(`[REPARTIDOR_FINANZAS] Rollback failed: ${rollbackError.message}`);
    }
    throw error;
  } finally {
    try {
      await conn.close();
    } catch (_) {
      // ignore close errors
    }
  }
}

async function closeLiquidacion(input) {
  const existing = await findLiquidacionByToken(input.idempotencyToken);
  if (existing) return { created: false, liquidacion: existing };

  const { year, month, day } = dateParts(input.date);
  const subempresa = 'GMP';
  const serie = 'A';
  const terminal = toInt(input.repartidorId);
  const numero = await nextLiquidacionNumber({
    subempresa,
    ejercicio: year,
    serie,
    terminal,
  });

  const totals = input.totals;
  const saldoResultante = roundMoney(
    totals.totalAIngresar - totals.ingresoBanco
  );
  const hora = currentHhmmss();

  await withTransaction(async (conn) => {
    await conn.query(`
      INSERT INTO DSEDAC.LQD (
        SUBEMPRESALIQUIDACION,
        EJERCICIOLIQUIDACION,
        SERIELIQUIDACION,
        TERMINALLIQUIDACION,
        NUMEROLIQUIDACION,
        DIALIQUIDACION,
        MESLIQUIDACION,
        ANOLIQUIDACION,
        HORALIQUIDACION,
        CODIGOVENDEDOR,
        CODIGOVENDEDORUSUARIO,
        CODIGOUSUARIO,
        MATRICULA,
        KILOMETROSSALIDA,
        KILOMETROSLLEGADA,
        KILOMETROSRECORRIDOS,
        IMPORTEEFECTIVO,
        IMPORTECHEQUES,
        IMPORTEPOSTDATADOS,
        IMPORTESALDOACTUAL,
        IMPORTETOTALAINGRESAR,
        IMPORTEINGRESOENBANCO,
        IMPORTEGASTOS,
        IMPRESOSN,
        CODIGOVEHICULO,
        REVISADOSN,
        IDMARCALIQUIDACION,
        IMPORTEEFECTIVO2,
        IMPORTEENTREGADO2,
        IMPORTETARJETA
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      subempresa,
      year,
      serie,
      terminal,
      numero,
      day,
      month,
      year,
      hora,
      pad(input.repartidorId, 2).slice(-2),
      pad(input.repartidorId, 2).slice(-2),
      String(input.createdBy || '').substring(0, 10),
      input.matricula || '',
      0,
      0,
      0,
      roundMoney(totals.totalEfectivo),
      roundMoney(totals.totalCheques),
      roundMoney(totals.totalPostdatados),
      roundMoney(totals.saldoActual),
      roundMoney(totals.totalAIngresar),
      roundMoney(totals.ingresoBanco),
      roundMoney(totals.gastos),
      'N',
      input.codigoVehiculo || '',
      'N',
      input.idempotencyToken,
      roundMoney(totals.efectivo2),
      roundMoney(totals.entregado2),
      roundMoney(totals.totalTarjeta),
    ]);

    await conn.query(`
      INSERT INTO JAVIER.REPARTIDOR_LIQUIDACION_OPS (
        IDEMPOTENCY_TOKEN,
        SUBEMPRESA_LIQ,
        EJERCICIO_LIQ,
        SERIE_LIQ,
        TERMINAL_LIQ,
        NUMERO_LIQ,
        CODIGO_REPARTIDOR,
        TOTAL_EFECTIVO,
        TOTAL_CHEQUES,
        TOTAL_TARJETA,
        TOTAL_POSTDATADOS,
        SALDO_ANTERIOR,
        TOTAL_COBROS_DIA,
        GASTOS,
        TOTAL_A_INGRESAR,
        INGRESO_BANCO,
        EFECTIVO_2,
        ENTREGADO_2,
        SALDO_RESULTANTE,
        CREADO_POR,
        STATUS
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED')
    `, [
      input.idempotencyToken,
      subempresa,
      year,
      serie,
      terminal,
      numero,
      input.repartidorId,
      roundMoney(totals.totalEfectivo),
      roundMoney(totals.totalCheques),
      roundMoney(totals.totalTarjeta),
      roundMoney(totals.totalPostdatados),
      roundMoney(totals.saldoActual),
      roundMoney(totals.totalCobrosDia),
      roundMoney(totals.gastos),
      roundMoney(totals.totalAIngresar),
      roundMoney(totals.ingresoBanco),
      roundMoney(totals.efectivo2),
      roundMoney(totals.entregado2),
      saldoResultante,
      input.createdBy || 'unknown',
    ]);

    await conn.query(`
      MERGE INTO JAVIER.REPARTIDOR_FINANCIAL_BALANCES B
      USING (VALUES (?, ?, ?)) AS V(CODIGO_REPARTIDOR, SALDO_PENDIENTE, UPDATED_BY)
        ON B.CODIGO_REPARTIDOR = V.CODIGO_REPARTIDOR
      WHEN MATCHED THEN
        UPDATE SET SALDO_PENDIENTE = V.SALDO_PENDIENTE,
                   UPDATED_BY = V.UPDATED_BY,
                   UPDATED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (CODIGO_REPARTIDOR, SALDO_PENDIENTE, UPDATED_BY)
        VALUES (V.CODIGO_REPARTIDOR, V.SALDO_PENDIENTE, V.UPDATED_BY)
    `, [input.repartidorId, saldoResultante, input.createdBy || 'unknown']);

    await conn.query(`
      UPDATE JAVIER.REPARTIDOR_COBROS
      SET LIQUIDADO_SN = 'S',
          LIQUIDACION_TOKEN = ?
      WHERE TRIM(CODIGO_REPARTIDOR) = ?
        AND DATE(FECHA_COBRO) = DATE(?)
        AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
    `, [input.idempotencyToken, input.repartidorId, input.date]);
  });

  const liquidacion = await findLiquidacionByToken(input.idempotencyToken);
  return { created: true, liquidacion };
}

async function getCommissionTiers() {
  const rows = await queryWithParams(`
    SELECT ID, THRESHOLD_PCT, COMMISSION_PCT, SORT_ORDER, ACTIVE_SN
    FROM JAVIER.REPARTIDOR_COMMISSION_TIERS
    WHERE ACTIVE_SN = 'S'
    ORDER BY SORT_ORDER, THRESHOLD_PCT
  `, [], false, false);
  return rows.map((row) => ({
    id: value(row, 'ID') == null ? null : String(value(row, 'ID')),
    thresholdPct: roundMoney(value(row, 'THRESHOLD_PCT')),
    commissionPct: roundMoney(value(row, 'COMMISSION_PCT')),
    sortOrder: toInt(value(row, 'SORT_ORDER')),
  }));
}

function calculateCommission({ deliveredAmount, collectedAmount, tiers }) {
  const delivered = roundMoney(deliveredAmount);
  const collected = roundMoney(collectedAmount);
  const reached = [];
  let total = 0;

  for (const tier of tiers) {
    const thresholdAmount = roundMoney(delivered * (toNumber(tier.thresholdPct) / 100));
    const excess = Math.max(0, collected - thresholdAmount);
    const amount = roundMoney(excess * (toNumber(tier.commissionPct) / 100));
    if (excess > 0) {
      reached.push({
        thresholdPct: toNumber(tier.thresholdPct),
        commissionPct: toNumber(tier.commissionPct),
        thresholdAmount,
        excess: roundMoney(excess),
        commission: amount,
      });
      total += amount;
    }
  }

  return {
    deliveredAmount: delivered,
    collectedAmount: collected,
    collectedPct: delivered > 0 ? roundMoney((collected / delivered) * 100) : 0,
    commission: roundMoney(total),
    reached,
  };
}

async function getCommissionSummary({ repartidorId, from, to }) {
  const deliveredRows = await queryWithParams(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM DSEDAC.OPP OPP
    INNER JOIN DSEDAC.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
    WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [repartidorId, compactDate(from), compactDate(to)], false, false);

  const collectedRows = await queryWithParams(`
    SELECT COALESCE(SUM(IMPORTE_COBRADO), 0) AS TOTAL_COBRADO
    FROM JAVIER.REPARTIDOR_COBROS
    WHERE TRIM(CODIGO_REPARTIDOR) = ?
      AND DATE(FECHA_COBRO) BETWEEN DATE(?) AND DATE(?)
  `, [repartidorId, from, to], false, false);

  const tiers = await getCommissionTiers();
  const result = calculateCommission({
    deliveredAmount: value(firstRow(deliveredRows), 'TOTAL_REPARTIDO'),
    collectedAmount: value(firstRow(collectedRows), 'TOTAL_COBRADO'),
    tiers,
  });

  return {
    repartidorId,
    range: { from, to },
    ...result,
    tiers,
  };
}

async function saveCommissionTiers({ tiers, updatedBy }) {
  await withTransaction(async (conn) => {
    await conn.query(`
      UPDATE JAVIER.REPARTIDOR_COMMISSION_TIERS
      SET ACTIVE_SN = 'N',
          UPDATED_BY = ?,
          UPDATED_AT = CURRENT_TIMESTAMP
      WHERE ACTIVE_SN = 'S'
    `, [updatedBy || 'unknown']);

    for (let index = 0; index < tiers.length; index++) {
      const tier = tiers[index];
      await conn.query(`
        INSERT INTO JAVIER.REPARTIDOR_COMMISSION_TIERS (
          THRESHOLD_PCT,
          COMMISSION_PCT,
          SORT_ORDER,
          ACTIVE_SN,
          CREATED_BY
        ) VALUES (?, ?, ?, 'S', ?)
      `, [
        roundMoney(tier.thresholdPct),
        roundMoney(tier.commissionPct),
        index + 1,
        updatedBy || 'unknown',
      ]);
    }
  });
  return getCommissionTiers();
}

async function deleteTestData(idempotencyToken) {
  await queryWithParams(`
    DELETE FROM JAVIER.REPARTIDOR_LIQUIDACION_EMAILS
    WHERE LIQUIDACION_OP_ID IN (
      SELECT ID FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS WHERE IDEMPOTENCY_TOKEN = ?
    )
  `, [idempotencyToken], false, false);
  await queryWithParams(`
    DELETE FROM JAVIER.REPARTIDOR_LIQUIDACION_OPS WHERE IDEMPOTENCY_TOKEN = ?
  `, [idempotencyToken], false, false);
  await queryWithParams(`
    DELETE FROM DSEDAC.LQD WHERE IDMARCALIQUIDACION = ?
  `, [idempotencyToken], false, false);
  await queryWithParams(`
    UPDATE JAVIER.REPARTIDOR_COBROS
    SET LIQUIDADO_SN = 'N',
        LIQUIDACION_TOKEN = NULL
    WHERE LIQUIDACION_TOKEN = ?
  `, [idempotencyToken], false, false);
}

function simplePdfBuffer(title, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).text(title, { align: 'center' });
    doc.moveDown();
    for (const line of lines) {
      doc.fontSize(10).text(line);
    }
    doc.end();
  });
}

async function sendLiquidacionEmails({ liquidacion, repartidorEmail, repartidorName, cobros }) {
  if (!liquidacion || !repartidorEmail) return [];
  const subject = `Liquidacion Diaria - GMP ${liquidacion.numero.display}`;
  const lines = [
    `Vendedor: ${liquidacion.repartidorId} ${repartidorName || ''}`,
    `Total Efectivo: ${liquidacion.totals.totalEfectivo.toFixed(2)} EUR`,
    `Total a Ingresar: ${liquidacion.totals.totalAIngresar.toFixed(2)} EUR`,
    `Ingreso en Banco: ${liquidacion.totals.ingresoBanco.toFixed(2)} EUR`,
    ...cobros.map((c) => `${c.fecha} ${c.codigoCliente} ${c.nombreCliente} ${c.documento} ${c.importe.toFixed(2)}`),
  ];
  const pdfBuffer = await simplePdfBuffer(subject, lines);
  const recipients = [repartidorEmail, ...INTERNAL_LIQUIDATION_RECIPIENTS];
  const results = [];
  for (const to of recipients) {
    try {
      const result = await sendEmailWithPdf({
        to,
        subject,
        htmlBody: `<p>${subject}</p>`,
        textBody: lines.join('\n'),
        pdfBuffer,
        pdfFilename: `${subject.replace(/\s+/g, '_')}.pdf`,
      });
      results.push({ to, success: true, result });
    } catch (error) {
      logger.error(`[REPARTIDOR_FINANZAS] Email failed to ${to}: ${error.message}`);
      results.push({ to, success: false, error: error.message });
    }
  }
  return results;
}

module.exports = {
  INTERNAL_LIQUIDATION_RECIPIENTS,
  findLiquidacionByToken,
  getDailySummary,
  getSummary,
  getVencimientos,
  registerCobro,
  confirmRuteroDeliveryWithCobro,
  closeLiquidacion,
  getCommissionSummary,
  getCommissionTiers,
  saveCommissionTiers,
  calculateCommission,
  deleteTestData,
  sendLiquidacionEmails,
};
