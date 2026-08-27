'use strict';

const crypto = require('crypto');
const { assertDecodablePng } = require('../utils/png-image-validator');

// The global request guard rejects Content-Length above 5 MiB. Keep photos
// at 4 MiB so multipart framing still fits below that request-wide ceiling.
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
// A 1 MiB image expands to about 1.34 MiB as base64, leaving room for the
// JSON envelope under the server-wide express.json({ limit: '2mb' }).
const SIGNATURE_MAX_BYTES = 1024 * 1024;
const KINDS = Object.freeze({ SIGNATURE: 'FIRMA', PHOTO: 'FOTO', OTHER: 'OTRA' });
const MEDIA = Object.freeze({
  'image/png': (buffer) => buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (buffer) => buffer.length >= 3
    && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/webp': (buffer) => buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
});
const SAFE_EVIDENCE_ID = /^ev_[a-f0-9]{64}$/;

class EvidenceError extends Error {
  constructor(code, message, statusCode = 503) {
    super(message);
    this.name = 'EvidenceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validateText(value, name, max) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f]/.test(normalized)) {
    throw new EvidenceError('INVALID_EVIDENCE_REQUEST', `${name} no es válido`, 400);
  }
  return normalized;
}

function validate({ kind, mimeType, buffer, maxBytes = PHOTO_MAX_BYTES }) {
  if (!Object.values(KINDS).includes(kind)) {
    throw new EvidenceError('INVALID_EVIDENCE_KIND', 'Tipo de evidencia inválido', 400);
  }
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  const magic = MEDIA[normalizedMime];
  if (!magic) throw new EvidenceError('UNSUPPORTED_EVIDENCE_TYPE', 'Tipo de evidencia no permitido', 415);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new EvidenceError('EVIDENCE_REQUIRED', 'Debe adjuntar una evidencia', 400);
  }
  if (buffer.length > maxBytes) {
    throw new EvidenceError('EVIDENCE_TOO_LARGE', 'La evidencia supera el límite permitido', 413);
  }
  if (!magic(buffer)) {
    throw new EvidenceError('INVALID_EVIDENCE_MAGIC', 'El contenido no coincide con el tipo declarado', 415);
  }
  return normalizedMime;
}

function contentSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof EvidenceError
      || (signal.reason instanceof Error
        && typeof signal.reason.code === 'string'
        && Number.isInteger(signal.reason.statusCode))) {
    throw signal.reason;
  }
  throw new EvidenceError('EVIDENCE_TIMEOUT', 'La consulta de evidencia fue cancelada', 504);
}

function identity(documentId, repartidorId, kind, sha256) {
  const digest = crypto.createHash('sha256')
    .update('gmp-reparto-evidence-v3\0')
    .update(documentId).update('\0')
    .update(repartidorId).update('\0')
    .update(kind).update('\0')
    .update(sha256)
    .digest('hex');
  return `ev_${digest}`;
}

function decodeSignature(dataUri) {
  const raw = String(dataUri || '');
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!match) {
    throw new EvidenceError('INVALID_SIGNATURE_DATA_URI', 'La firma debe ser una data URI válida', 400);
  }
  const maxEncodedLength = Math.ceil(SIGNATURE_MAX_BYTES / 3) * 4;
  if (match[2].length > maxEncodedLength) {
    throw new EvidenceError('EVIDENCE_TOO_LARGE', 'La firma supera el límite permitido', 413);
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.toString('base64') !== match[2]) {
    throw new EvidenceError('INVALID_SIGNATURE_DATA_URI', 'La firma no usa base64 canónico', 400);
  }
  const mimeType = validate({
    kind: KINDS.SIGNATURE,
    mimeType: match[1],
    buffer,
    maxBytes: SIGNATURE_MAX_BYTES,
  });
  try {
    if (mimeType === 'image/png') {
      assertDecodablePng(buffer);
    } else if (buffer.length < 4
        || buffer[buffer.length - 2] !== 0xff
        || buffer[buffer.length - 1] !== 0xd9) {
      throw new Error('invalid JPEG');
    }
  } catch (_) {
    throw new EvidenceError(
      'INVALID_SIGNATURE_IMAGE', 'La firma contiene una imagen dañada o no compatible', 415,
    );
  }
  return Object.freeze({ mimeType, buffer });
}

function createDeliveryEvidenceService({ repository } = {}) {
  if (!repository || typeof repository.stage !== 'function' || typeof repository.getLinked !== 'function') {
    throw new TypeError('repository.stage and repository.getLinked are required');
  }

  async function stage({ documentId, repartidorId, kind, mimeType, buffer, maxBytes, allowedRepartidorIds }) {
    const safeDocumentId = validateText(documentId, 'documentId', 160);
    const safeRepartidorId = validateText(repartidorId, 'repartidorId', 20);
    const safeMimeType = validate({ kind, mimeType, buffer, maxBytes });
    const sha256 = contentSha256(buffer);
    const evidenceId = identity(safeDocumentId, safeRepartidorId, kind, sha256);
    return repository.stage({
      evidenceId,
      documentId: safeDocumentId,
      repartidorId: safeRepartidorId,
      kind,
      mimeType: safeMimeType,
      contentSha256: sha256,
      contentBytes: buffer.length,
      content: buffer,
      storageReference: `DB2_BLOB:${evidenceId}`,
      allowedRepartidorIds,
    });
  }

  async function stageSignature({ documentId, repartidorId, dataUri, allowedRepartidorIds }) {
    const decoded = decodeSignature(dataUri);
    return stage({
      documentId,
      repartidorId,
      kind: KINDS.SIGNATURE,
      mimeType: decoded.mimeType,
      buffer: decoded.buffer,
      maxBytes: SIGNATURE_MAX_BYTES,
      allowedRepartidorIds,
    });
  }

  async function stagePhoto({ documentId, repartidorId, mimeType, buffer, allowedRepartidorIds }) {
    return stage({
      documentId,
      repartidorId,
      kind: KINDS.PHOTO,
      mimeType,
      buffer,
      maxBytes: PHOTO_MAX_BYTES,
      allowedRepartidorIds,
    });
  }

  async function retrieve({ evidenceId, actor, signal }) {
    throwIfAborted(signal);
    const safeEvidenceId = validateText(evidenceId, 'evidenceId', 128);
    if (!SAFE_EVIDENCE_ID.test(safeEvidenceId)) {
      throw new EvidenceError('INVALID_EVIDENCE_ID', 'Identificador de evidencia inválido', 400);
    }
    const evidence = await repository.getLinked(safeEvidenceId, { signal });
    throwIfAborted(signal);
    const role = String(actor?.role || '').trim().toUpperCase();
    const actorCode = String(actor?.repartidorId || '').trim();
    if (role !== 'ADMIN' && actorCode !== evidence.repartidorId) {
      throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta evidencia', 403);
    }
    if (evidence.content.length !== evidence.contentBytes
      || contentSha256(evidence.content) !== evidence.contentSha256) {
      throw new EvidenceError('EVIDENCE_INTEGRITY_FAILED', 'La evidencia no supera la verificación de integridad', 503);
    }
    throwIfAborted(signal);
    return Object.freeze({
      evidenceId: evidence.evidenceId,
      kind: evidence.kind,
      mimeType: evidence.mimeType,
      contentBase64: evidence.content.toString('base64'),
    });
  }

  return Object.freeze({ stageSignature, stagePhoto, retrieve });
}

function unavailableDeliveryEvidenceService() {
  const unavailable = async () => {
    throw new EvidenceError(
      'REPARTO_EVIDENCE_RUNTIME_UNAVAILABLE',
      'El almacén de evidencias no está habilitado',
      503,
    );
  };
  return Object.freeze({ stageSignature: unavailable, stagePhoto: unavailable, retrieve: unavailable });
}

module.exports = {
  EvidenceError,
  KINDS,
  PHOTO_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  createDeliveryEvidenceService,
  decodeSignature,
  identity,
  unavailableDeliveryEvidenceService,
  validate,
};
