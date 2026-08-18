'use strict';

const crypto = require('crypto');
const {
  KINDS,
  PHOTO_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  createDeliveryEvidenceService,
  decodeSignature,
  validate,
} = require('../services/delivery-evidence-service');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64');

function repository() {
  return {
    stage: jest.fn(async (record) => ({ evidenceId: record.evidenceId, created: true, idempotent: false })),
    getLinked: jest.fn(),
  };
}

describe('delivery evidence service', () => {
  test('validates MIME magic and accepts exactly 4 MiB while rejecting one byte more', () => {
    expect(PHOTO_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(() => validate({ kind: KINDS.PHOTO, mimeType: 'image/png', buffer: Buffer.from('%PDF') }))
      .toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE_MAGIC', statusCode: 415 }));

    const boundaryPhoto = Buffer.alloc(PHOTO_MAX_BYTES);
    PNG.copy(boundaryPhoto);
    expect(validate({ kind: KINDS.PHOTO, mimeType: 'image/png', buffer: boundaryPhoto }))
      .toBe('image/png');

    const oversizedPhoto = Buffer.alloc(PHOTO_MAX_BYTES + 1);
    PNG.copy(oversizedPhoto);
    expect(() => validate({ kind: KINDS.PHOTO, mimeType: 'image/png', buffer: oversizedPhoto }))
      .toThrow(expect.objectContaining({ code: 'EVIDENCE_TOO_LARGE', statusCode: 413 }));
    const oversizedSignature = Buffer.concat([PNG, Buffer.alloc(SIGNATURE_MAX_BYTES)]);
    expect(() => decodeSignature(`data:image/png;base64,${oversizedSignature.toString('base64')}`))
      .toThrow(expect.objectContaining({ code: 'EVIDENCE_TOO_LARGE', statusCode: 413 }));
  });

  test('rejects a PNG signature with corrupt compressed data before persistence', () => {
    const corrupt = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQ9wAAAABJRU5ErkJggg==';
    expect(() => decodeSignature(`data:image/png;base64,${corrupt}`))
      .toThrow(expect.objectContaining({ code: 'INVALID_SIGNATURE_IMAGE', statusCode: 415 }));
  });

  test('stages bytes, SHA-256 and a deterministic opaque DB2 BLOB reference', async () => {
    const repo = repository();
    const service = createDeliveryEvidenceService({ repository: repo });
    const args = {
      documentId: '2026-S-10-404-4300009479',
      repartidorId: '94',
      dataUri: `data:image/png;base64,${PNG.toString('base64')}`,
    };

    const first = await service.stageSignature(args);
    const second = await service.stageSignature(args);

    expect(first.evidenceId).toMatch(/^ev_[a-f0-9]{64}$/);
    expect(second.evidenceId).toBe(first.evidenceId);
    expect(repo.stage).toHaveBeenCalledTimes(2);
    expect(repo.stage.mock.calls[0][0]).toMatchObject({
      evidenceId: first.evidenceId,
      kind: 'FIRMA',
      mimeType: 'image/png',
      contentBytes: PNG.length,
      contentSha256: crypto.createHash('sha256').update(PNG).digest('hex'),
      storageReference: `DB2_BLOB:${first.evidenceId}`,
      content: PNG,
    });
  });

  test('returns linked base64 only to owner or ADMIN and verifies integrity', async () => {
    const repo = repository();
    const evidenceId = `ev_${'a'.repeat(64)}`;
    repo.getLinked.mockResolvedValue({
      evidenceId,
      repartidorId: '94',
      kind: 'FOTO',
      mimeType: 'image/png',
      content: PNG,
      contentBytes: PNG.length,
      contentSha256: crypto.createHash('sha256').update(PNG).digest('hex'),
    });
    const service = createDeliveryEvidenceService({ repository: repo });

    await expect(service.retrieve({
      evidenceId, actor: { role: 'REPARTIDOR', repartidorId: '95' },
    })).rejects.toMatchObject({ code: 'EVIDENCE_OWNERSHIP_REQUIRED', statusCode: 403 });
    await expect(service.retrieve({
      evidenceId, actor: { role: 'REPARTIDOR', repartidorId: '94' },
    })).resolves.toMatchObject({ mimeType: 'image/png', contentBase64: PNG.toString('base64') });
    await expect(service.retrieve({
      evidenceId, actor: { role: 'ADMIN', repartidorId: '1' },
    })).resolves.toMatchObject({ evidenceId, kind: 'FOTO' });
  });

  test('forwards one AbortSignal to the linked-evidence repository and stops after abort', async () => {
    const repo = repository();
    const controller = new AbortController();
    const evidenceId = `ev_${'a'.repeat(64)}`;
    repo.getLinked.mockImplementation(async (_id, { signal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return {
        evidenceId, repartidorId: '94', kind: 'FOTO', mimeType: 'image/png',
        content: PNG, contentBytes: PNG.length,
        contentSha256: crypto.createHash('sha256').update(PNG).digest('hex'),
      };
    });
    const service = createDeliveryEvidenceService({ repository: repo });

    await expect(service.retrieve({
      evidenceId,
      actor: { role: 'REPARTIDOR', repartidorId: '94' },
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'EVIDENCE_TIMEOUT', statusCode: 504 });
    expect(repo.getLinked).toHaveBeenCalledWith(evidenceId, { signal: controller.signal });
  });
});
