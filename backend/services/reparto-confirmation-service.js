'use strict';

const crypto = require('crypto');
const { allowsEmptyPlannedLines, PRICING_STATE } = require('./delivery-amount-resolver');
const { invalidateCachePattern } = require('./redis-cache');
const logger = require('../middleware/logger');

class RepartoPersistenceError extends Error {
  constructor(message, { code, statusCode = 409, details } = {}) {
    super(message);
    this.name = 'RepartoPersistenceError';
    this.code = code || 'REPARTO_PERSISTENCE_ERROR';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const REPLAY_DELIVERY_STATUSES = new Set([
  'ENTREGADO',
  'PARCIAL',
  'NO_ENTREGADO',
  'RECHAZADO',
]);

function replayUnavailable() {
  return new RepartoPersistenceError(
    'El resultado persistido del replay no esta disponible',
    {
      code: 'REPARTO_CONFIRMATION_REPLAY_UNAVAILABLE',
      statusCode: 503,
    },
  );
}

function normalizeReplayId(value, { optional = false } = {}) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw replayUnavailable();

  const normalized = String(value).trim();
  if (!/^[1-9]\d*$/.test(normalized)) throw replayUnavailable();
  if (!Number.isSafeInteger(Number(normalized))) throw replayUnavailable();
  return normalized;
}

function validatePersistedReplayResult(result, { expectsCobro }) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw replayUnavailable();
  }

  const deliveryStatus = typeof result.deliveryStatus === 'string'
    ? result.deliveryStatus.trim()
    : '';
  const confirmedAt = result.confirmedAt;
  const parsedConfirmedAt = typeof confirmedAt === 'string' ? new Date(confirmedAt) : null;
  if (
    !REPLAY_DELIVERY_STATUSES.has(deliveryStatus)
    || !parsedConfirmedAt
    || Number.isNaN(parsedConfirmedAt.getTime())
    || parsedConfirmedAt.toISOString() !== confirmedAt
  ) {
    throw replayUnavailable();
  }
  const hasCobroId = result.cobroId != null;
  if (Boolean(expectsCobro) !== hasCobroId) {
    throw replayUnavailable();
  }

  return Object.freeze({
    confirmationId: normalizeReplayId(result.confirmationId),
    deliveryStatus,
    cobroId: expectsCobro ? normalizeReplayId(result.cobroId) : null,
    confirmedAt,
    created: false,
    idempotent: true,
  });
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    const current = value[key];
    if (current !== undefined) result[key] = stableValue(current);
    return result;
  }, {});
}

function confirmationFingerprint(command) {
  const delivery = command.delivery || {};
  const cobro = command.cobro ? {
    entregaId: command.cobro.entregaId || delivery.itemId,
    importeCobrado: command.cobro.importeCobrado,
    formaPago: command.cobro.formaPago,
    notas: command.cobro.notas,
  } : null;
  const canonical = stableValue({
    repartidorId: command.actor?.repartidorId,
    delivery: {
      itemId: delivery.itemId,
      status: delivery.status,
      occurredAt: delivery.occurredAt,
      receiver: delivery.receiver || null,
      lineas: delivery.lineas,
      firma: delivery.firma || null,
      evidencias: delivery.evidencias || [],
      incidencia: delivery.incidencia || null,
      observaciones: delivery.observaciones || null,
      latitud: delivery.latitud ?? null,
      longitud: delivery.longitud ?? null,
    },
    cobro,
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function sameText(left, right) {
  return normalizeText(left).toUpperCase() === normalizeText(right).toUpperCase();
}

function sameNumber(left, right) {
  return Math.abs(Number(left) - Number(right)) <= 0.0001;
}

function assertRepository(repository) {
  if (!repository || typeof repository.withTransaction !== 'function') {
    throw new TypeError('A transactional reparto confirmation repository is required');
  }
}

function assertPlannedDelivery(planned, command) {
  if (!planned) {
    throw new RepartoPersistenceError('Entrega no encontrada', {
      code: 'DELIVERY_NOT_FOUND',
      statusCode: 404,
    });
  }
  const ownerScope = Array.isArray(command.actor.allowedRepartidorIds)
    ? command.actor.allowedRepartidorIds : [command.actor.repartidorId];
  const reassignmentAllowed = command.actor.privileged === true
    && ownerScope.some((owner) => sameText(planned.repartidorId, owner))
    && ownerScope.some((owner) => sameText(command.actor.repartidorId, owner));
  if (!sameText(planned.repartidorId, command.actor.repartidorId) && !reassignmentAllowed) {
    throw new RepartoPersistenceError('La entrega no pertenece al repartidor autenticado', {
      code: 'DELIVERY_OWNERSHIP_REQUIRED',
      statusCode: 403,
    });
  }

  const plannedLines = new Map((planned.lineas || []).map((line) => [
    normalizeText(line.lineaId),
    line,
  ]));
  if (plannedLines.size !== command.delivery.lineas.length) {
    throw new RepartoPersistenceError('Las lineas no coinciden con el documento planificado', {
      code: 'PLANNED_LINES_MISMATCH',
      statusCode: 422,
    });
  }
  if (plannedLines.size === 0) {
    if (!allowsEmptyPlannedLines({
      importeTotal: planned.importeTotal,
      qtyLines: 0,
      pricingState: planned.pricingState,
    })) {
      throw new RepartoPersistenceError('Las lineas no coinciden con el documento planificado', {
        code: 'PLANNED_LINES_MISMATCH',
        statusCode: 422,
      });
    }
    return [];
  }

  const actualLines = command.delivery.lineas.map((actual) => {
    const source = plannedLines.get(normalizeText(actual.lineaId));
    if (!source || !sameText(source.codigoArticulo, actual.codigoArticulo)) {
      throw new RepartoPersistenceError('Linea o articulo desconocido', {
        code: 'PLANNED_LINES_MISMATCH',
        statusCode: 422,
      });
    }
    if (!sameNumber(source.cantidadPedida, actual.cantidadPedida)) {
      throw new RepartoPersistenceError('La cantidad pedida debe proceder del servidor', {
        code: 'PLANNED_QUANTITY_MISMATCH',
        statusCode: 422,
      });
    }
    return {
      lineaId: normalizeText(source.lineaId),
      codigoArticulo: normalizeText(source.codigoArticulo),
      descripcion: normalizeText(source.descripcion),
      cantidadPedida: Number(source.cantidadPedida),
      cantidadEntregada: Number(actual.cantidadEntregada),
      cantidadRechazada: Number(actual.cantidadRechazada),
      cantidadPendiente: Number(actual.cantidadPendiente),
      motivoDiferencia: actual.motivoDiferencia || null,
      observaciones: actual.observaciones || null,
      precioUnitario: source.precioUnitario == null ? null : Number(source.precioUnitario),
    };
  });

  return actualLines;
}

function optionalSnapshotText(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function optionalSnapshotNumber(value) {
  if (value == null || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function plannedDocumentSnapshot(planned, { requireFinancialIdentity = false } = {}) {
  const financialDocument = planned.financialDocumentState === 'AVAILABLE'
    ? planned.financialDocument
    : null;
  const source = financialDocument || planned.document || {};
  const snapshot = {
    tipo: optionalSnapshotText(source.tipo),
    origen: optionalSnapshotText(source.origen),
    subempresa: optionalSnapshotText(source.subempresa),
    ejercicio: optionalSnapshotNumber(source.ejercicio),
    serie: optionalSnapshotText(source.serie),
    terminal: optionalSnapshotNumber(source.terminal),
    numero: optionalSnapshotNumber(source.numero),
    xde: financialDocument ? optionalSnapshotNumber(source.xde) : null,
    dex: financialDocument ? optionalSnapshotNumber(source.dex) : null,
  };
  if (requireFinancialIdentity
      && (!financialDocument || Object.values(snapshot).some((value) => value == null))) {
    throw new RepartoPersistenceError('El documento financiero de cobro falta o es ambiguo', {
      code: 'PAYMENT_DOCUMENT_UNAVAILABLE', statusCode: 409,
    });
  }
  return stableValue(snapshot);
}

function assertPayment(planned, command, actualLines, document) {
  if (!command.cobro) return null;
  const input = command.cobro;

  const amountPending = roundMoney(planned.importePendiente);
  const amountByDeliveredLines = actualLines.every((line) => line.precioUnitario !== null)
    ? roundMoney(actualLines.reduce(
      (sum, line) => sum + (line.cantidadEntregada * line.precioUnitario),
      0,
    ))
    : amountPending;
  const isCompleteDelivery = command.delivery.status === 'ENTREGADO'
    && actualLines.every((line) => line.cantidadRechazada === 0 && line.cantidadPendiente === 0);
  const maxCollectable = isCompleteDelivery
    ? amountPending
    : Math.min(amountPending, amountByDeliveredLines);
  const amount = roundMoney(input.importeCobrado);
  if (amount <= 0 || amount > maxCollectable) {
    throw new RepartoPersistenceError('Importe de cobro superior a la entrega real pendiente', {
      code: 'INVALID_PAYMENT_AMOUNT',
      statusCode: 422,
      details: { maxCollectable },
    });
  }

  return {
    entregaId: planned.documentId,
    codigoCliente: normalizeText(planned.cliente.codigo),
    nombreCliente: normalizeText(planned.cliente.nombre),
    codigoRepartidor: normalizeText(command.actor.repartidorId),
    tipoDocumento: normalizeText(document.tipo),
    origenDocumento: normalizeText(document.origen),
    subempresaDocumento: normalizeText(document.subempresa),
    ejercicioDocumento: Number(document.ejercicio),
    serieDocumento: normalizeText(document.serie),
    terminalDocumento: Number(document.terminal),
    numeroDocumento: Number(document.numero),
    xdeDocumento: Number(document.xde),
    dexDocumento: Number(document.dex),
    importeCobrado: amount,
    importePendiente: roundMoney(amountPending - amount),
    formaPago: normalizeText(input.formaPago).toUpperCase(),
    pantallaOrigen: 'RUTERO',
    operador: normalizeText(command.actor.userId),
    notas: input.notas || null,
  };
}


function assertPaymentRequired(planned, command) {
  if (command.cobro
    || !planned.cobroObligatorio
    || !['ENTREGADO', 'PARCIAL'].includes(command.delivery.status)
    || !(Number(planned.importePendiente) > 0)) {
    return;
  }

  throw new RepartoPersistenceError('El documento exige registrar un cobro antes de confirmar la entrega', {
    code: 'PAYMENT_REQUIRED',
    statusCode: 422,
  });
}

function buildReceiptProof(planned, actualLines, payment, status) {
  const plannedImporteTotal = Number(planned.importeTotal);
  const plannedLineCount = Array.isArray(planned.lineas) ? planned.lineas.length : null;
  const actualLineCount = actualLines.length;
  return Object.freeze({
    plannedImporteTotal: Number.isFinite(plannedImporteTotal) && plannedImporteTotal >= 0
      ? roundMoney(plannedImporteTotal) : null,
    plannedLineCount,
    actualLineCount,
    prepaidZeroWithoutLines: status === 'ENTREGADO'
      && plannedImporteTotal === 0
      && plannedLineCount === 0
      && actualLineCount === 0
      && payment == null,
  });
}
function buildPersistedConfirmation({ command, planned, actualLines, documentSnapshot, confirmedAt, fingerprint }) {
  return {
    idempotencyKey: command.idempotencyKey,
    fingerprint,
    documentId: planned.documentId,
    repartidorId: normalizeText(command.actor.repartidorId),
    actorUserId: normalizeText(command.actor.userId),
    cliente: {
      codigo: normalizeText(planned.cliente?.codigo),
      nombre: normalizeText(planned.cliente?.nombre),
    },
    pedido: planned.pedido || null,
    albaran: documentSnapshot,
    status: command.delivery.status,
    occurredAt: command.delivery.occurredAt,
    confirmedAt,
    receiver: command.delivery.receiver ? stableValue(command.delivery.receiver) : null,
    firmaEvidenceId: command.delivery.firma || null,
    evidenceIds: [...(command.delivery.evidencias || [])],
    incidencia: command.delivery.incidencia ? stableValue(command.delivery.incidencia) : null,
    observaciones: command.delivery.observaciones || null,
    latitud: command.delivery.latitud ?? null,
    longitud: command.delivery.longitud ?? null,
    lineas: actualLines,
  };
}

function buildDocumentPdfInvalidationPattern(itemId, repartidorId) {
  const match = /^(\d{4})-([A-Za-z0-9]{1,3})-(\d+)-(\d+)$/.exec(String(itemId || '').trim());
  const owner = String(repartidorId || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
  if (!match || !owner) return null;
  return `document:repartidor:document-pdf:*:albaran:${match[1]}:${match[2].toUpperCase()}:${Number(match[3])}:${Number(match[4])}:owner:${owner}`;
}

async function invalidateRepartidorDocumentPdfCache(itemId, repartidorId) {
  const pattern = buildDocumentPdfInvalidationPattern(itemId, repartidorId);
  if (!pattern || typeof invalidateCachePattern !== 'function') return;
  try {
    await invalidateCachePattern(pattern);
  } catch (_error) {
    logger.warn('[REPARTO_CONFIRMATION] Document PDF cache invalidation failed', {
      code: 'DOCUMENT_PDF_CACHE_INVALIDATION_FAILED',
    });
  }
}

async function invalidateRepartidorRouteCaches() {
  if (typeof invalidateCachePattern !== 'function') return;
  try {
    await invalidateCachePattern('query:query:repartidor:rutero-*');
  } catch (_error) {
    logger.warn('[REPARTO_CONFIRMATION] Rutero cache invalidation failed', {
      code: 'RUTERO_CACHE_INVALIDATION_FAILED',
    });
  }
}

function createRepartoConfirmationService({ repository, now = () => new Date() }) {
  assertRepository(repository);

  async function confirm(command) {
    const fingerprint = confirmationFingerprint(command);
    const result = await repository.withTransaction(async (tx) => {
      const replay = await tx.getByIdempotencyKey(command.idempotencyKey);
      if (replay) {
        if (replay.fingerprint !== fingerprint) {
          throw new RepartoPersistenceError('Idempotency-Key reutilizada con otro payload', {
            code: 'IDEMPOTENCY_CONFLICT',
          });
        }
        return validatePersistedReplayResult(replay.result, {
          expectsCobro: command.cobro != null,
        });
      }

      const priorDocument = await tx.getByDocumentId(command.delivery.itemId);
      if (priorDocument) {
        throw new RepartoPersistenceError('La entrega ya fue confirmada con otra clave', {
          code: 'DELIVERY_ALREADY_CONFIRMED',
        });
      }

      const planned = await tx.getPlannedDelivery(
        command.delivery.itemId,
        command.actor.repartidorId,
        { allowedRepartidorIds: command.actor.allowedRepartidorIds },
      );
      if (planned.pricingState === PRICING_STATE.PENDING_PRICE) {
        throw new RepartoPersistenceError(
          'El albaran tiene cantidad/peso sin precio cerrado en ERP; no se puede confirmar a 0 EUR',
          {
            code: 'DELIVERY_PRICING_PENDING',
            statusCode: 409,
            details: {
              amountSource: planned.amountSource,
              pricingState: planned.pricingState,
            },
          },
        );
      }
      assertPaymentRequired(planned, command);
      const actualLines = assertPlannedDelivery(planned, command);
      const evidenceRequirements = [
        ...(command.delivery.firma ? [{
          evidenceId: command.delivery.firma,
          expectedKind: 'FIRMA',
        }] : []),
        ...(command.delivery.evidencias || []).map((evidenceId) => ({
          evidenceId,
          expectedKind: 'FOTO',
        })),
      ];
      const evidenceIds = evidenceRequirements.map(({ evidenceId }) => evidenceId);
      await tx.assertEvidenceOwnership(evidenceRequirements, {
        documentId: planned.documentId,
        repartidorId: command.actor.repartidorId,
      });

      const documentSnapshot = plannedDocumentSnapshot(planned, {
        requireFinancialIdentity: Boolean(command.cobro),
      });
      const payment = assertPayment(planned, command, actualLines, documentSnapshot);
      const confirmedAt = now().toISOString();
      const confirmation = buildPersistedConfirmation({
        command,
        planned,
        actualLines,
        confirmedAt,
        documentSnapshot,
        fingerprint,
      });

      const confirmationId = await tx.insertConfirmation(confirmation);
      await tx.insertLines(confirmationId, actualLines);
      await tx.linkEvidence(confirmationId, evidenceIds);
      const cobroResult = payment ? await tx.insertCobro({
        ...payment,
        confirmationId,
        idempotencyToken: command.idempotencyKey,
      }) : null;

      const result = {
        created: true,
        idempotent: false,
        confirmationId: String(confirmationId),
        deliveryStatus: confirmation.status,
        cobroId: cobroResult == null ? null : String(cobroResult.id),
        confirmedAt,
      };
      // Persist the server-validated zero-prepaid proof for receipt rendering;
      // keep the public confirmation response unchanged.
      const persistedResult = {
        ...result,
        receiptProof: buildReceiptProof(planned, actualLines, payment, confirmation.status),
      };
      await tx.insertIdempotencyRecord({
        idempotencyKey: command.idempotencyKey,
        fingerprint,
        documentId: planned.documentId,
        result: persistedResult,
      });
      return result;
    });
    if (result?.created) {
      await Promise.all([
        invalidateRepartidorDocumentPdfCache(command.delivery.itemId, command.actor.repartidorId),
        invalidateRepartidorRouteCaches(),
      ]);
    }
    return result;
  }

  return Object.freeze({ confirm });
}

module.exports = {
  RepartoPersistenceError,
  createRepartoConfirmationService,
  confirmationFingerprint,
};
