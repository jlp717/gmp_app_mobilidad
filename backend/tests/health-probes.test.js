'use strict';

const express = require('express');
const request = require('supertest');

// Mocks ANTES de requerir el router.
global.__DB_QUERY__ = jest.fn();
global.__REDIS__ = null;

jest.mock('../config/db', () => ({ query: (...a) => global.__DB_QUERY__(...a) }));
jest.mock('../services/redis-cache', () => ({ get redisCache() { return global.__REDIS__; } }));

const healthProbes = require('../routes/health-probes');

function buildApp() {
  const app = express();
  app.use('/health', healthProbes);
  return app;
}

beforeEach(() => {
  global.__DB_QUERY__.mockReset();
  global.__REDIS__ = null;
});

describe('health probes', () => {
  test('/health/live responde 200 sin dependencias externas', async () => {
    const res = await request(buildApp()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    expect(typeof res.body.uptime).toBe('number');
  });

  test('/health/ready 200 con DB2 y Redis OK', async () => {
    global.__DB_QUERY__.mockResolvedValue([{ '1': 1 }]);
    global.__REDIS__ = { isConnected: true, client: { ping: jest.fn().mockResolvedValue('PONG') } };
    const res = await request(buildApp()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database.status).toBe('connected');
    expect(res.body.checks.redis.status).toBe('connected');
  });

  test('/health/ready 503 cuando DB2 falla, detallando el check', async () => {
    global.__DB_QUERY__.mockRejectedValue(new Error('FALLO-DB2-SIMULADO'));
    global.__REDIS__ = { isConnected: true, client: { ping: jest.fn().mockResolvedValue('PONG') } };
    const res = await request(buildApp()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.checks.database.error).toContain('FALLO-DB2-SIMULADO');
    expect(res.body.checks.redis.status).toBe('connected');
  });

  test('/health/ready trata Redis no configurado como no bloqueante', async () => {
    global.__DB_QUERY__.mockResolvedValue([{ '1': 1 }]);
    const res = await request(buildApp()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.redis.status).toBe('not_configured');
  });
});
