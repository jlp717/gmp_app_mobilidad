'use strict';

const express = require('express');
const request = require('supertest');
const { addRequestId } = require('../middleware/security');
const telemetry = require('../telemetry/logger');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildApp() {
  const app = express();
  app.use(addRequestId);
  // Misma conexion que server.js: child logger con request_id.
  app.use((req, res, next) => {
    req.log = telemetry.child({ request_id: req.requestId });
    next();
  });
  app.get('/ping', (req, res) => res.json({ ok: true, rid: req.requestId }));
  return app;
}

describe('request-id end-to-end', () => {
  test('genera X-Request-ID uuid v4 y lo expone en la respuesta', async () => {
    const res = await request(buildApp()).get('/ping');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
    expect(res.body.rid).toBe(res.headers['x-request-id']);
  });

  test('conserva el X-Request-ID entrante (correlacion con ticket)', async () => {
    const incoming = '11111111-2222-4333-8444-555555555555';
    const res = await request(buildApp())
      .get('/ping')
      .set('X-Request-ID', incoming);
    expect(res.headers['x-request-id']).toBe(incoming);
    expect(res.body.rid).toBe(incoming);
  });
});
