'use strict';

const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const {
  resolveDeliveryAmount,
  allowsEmptyPlannedLines,
} = require('../services/delivery-amount-resolver');

const ERP_SCHEMA = 'DSEDAC';
const CLIENT_CODE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,39}$/;
const DRIVER_CODE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,39}$/;

class RepartoPlannedDeliveryError extends RepartoPersistenceError {
  constructor(message, { code = 'REPARTO_PLANNED_DELIVERY_UNAVAILABLE', statusCode = 503, details } = {}) {
    super(message, { code, statusCode, details });
    this.name = 'RepartoPlannedDeliveryError';
  }
}

function text(row, name) {
  const value = row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
  return value == null ? '' : String(value).trim();
}

function number(row, name) {
  const value = row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDeliveryItemId(itemId) {
  if (typeof itemId !== 'string') return null;
  const parts = itemId.trim().split('-');
  if (parts.length < 4) return null;
  const [yearRaw, serieRaw, terminalRaw, numberRaw, ...clientParts] = parts;
  if (!/^\d{4}$/.test(yearRaw) || !/^[A-Za-z0-9]{1,5}$/.test(serieRaw)
    || !/^\d{1,3}$/.test(terminalRaw) || !/^\d{1,9}$/.test(numberRaw)) return null;
  const ejercicio = Number(yearRaw);
  const terminal = Number(terminalRaw);
  const numero = Number(numberRaw);
  if (ejercicio < 2000 || ejercicio > 2100 || terminal < 0 || numero < 1) return null;
  const cliente = clientParts.length ? clientParts.join('-').trim() : null;
  if (cliente !== null && !CLIENT_CODE_PATTERN.test(cliente)) return null;
  return Object.freeze({ ejercicio, serie: serieRaw, terminal, numero, cliente });
}

function assertConnection(connection) {
  if (!connection || (typeof connection.query !== 'function' && typeof connection.execute !== 'function')) {
    throw new TypeError('DB2 connection must expose query(sql, params) or execute(sql, params)');
  }
}

function assertRepartidorId(repartidorId) {
  const value = String(repartidorId || '').trim();
  if (!DRIVER_CODE_PATTERN.test(value)) {
    throw new RepartoPlannedDeliveryError('Identidad de repartidor invalida', {
      code: 'INVALID_DELIVERY_IDENTITY', statusCode: 400,
    });
  }
  return value;
}

function assertItemIdentity(itemId) {
  const parsed = parseDeliveryItemId(itemId);
  if (!parsed) {
    throw new RepartoPlannedDeliveryError('Identificador de entrega invalido', {
      code: 'INVALID_DELIVERY_IDENTITY', statusCode: 400,
    });
  }
  return parsed;
}

function validateSchema(schema) {
  if (schema !== ERP_SCHEMA) {
    throw new RepartoPlannedDeliveryError('El puerto de lectura planificada solo admite DSEDAC', {
      code: 'REPARTO_PLANNED_DELIVERY_UNAVAILABLE', statusCode: 503, details: { schema },
    });
  }
  return schema;
}

function cancelConnection(connection) {
  if (typeof connection?.cancel !== 'function') return;
  try {
    Promise.resolve(connection.cancel()).catch(() => {});
  } catch (_) {
    // Cancellation is best effort; the caller still closes the connection.
  }
}

function abortError(signal) {
  if (signal?.reason instanceof RepartoPersistenceError) return signal.reason;
  return new RepartoPlannedDeliveryError('La consulta de entrega fue cancelada', {
    code: 'REPARTO_PLANNED_DELIVERY_TIMEOUT', statusCode: 504,
  });
}

async function executeRows(connection, sql, params, signal) {
  try {
    if (signal?.aborted) throw abortError(signal);
    const operation = Promise.resolve().then(() => typeof connection.query === 'function'
      ? connection.query(sql, params)
      : connection.execute(sql, params));
    if (!signal) {
      const result = await operation;
      return Array.isArray(result) ? result : (result?.rows || []);
    }
    let abortHandler;
    const aborted = new Promise((_, reject) => {
      abortHandler = () => {
        cancelConnection(connection);
        reject(abortError(signal));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) abortHandler();
    });
    try {
      const result = await Promise.race([operation, aborted]);
      if (signal.aborted) throw abortError(signal);
      return Array.isArray(result) ? result : (result?.rows || []);
    } finally {
      signal.removeEventListener('abort', abortHandler);
    }
  } catch (_) {
    if (signal?.aborted) throw abortError(signal);
    throw new RepartoPlannedDeliveryError('No se pudo consultar la entrega planificada', {
      code: 'REPARTO_PLANNED_DELIVERY_UNAVAILABLE', statusCode: 503,
    });
  }
}

function normalizeOwnerScope(repartidorId, options = {}) {
  const requested = [repartidorId, ...(Array.isArray(options.allowedRepartidorIds)
    ? options.allowedRepartidorIds : [])];
  const ownerIds = [...new Set(requested.map(assertRepartidorId))];
  if (ownerIds.length > 100) {
    throw new RepartoPlannedDeliveryError('El alcance de repartidores es demasiado amplio', {
      code: 'DELIVERY_OWNERSHIP_REQUIRED', statusCode: 403,
    });
  }
  return ownerIds;
}

function headerQuery(schema, includeClient, ownerIds = []) {
  const clientClause = includeClient ? ' AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?' : '';
  const ownerClause = ownerIds.length === 1
    ? ' AND TRIM(OPP.CODIGOREPARTIDOR) = ?'
    : ` AND TRIM(OPP.CODIGOREPARTIDOR) IN (${ownerIds.map(() => '?').join(',')})`;
  return `
    SELECT
      TRIM(CPC.SUBEMPRESAALBARAN) AS SUBEMPRESA,
      CPC.EJERCICIOALBARAN,
      TRIM(CPC.SERIEALBARAN) AS SERIEALBARAN,
      CPC.TERMINALALBARAN,
      CPC.NUMEROALBARAN,
      TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
      TRIM(CPC.CODIGOFORMAPAGO) AS FORMA_PAGO,
      TRIM(PC.CODIGO) AS CATALOGO_FORMA_PAGO,
      TRIM(PC.DEBE_COBRAR) AS DEBE_COBRAR,
      TRIM(CLX.COBRORIGUROSOSN) AS COBRO_RIGUROSO,
      COALESCE(NULLIF((
        SELECT MAX(CLP.IMPORTELIMITERIESGO)
        FROM ${schema}.CLP CLP
        WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
      ), 0), (
        SELECT MAX(CLP.IMPORTELIMITERIESGOEMPRESA)
        FROM ${schema}.CLP CLP
        WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
      ), 0) AS LIMITE_CREDITO,
      COALESCE((
        SELECT SUM(CVC.IMPORTEPENDIENTE)
        FROM ${schema}.CVC CVC
        WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
          AND COALESCE(CVC.ANULADOSN, '') <> 'S'
          AND CVC.IMPORTEPENDIENTE <> 0
      ), 0) AS RIESGO_CREDITO_ACTUAL,
      TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, CPC.CODIGOCLIENTEALBARAN)) AS NOMBRECLIENTE,
      TRIM(OPP.CODIGOREPARTIDOR) AS CODIGOREPARTIDOR,
      CPC.EJERCICIOPEDIDO,
      CPC.NUMEROPEDIDO,
      CPC.IMPORTETOTAL,
      CAC.IMPORTETOTAL AS CAC_IMPORTETOTAL
    FROM ${schema}.CPC CPC
    INNER JOIN ${schema}.OPP OPP
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
      AND TRIM(OPP.SUBEMPRESA) = TRIM(CPC.SUBEMPRESAPEDIDO)
    LEFT JOIN ${schema}.CLI CLI
      ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
    LEFT JOIN JAVIER.PAYMENT_CONDITIONS PC
      ON TRIM(PC.CODIGO) = TRIM(CPC.CODIGOFORMAPAGO)
      AND PC.ACTIVO = 'S'
    LEFT JOIN ${schema}.CLX CLX
      ON TRIM(CLX.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
    LEFT JOIN ${schema}.CAC CAC
      ON CAC.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
      AND CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
      AND TRIM(CAC.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
      AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
      AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
      AND TRIM(CAC.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
    WHERE CPC.EJERCICIOALBARAN = ?
      AND TRIM(CPC.SERIEALBARAN) = ?
      AND CPC.TERMINALALBARAN = ?
      AND CPC.NUMEROALBARAN = ?
      ${ownerClause}${clientClause}
    ORDER BY TRIM(CPC.SUBEMPRESAALBARAN), TRIM(CPC.CODIGOCLIENTEALBARAN), CPC.EJERCICIOALBARAN,
      TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
  `;
}

function financialDocumentQuery(schema) {
  return `
    SELECT
      TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
      TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
      TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
      CVC.EJERCICIODOCUMENTO,
      TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
      CVC.TERMINALDOCUMENTO,
      CVC.NUMERODOCUMENTO,
      CVC.XDEDOCUMENTO,
      CVC.DEXDOCUMENTO,
      CVC.IMPORTEPENDIENTE
    FROM ${schema}.CVC CVC
    WHERE TRIM(CVC.SUBEMPRESADOCUMENTO) = ?
      AND CVC.EJERCICIODOCUMENTO = ?
      AND TRIM(CVC.SERIEDOCUMENTO) = ?
      AND CVC.TERMINALDOCUMENTO = ?
      AND CVC.NUMERODOCUMENTO = ?
      AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?
      AND COALESCE(TRIM(CVC.ANULADOSN), '') <> 'S'
      AND CVC.IMPORTEPENDIENTE > 0
    ORDER BY TRIM(CVC.TIPODOCUMENTO), TRIM(CVC.ORIGENDOCUMENTO),
      TRIM(CVC.SUBEMPRESADOCUMENTO), CVC.EJERCICIODOCUMENTO,
      TRIM(CVC.SERIEDOCUMENTO), CVC.TERMINALDOCUMENTO,
      CVC.NUMERODOCUMENTO, CVC.XDEDOCUMENTO, CVC.DEXDOCUMENTO
    FETCH FIRST 2 ROWS ONLY
  `;
}

function linesQuery(schema) {
  return `
    SELECT
      LAC.SECUENCIA,
      TRIM(LAC.CODIGOARTICULO) AS CODIGOARTICULO,
      TRIM(LAC.DESCRIPCION) AS DESCRIPCION,
      LAC.CANTIDADENVASES,
      LAC.CANTIDADUNIDADES,
      TRIM(LAC.UNIDADMEDIDA) AS UNIDADMEDIDA,
      LAC.PRECIOVENTA,
      LAC.IMPORTEVENTA
    FROM ${schema}.LAC LAC
    WHERE TRIM(LAC.SUBEMPRESAALBARAN) = ?
      AND LAC.EJERCICIOALBARAN = ?
      AND TRIM(LAC.SERIEALBARAN) = ?
      AND LAC.TERMINALALBARAN = ?
      AND LAC.NUMEROALBARAN = ?
      AND TRIM(LAC.CODIGOCLIENTEALBARAN) = ?
      AND (LAC.CANTIDADUNIDADES > 0 OR LAC.CANTIDADENVASES > 0)
    ORDER BY LAC.SECUENCIA, TRIM(LAC.CODIGOARTICULO)
  `;
}

function mapLines(rows, { allowEmpty = false } = {}) {
  if (!rows.length) {
    if (allowEmpty) return [];
    throw new RepartoPlannedDeliveryError('La entrega planificada no contiene lineas', {
      code: 'DELIVERY_SOURCE_INCONSISTENT', statusCode: 409,
    });
  }
  const seen = new Set();
  return rows.map((row) => {
    const sequence = number(row, 'SECUENCIA');
    const cantidadUnidades = number(row, 'CANTIDADUNIDADES');
    const cantidadEnvases = number(row, 'CANTIDADENVASES');
    const cantidadPedida = (cantidadUnidades != null && cantidadUnidades > 0)
      ? cantidadUnidades
      : cantidadEnvases;
    const codigoArticulo = text(row, 'CODIGOARTICULO') || (Number.isInteger(sequence) ? String(sequence) : '');
    const importeLinea = number(row, 'IMPORTEVENTA');
    const precioVenta = number(row, 'PRECIOVENTA');
    if (!Number.isInteger(sequence) || sequence < 0 || !codigoArticulo || cantidadPedida == null
      || cantidadPedida <= 0 || cantidadEnvases == null || cantidadEnvases < 0
      || importeLinea == null || importeLinea < 0 || precioVenta == null || precioVenta < 0) {
      throw new RepartoPlannedDeliveryError('Las lineas planificadas no tienen identidad o cantidades validas', {
        code: 'DELIVERY_SOURCE_INCONSISTENT', statusCode: 409,
      });
    }
    const lineaId = String(sequence);
    if (seen.has(lineaId)) {
      throw new RepartoPlannedDeliveryError('La entrega planificada contiene lineas ambiguas', {
        code: 'DELIVERY_IDENTITY_AMBIGUOUS', statusCode: 409,
      });
    }
    seen.add(lineaId);
    const precioUnitario = importeLinea / cantidadPedida;
    return Object.freeze({
      lineaId,
      codigoArticulo,
      descripcion: text(row, 'DESCRIPCION'),
      cantidadPedida,
      cantidadEnvases,
      unidadMedida: text(row, 'UNIDADMEDIDA'),
      precioUnitario,
      importeLinea,
    });
  });
}

function mapFinancialDocument(rows) {
  if (!rows.length) {
    return Object.freeze({ state: 'MISSING', document: null, importePendiente: 0 });
  }
  if (rows.length !== 1) {
    return Object.freeze({ state: 'AMBIGUOUS', document: null, importePendiente: null });
  }
  const row = rows[0];
  const document = {
    tipo: text(row, 'TIPODOCUMENTO'),
    origen: text(row, 'ORIGENDOCUMENTO'),
    subempresa: text(row, 'SUBEMPRESADOCUMENTO'),
    ejercicio: number(row, 'EJERCICIODOCUMENTO'),
    serie: text(row, 'SERIEDOCUMENTO'),
    terminal: number(row, 'TERMINALDOCUMENTO'),
    numero: number(row, 'NUMERODOCUMENTO'),
    xde: number(row, 'XDEDOCUMENTO'),
    dex: number(row, 'DEXDOCUMENTO'),
  };
  const importePendiente = number(row, 'IMPORTEPENDIENTE');
  if (!document.tipo || !document.origen || !document.subempresa || !document.serie
    || !Number.isInteger(document.ejercicio) || !Number.isInteger(document.terminal)
    || !Number.isInteger(document.numero) || !Number.isInteger(document.xde)
    || !Number.isInteger(document.dex) || importePendiente == null) {
    throw new RepartoPlannedDeliveryError('El documento financiero no tiene identidad o saldo validos', {
      code: 'DELIVERY_SOURCE_INCONSISTENT', statusCode: 409,
    });
  }
  if (importePendiente <= 0) {
    return Object.freeze({ state: 'MISSING', document: null, importePendiente: 0 });
  }
  return Object.freeze({
    state: 'AVAILABLE', document: Object.freeze(document), importePendiente,
  });
}

function mapHeader(row, itemId, lineas, financial, resolvedAmount) {
  const subempresa = text(row, 'SUBEMPRESA');
  const codigoCliente = text(row, 'CODIGOCLIENTE');
  const repartidorId = text(row, 'CODIGOREPARTIDOR');
  const formaPago = text(row, 'FORMA_PAGO');
  const catalogoFormaPago = text(row, 'CATALOGO_FORMA_PAGO');
  const ejercicio = number(row, 'EJERCICIOALBARAN');
  const terminal = number(row, 'TERMINALALBARAN');
  const numero = number(row, 'NUMEROALBARAN');
  const serie = text(row, 'SERIEALBARAN');
  const importeTotal = resolvedAmount.amount;
  const limiteCredito = number(row, 'LIMITE_CREDITO') || 0;
  const riesgoCreditoActual = number(row, 'RIESGO_CREDITO_ACTUAL') || 0;
  const cobroRiguroso = text(row, 'COBRO_RIGUROSO') === 'S';
  const creditoSuperaLimite = limiteCredito > 0
    && (riesgoCreditoActual + importeTotal) > limiteCredito;
  if (!subempresa || !codigoCliente || !repartidorId || !serie || !Number.isInteger(ejercicio)
    || !Number.isInteger(terminal) || !Number.isInteger(numero) || importeTotal == null) {
    throw new RepartoPlannedDeliveryError('La cabecera planificada no tiene los datos requeridos', {
      code: 'DELIVERY_SOURCE_INCONSISTENT', statusCode: 409,
    });
  }
  if (formaPago && !catalogoFormaPago) {
    throw new RepartoPlannedDeliveryError('La forma de pago del albaran no figura en el catalogo autorizado', {
      code: 'PAYMENT_CATALOG_UNAVAILABLE', statusCode: 503,
    });
  }
  return Object.freeze({
    documentId: itemId,
    repartidorId,
    cliente: Object.freeze({ codigo: codigoCliente, nombre: text(row, 'NOMBRECLIENTE') || codigoCliente }),
    pedido: Object.freeze({ ejercicio: number(row, 'EJERCICIOPEDIDO'), numero: number(row, 'NUMEROPEDIDO') }),
    document: Object.freeze({
      subempresa, ejercicio, serie, terminal, numero,
    }),
    importeTotal,
    amountSource: resolvedAmount.source,
    pricingState: resolvedAmount.pricingState,
    formaPago,
    cobroObligatorio: text(row, 'DEBE_COBRAR') === 'S' || cobroRiguroso || creditoSuperaLimite,
    cobroRiguroso,
    creditoSuperaLimite,
    limiteCredito,
    riesgoCreditoActual,
    importePendiente: financial.importePendiente,
    financialDocumentState: financial.state,
    financialDocument: financial.document,
    lineas,
  });
}

function createRepartoPlannedDeliveryDb2Port({ schema = ERP_SCHEMA } = {}) {
  const safeSchema = validateSchema(schema);

  async function getPlannedDelivery(connection, itemId, repartidorId, options = {}) {
    assertConnection(connection);
    const identity = assertItemIdentity(itemId);
    const safeRepartidorId = assertRepartidorId(repartidorId);
    const ownerIds = normalizeOwnerScope(safeRepartidorId, options);
    const headerParams = [identity.ejercicio, identity.serie, identity.terminal, identity.numero, ...ownerIds];
    if (identity.cliente) headerParams.push(identity.cliente);
    const headers = await executeRows(connection, headerQuery(safeSchema, Boolean(identity.cliente), ownerIds), headerParams, options.signal);
    if (!headers.length) {
      throw new RepartoPlannedDeliveryError('Entrega no encontrada', {
        code: 'DELIVERY_NOT_FOUND', statusCode: 404,
      });
    }
    if (headers.length !== 1) {
      throw new RepartoPlannedDeliveryError('La identidad de entrega no es inequivoca', {
        code: 'DELIVERY_IDENTITY_AMBIGUOUS', statusCode: 409,
      });
    }
    const header = headers[0];
    const documentParams = [
      text(header, 'SUBEMPRESA'), number(header, 'EJERCICIOALBARAN'), text(header, 'SERIEALBARAN'),
      number(header, 'TERMINALALBARAN'), number(header, 'NUMEROALBARAN'), text(header, 'CODIGOCLIENTE'),
    ];
    const rawLines = await executeRows(connection, linesQuery(safeSchema), documentParams, options.signal);
    const provisionalLines = mapLines(rawLines, { allowEmpty: true });
    const lineSum = provisionalLines.reduce((sum, line) => sum + Number(line.importeLinea || 0), 0);
    const zeroPriceQtyLines = provisionalLines.filter(
      (line) => Number(line.cantidadPedida) > 0 && Math.abs(Number(line.importeLinea) || 0) < 0.005,
    ).length;
    const resolvedAmount = resolveDeliveryAmount({
      cpcTotal: number(header, 'IMPORTETOTAL') || 0,
      cacTotal: number(header, 'CAC_IMPORTETOTAL') || 0,
      lacLineSum: lineSum,
      qtyLines: provisionalLines.length,
      zeroPriceQtyLines,
    });
    if (!allowsEmptyPlannedLines({
      importeTotal: resolvedAmount.amount,
      qtyLines: provisionalLines.length,
      pricingState: resolvedAmount.pricingState,
    }) && provisionalLines.length === 0) {
      throw new RepartoPlannedDeliveryError('La entrega planificada no contiene lineas', {
        code: 'DELIVERY_SOURCE_INCONSISTENT', statusCode: 409,
      });
    }
    const lineas = provisionalLines;
    const financial = mapFinancialDocument(await executeRows(
      connection,
      financialDocumentQuery(safeSchema),
      documentParams,
      options.signal,
    ));
    return mapHeader(header, itemId, lineas, financial, resolvedAmount);
  }

  return Object.freeze({
    getPlannedDelivery,
    forConnection(connection) {
      assertConnection(connection);
      return Object.freeze({
        getPlannedDelivery: (itemId, repartidorId, options) =>
          getPlannedDelivery(connection, itemId, repartidorId, options),
      });
    },
  });
}

module.exports = {
  ERP_SCHEMA,
  RepartoPlannedDeliveryError,
  createRepartoPlannedDeliveryDb2Port,
  parseDeliveryItemId,
};
