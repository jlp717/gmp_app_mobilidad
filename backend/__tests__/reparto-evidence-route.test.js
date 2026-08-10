'use strict';

const express = require('express');
const request = require('supertest');
const {
  EvidenceError,
  PHOTO_MAX_BYTES,
} = require('../services/delivery-evidence-service');

let mockUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = mockUser && { ...mockUser }; next(); },
  requireRoles: () => (_req, _res, next) => next(),
}));
jest.mock('../services/repartidor-finance-service', () => ({}));
jest.mock('../services/redis-cache', () => ({ deleteCachePattern: jest.fn().mockResolvedValue(undefined) }));

const routes = require('../routes/repartidor-finanzas');
const EVIDENCE_ID = `ev_${'a'.repeat(64)}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function app() {
  const value = express();
  value.use(express.json({ limit: '2mb' }));
  value.use('/finanzas', routes);
  return value;
}

function injectEvidence(evidenceService) {
  routes.setCanonicalConfirmationRuntime({
    catalogService: { validateConfirmation: jest.fn() },
    confirmationService: { confirm: jest.fn() },
    evidenceService,
  });
}

describe('canonical reparto evidence routes', () => {
  afterEach(() => {
    mockUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };
    routes.resetCanonicalConfirmationRuntime();
  });

  test('is always mounted but fails closed with 503 when runtime is unavailable', async () => {
    const response = await request(app()).post('/finanzas/rutero/evidence/signature').send({
      documentId: '2026-S-10-404-4300009479',
      signature: `data:image/png;base64,${PNG.toString('base64')}`,
    });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'REPARTO_EVIDENCE_RUNTIME_UNAVAILABLE',
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  test.each([
    [null, 401, 'AUTHENTICATED_ACTOR_REQUIRED'],
    [{ id: 'C1', code: 'C1', role: 'COMERCIAL' }, 403, 'REPARTO_CONFIRMATION_ROLE_REQUIRED'],
  ])('requires authenticated reparto role before staging', async (user, status, code) => {
    const stageSignature = jest.fn();
    injectEvidence({ stageSignature, stagePhoto: jest.fn(), retrieve: jest.fn() });
    mockUser = user;

    const response = await request(app()).post('/finanzas/rutero/evidence/signature').send({
      documentId: '2026-S-10-404-4300009479',
      signature: `data:image/png;base64,${PNG.toString('base64')}`,
    });

    expect(response.status).toBe(status);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toMatchObject({ success: false, code });
    expect(stageSignature).not.toHaveBeenCalled();
  });

  test('stages signature as an opaque ID and returns 201/200 for create/retry', async () => {
    const stageSignature = jest.fn()
      .mockResolvedValueOnce({ evidenceId: EVIDENCE_ID, created: true, idempotent: false })
      .mockResolvedValueOnce({ evidenceId: EVIDENCE_ID, created: false, idempotent: true });
    injectEvidence({ stageSignature, stagePhoto: jest.fn(), retrieve: jest.fn() });
    const body = {
      documentId: '2026-S-10-404-4300009479',
      signature: `data:image/png;base64,${PNG.toString('base64')}`,
    };

    const created = await request(app()).post('/finanzas/rutero/evidence/signature').send(body);
    const replay = await request(app()).post('/finanzas/rutero/evidence/signature').send(body);

    expect(created.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(created.body).toMatchObject({ evidenceId: EVIDENCE_ID, created: true });
    expect(JSON.stringify(created.body)).not.toContain('base64');
    expect(stageSignature).toHaveBeenCalledWith(expect.objectContaining({ repartidorId: '94' }));
  });

  test('accepts one bounded multipart photo and delegates bytes in memory', async () => {
    const stagePhoto = jest.fn().mockResolvedValue({ evidenceId: EVIDENCE_ID, created: true, idempotent: false });
    injectEvidence({ stageSignature: jest.fn(), stagePhoto, retrieve: jest.fn() });

    const response = await request(app())
      .post('/finanzas/rutero/evidence/photo')
      .field('documentId', '2026-S-10-404-4300009479')
      .attach('photo', PNG, { filename: 'proof.png', contentType: 'image/png' });

    expect(response.status).toBe(201);
    expect(stagePhoto).toHaveBeenCalledWith(expect.objectContaining({
      repartidorId: '94', mimeType: 'image/png', buffer: PNG,
    }));
  });

  test('rejects multipart photos above 4 MiB with the public size contract', async () => {
    const stagePhoto = jest.fn();
    injectEvidence({ stageSignature: jest.fn(), stagePhoto, retrieve: jest.fn() });
    const oversizedPhoto = Buffer.alloc(PHOTO_MAX_BYTES + 1);
    PNG.copy(oversizedPhoto);

    const response = await request(app())
      .post('/finanzas/rutero/evidence/photo')
      .field('documentId', '2026-S-10-404-4300009479')
      .attach('photo', oversizedPhoto, { filename: 'proof.png', contentType: 'image/png' });

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      success: false,
      code: 'EVIDENCE_TOO_LARGE',
      error: 'La evidencia supera el límite de 4 MiB',
    });
    expect(stagePhoto).not.toHaveBeenCalled();
  });

  test('maps foreign ownership to 403 and returns linked MIME/base64 to owner', async () => {
    const retrieve = jest.fn()
      .mockRejectedValueOnce(new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'Sin permisos', 403))
      .mockResolvedValueOnce({ evidenceId: EVIDENCE_ID, kind: 'FOTO', mimeType: 'image/png', contentBase64: PNG.toString('base64') });
    injectEvidence({ stageSignature: jest.fn(), stagePhoto: jest.fn(), retrieve });

    const forbidden = await request(app()).get(`/finanzas/rutero/evidence/${EVIDENCE_ID}`);
    const linked = await request(app()).get(`/finanzas/rutero/evidence/${EVIDENCE_ID}`);

    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'EVIDENCE_OWNERSHIP_REQUIRED' });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({
      evidenceId: EVIDENCE_ID,
      mimeType: 'image/png',
      contentBase64: PNG.toString('base64'),
    });
    expect(linked.headers['cache-control']).toBe('private, no-store');
    expect(linked.headers.pragma).toBe('no-cache');
    expect(linked.headers['x-content-type-options']).toBe('nosniff');
    expect(linked.headers['content-disposition']).toBe('inline; filename="evidence.json"');
    expect(linked.headers['content-type']).toMatch(/^application\/json/);
  });

  test('maps service and DB2 timeouts to a safe 504 without diagnostics', async () => {
    const stageSignature = jest.fn().mockRejectedValue(Object.assign(new Error('network details'), {
      code: 'ETIMEDOUT',
    }));
    const retrieve = jest.fn().mockRejectedValue(Object.assign(new Error('DB2 private details'), {
      odbcErrors: [{ state: 'HYT00', code: 0, message: 'private SQL details' }],
    }));
    injectEvidence({ stageSignature, stagePhoto: jest.fn(), retrieve });

    const signature = await request(app()).post('/finanzas/rutero/evidence/signature').send({
      documentId: '2026-S-10-404-4300009479',
      signature: `data:image/png;base64,${PNG.toString('base64')}`,
    });
    const linked = await request(app()).get(`/finanzas/rutero/evidence/${EVIDENCE_ID}`);

    for (const response of [signature, linked]) {
      expect(response.status).toBe(504);
      expect(response.body).toEqual({
        success: false,
        code: 'EVIDENCE_TIMEOUT',
        error: 'Servicio temporalmente no disponible',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/DB2|SQL|network|private|odbc/i);
    }
  });
});
