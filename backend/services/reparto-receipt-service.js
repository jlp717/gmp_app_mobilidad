'use strict';

const { RepartoPersistenceError } = require('./reparto-confirmation-service');

function text(value) {
  return value == null ? null : String(value).trim();
}

function row(source, name) {
  return source?.[name] ?? source?.[name.toLowerCase()] ?? source?.[name.toUpperCase()];
}

function numeric(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAdmin(actor) {
  return String(actor?.role || '').trim().toUpperCase() === 'ADMIN';
}

function unavailable(code, message) {
  return new RepartoPersistenceError(message, { code, statusCode: 503 });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new RepartoPersistenceError('La consulta del recibo fue cancelada', {
      code: 'REPARTO_RECEIPT_TIMEOUT', statusCode: 504,
    });
  }
}

function assertRepository(repository) {
  if (!repository || typeof repository.getReceipt !== 'function') {
    throw new TypeError('A reparto receipt repository is required');
  }
}

function assertActor(actor) {
  if (!actor || (!isAdmin(actor) && !text(actor.repartidorId))) {
    throw new RepartoPersistenceError('Repartidor autenticado requerido', {
      code: 'REPARTO_RECEIPT_ACTOR_REQUIRED', statusCode: 403,
    });
  }
}

function receiptLine(source) {
  const ordered = numeric(row(source, 'CANTIDAD_PEDIDA'));
  const delivered = numeric(row(source, 'CANTIDAD_ENTREGADA'));
  const rejected = numeric(row(source, 'CANTIDAD_RECHAZADA'));
  const pending = numeric(row(source, 'CANTIDAD_PENDIENTE'));
  const price = numeric(row(source, 'PRECIO_UNITARIO'));
  if ([ordered, delivered, rejected, pending].some((item) => item == null || item < 0)
      || Math.abs(ordered - delivered - rejected - pending) > 0.0001) {
    throw unavailable('REPARTO_RECEIPT_QUANTITIES_UNAVAILABLE', 'Las cantidades del recibo no son consistentes');
  }
  if (price == null || price < 0) {
    throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
  }
  return Object.freeze({
    lineaId: text(row(source, 'LINEA_ID')),
    codigoArticulo: text(row(source, 'CODIGO_ARTICULO')),
    descripcion: text(row(source, 'DESCRIPCION')),
    cantidadPedida: ordered,
    cantidadEntregada: delivered,
    cantidadRechazada: rejected,
    cantidadPendiente: pending,
    motivoDiferencia: text(row(source, 'MOTIVO_DIFERENCIA')),
    observaciones: text(row(source, 'OBSERVACIONES')),
    precioUnitario: price,
  });
}

function validCalendarDate(day, month, year) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)
      || year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function payment(source, confirmation) {
  if (!source) return null;
  const fields = [
    ['IDEMPOTENCY_TOKEN', 'IDEMPOTENCY_KEY'],
    ['CODIGOCLIENTEALBARAN', 'CLIENTE_CODIGO'],
    ['CODIGOVENDEDOR', 'REPARTIDOR_ID'],
    ['TIPODOCUMENTO', 'DOCUMENTO_TIPO'],
    ['ORIGENDOCUMENTO', 'DOCUMENTO_ORIGEN'],
    ['SUBEMPRESADOCUMENTO', 'DOCUMENTO_SUBEMPRESA'],
    ['EJERCICIODOCUMENTO', 'DOCUMENTO_EJERCICIO'],
    ['SERIEDOCUMENTO', 'DOCUMENTO_SERIE'],
    ['TERMINALDOCUMENTO', 'DOCUMENTO_TERMINAL'],
    ['NUMERODOCUMENTO', 'DOCUMENTO_NUMERO'],
    ['XDEDOCUMENTO', 'DOCUMENTO_XDE'],
    ['DEXDOCUMENTO', 'DOCUMENTO_DEX'],
  ];
  if (fields.some(([paymentField, confirmationField]) =>
    !text(row(source, paymentField))
    || text(row(source, paymentField)) !== text(row(confirmation, confirmationField)))) {
    throw unavailable('REPARTO_RECEIPT_PAYMENT_UNAVAILABLE', 'El cobro no corresponde a la confirmacion');
  }
  const amount = numeric(row(source, 'IMPORTEVENCIMIENTO'));
  const day = numeric(row(source, 'DIACOBRO'));
  const month = numeric(row(source, 'MESCOBRO'));
  const year = numeric(row(source, 'ANOCOBRO'));
  if (!text(row(source, 'ID')) || amount == null || amount <= 0
      || !text(row(source, 'CODIGOFORMAPAGO'))
      || !validCalendarDate(day, month, year)) {
    throw unavailable('REPARTO_RECEIPT_PAYMENT_UNAVAILABLE', 'El cobro del recibo no es valido');
  }
  return Object.freeze({
    id: String(row(source, 'ID')),
    importeCobrado: amount,
    formaPago: text(row(source, 'CODIGOFORMAPAGO')),
    fecha: Object.freeze({ dia: day, mes: month, ano: year }),
  });
}

function createRepartoReceiptService({ repository } = {}) {

function isExactZeroPrepaid(confirmation, storedLines, payments) {
  if (text(row(confirmation, 'STATUS')) !== 'ENTREGADO'
      || !Array.isArray(storedLines) || storedLines.length !== 0
      || !Array.isArray(payments) || payments.length !== 0) return false;
  const raw = row(confirmation, 'RESULT_JSON');
  let result;
  try {
    result = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_error) {
    return false;
  }
  const proof = result?.receiptProof;
  return proof?.prepaidZeroWithoutLines === true
    && proof.plannedImporteTotal === 0
    && proof.plannedLineCount === 0
    && proof.actualLineCount === 0;
}
  assertRepository(repository);

  async function getReceipt({ confirmationId, idempotencyKey, actor, signal } = {}) {
    assertActor(actor);
    throwIfAborted(signal);
    const admin = isAdmin(actor);
    const stored = await repository.getReceipt({
      confirmationId,
      idempotencyKey,
      ownerRepartidorId: admin ? null : text(actor.repartidorId),
      allowAnyOwner: admin,
      signal,
    });
    throwIfAborted(signal);
    if (!stored) {
      throw new RepartoPersistenceError('Confirmacion de reparto no encontrada', {
        code: 'REPARTO_RECEIPT_NOT_FOUND', statusCode: 404,
      });
    }
    const confirmation = stored.confirmation;
    if (!admin
        && text(row(confirmation, 'REPARTIDOR_ID')) !== text(actor.repartidorId)) {
      throw new RepartoPersistenceError('El recibo no pertenece al repartidor autenticado', {
        code: 'REPARTO_RECEIPT_OWNERSHIP_REQUIRED', statusCode: 403,
      });
    }
    if (!Array.isArray(stored.payments) || stored.payments.length > 1) {
      throw new RepartoPersistenceError('El recibo tiene cobros ambiguos', {
        code: 'REPARTO_RECEIPT_PAYMENT_AMBIGUOUS', statusCode: 409,
      });
    }
    if (!Array.isArray(stored.lines)) {
      throw unavailable('REPARTO_RECEIPT_LINES_UNAVAILABLE', 'El recibo no contiene lineas confirmadas');
    }
    const zeroPrepaid = isExactZeroPrepaid(confirmation, stored.lines, stored.payments);
    const lines = stored.lines.map(receiptLine);
    if (!lines.length && !zeroPrepaid) {
      throw unavailable('REPARTO_RECEIPT_LINES_UNAVAILABLE', 'El recibo no contiene lineas confirmadas');
    }
    const importeTotal = zeroPrepaid ? 0 : lines.reduce(
      (sum, line) => sum + (line.cantidadEntregada * line.precioUnitario), 0,
    );
    const evidence = (stored.evidences || []).map((item) => Object.freeze({
      evidenceId: text(row(item, 'EVIDENCE_ID')),
      kind: text(row(item, 'EVIDENCE_KIND')),
      mimeType: text(row(item, 'MIME_TYPE')),
    }));
    const signature = text(row(confirmation, 'FIRMA_EVIDENCE_ID'));
    if (signature && !evidence.some((item) =>
      item.evidenceId === signature && item.kind === 'FIRMA')) {
      throw unavailable('REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', 'La firma del recibo no esta disponible');
    }
    throwIfAborted(signal);
    return Object.freeze({
      confirmationId: String(row(confirmation, 'ID')),
      idempotencyKey: text(row(confirmation, 'IDEMPOTENCY_KEY')),
      documentId: text(row(confirmation, 'DOCUMENT_ID')),
      repartidorId: text(row(confirmation, 'REPARTIDOR_ID')),
      pedido: Object.freeze({
        ejercicio: numeric(row(confirmation, 'PEDIDO_EJERCICIO')),
        numero: numeric(row(confirmation, 'PEDIDO_NUMERO')),
      }),
      documento: Object.freeze({
        tipo: text(row(confirmation, 'DOCUMENTO_TIPO')),
        origen: text(row(confirmation, 'DOCUMENTO_ORIGEN')),
        subempresa: text(row(confirmation, 'DOCUMENTO_SUBEMPRESA')),
        ejercicio: numeric(row(confirmation, 'DOCUMENTO_EJERCICIO')),
        serie: text(row(confirmation, 'DOCUMENTO_SERIE')),
        terminal: numeric(row(confirmation, 'DOCUMENTO_TERMINAL')),
        numero: numeric(row(confirmation, 'DOCUMENTO_NUMERO')),
        xde: numeric(row(confirmation, 'DOCUMENTO_XDE')),
        dex: numeric(row(confirmation, 'DOCUMENTO_DEX')),
      }),
      status: text(row(confirmation, 'STATUS')),
      occurredAt: row(confirmation, 'OCCURRED_AT'),
      confirmedAt: row(confirmation, 'CONFIRMED_AT'),
      coordenadas: Object.freeze({
        latitud: numeric(row(confirmation, 'LATITUD')),
        longitud: numeric(row(confirmation, 'LONGITUD')),
      }),
      cliente: Object.freeze({
        codigo: text(row(confirmation, 'CLIENTE_CODIGO')),
        nombre: text(row(confirmation, 'CLIENTE_NOMBRE')),
      }),
      receptor: Object.freeze({
        nombre: text(row(confirmation, 'RECEPTOR_NOMBRE')),
        apellidos: text(row(confirmation, 'RECEPTOR_APELLIDOS')),
        dni: text(row(confirmation, 'RECEPTOR_DNI')),
      }),
      incidencia: Object.freeze({
        codigo: text(row(confirmation, 'INCIDENCIA_CODIGO')),
        descripcion: text(row(confirmation, 'INCIDENCIA_DESCRIPCION')),
        observaciones: text(row(confirmation, 'INCIDENCIA_OBSERVACIONES')),
      }),
      observaciones: text(row(confirmation, 'OBSERVACIONES')),
      firmaEvidenceId: signature,
      prepaidZeroWithoutLines: zeroPrepaid,
      importeTotal,
      lineas: Object.freeze(lines),
      evidencias: Object.freeze(evidence),
      cobro: payment(stored.payments[0], confirmation),
    });
  }

  return Object.freeze({ getReceipt });
}

module.exports = { createRepartoReceiptService, validCalendarDate };
