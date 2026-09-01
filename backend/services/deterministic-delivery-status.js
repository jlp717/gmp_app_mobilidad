'use strict';

const CANONICAL_DELIVERY_STATUSES = Object.freeze([
  'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO',
]);

class DeliveryStatusResolutionError extends Error {
  constructor(code, message, documentId = '') {
    super(message);
    this.name = 'DeliveryStatusResolutionError';
    this.code = code;
    this.documentId = documentId;
  }
}

function value(row, upper, lower = upper.toLowerCase()) {
  return row?.[upper] ?? row?.[lower];
}

function normalized(row, upper) {
  return String(value(row, upper) ?? '').trim();
}

function candidateFromRow(row) {
  const documentId = normalized(row, 'DOCUMENT_ID');
  const repartidorId = normalized(row, 'REPARTIDOR_ID');
  const status = normalized(row, 'STATUS').toUpperCase();
  if (!documentId) {
    throw new DeliveryStatusResolutionError(
      'INVALID_CANONICAL_DELIVERY_STATUS',
      'La confirmacion canonica no contiene identidad de documento',
    );
  }
  if (!CANONICAL_DELIVERY_STATUSES.includes(status)) {
    throw new DeliveryStatusResolutionError(
      'INVALID_CANONICAL_DELIVERY_STATUS',
      'La confirmacion canonica contiene un estado no autorizado',
      documentId,
    );
  }

  return {
    documentId,
    repartidorId,
    status,
    confirmationId: value(row, 'CONFIRMATION_ID', 'confirmation_id')
      ?? value(row, 'ID', 'id') ?? null,
    firmaEvidenceId: value(row, 'FIRMA_EVIDENCE_ID', 'firma_evidence_id') ?? null,
    cobroId: value(row, 'COBRO_ID', 'cobro_id') ?? null,
    importeCobrado: value(row, 'IMPORTE_COBRADO', 'importe_cobrado') ?? null,
    importePendienteCobro: value(row, 'IMPORTE_PENDIENTE_COBRO', 'importe_pendiente_cobro') ?? null,
    formaPagoCobro: value(row, 'FORMA_PAGO_COBRO', 'forma_pago_cobro') ?? null,
  };
}

function stableCandidateKey(candidate) {
  return [
    candidate.status,
    candidate.confirmationId,
    candidate.firmaEvidenceId,
    candidate.cobroId,
    candidate.importeCobrado,
    candidate.importePendienteCobro,
    candidate.formaPagoCobro,
  ].map((item) => String(item ?? '')).join('');
}

/**
 * Resolves DB rows without depending on physical DB2 row order.
 * Equal states are safe duplicates (for example a payment join fan-out).
 * Contradictory states are data corruption and must fail closed.
 */
function resolveCanonicalDeliveryStatuses(rows, { byOwner = false } = {}) {
  const byDocument = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidate = candidateFromRow(row);
    const key = byOwner
      ? `${candidate.repartidorId}\u001f${candidate.documentId}`
      : candidate.documentId;
    const previous = byDocument.get(key);
    if (previous && previous.status !== candidate.status) {
      throw new DeliveryStatusResolutionError(
        'CONFLICTING_CANONICAL_DELIVERY_STATUS',
        'Existen estados canonicos contradictorios para una entrega',
        candidate.documentId,
      );
    }
    if (!previous || stableCandidateKey(candidate) < stableCandidateKey(previous)) {
      byDocument.set(key, candidate);
    }
  }
  return byDocument;
}

module.exports = {
  CANONICAL_DELIVERY_STATUSES,
  DeliveryStatusResolutionError,
  resolveCanonicalDeliveryStatuses,
};
