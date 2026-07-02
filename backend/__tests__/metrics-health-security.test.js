'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  prometheusMetrics,
  metricsHandler,
  requireInternalMetricsAccess,
  canSeeInternalDetails,
  resetMetrics,
  stopPeriodicCleanup,
} = require('../middleware/prometheus-metrics');

function makeReq({ ip = '203.0.113.10', headers = {} } = {}) {
  return {
    ip,
    socket: { remoteAddress: ip },
    connection: { remoteAddress: ip },
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

function makeRes() {
  return {
    status: jest.fn(function status(code) { this.statusCode = code; return this; }),
    json: jest.fn(function json(body) { this.body = body; return this; }),
  };
}

describe('metrics and health internal access gates', () => {
  const originalProcessEnvironment = process['env'];

  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
    process['env'] = { ...originalProcessEnvironment };
    delete process['env'].INTERNAL_API_TOKEN;
    delete process['env'].INTERNAL_METRICS_TOKEN;
    delete process['env'].METRICS_TOKEN;
    delete process['env'].INTERNAL_HEALTH_TOKEN;
    delete process['env'].HEALTHCHECK_TOKEN;
  });

  afterAll(() => {
    process['env'] = originalProcessEnvironment;
    stopPeriodicCleanup();
  });

  test('rejects metrics from non-loopback requests without internal token', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    requireInternalMetricsAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'METRICS_FORBIDDEN' }));
  });

  test('allows metrics with configured internal token', () => {
    process['env'].INTERNAL_API_TOKEN = 'secret-token';
    const req = makeReq({ headers: { 'x-internal-token': 'secret-token' } });
    const res = makeRes();
    const next = jest.fn();

    requireInternalMetricsAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('keeps Prometheus text output for loopback scraper', async () => {
    const app = express();
    app.use(prometheusMetrics);
    app.get('/api/metrics', requireInternalMetricsAccess, metricsHandler);

    const res = await request(app).get('/api/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('process_uptime_seconds');
  });

  test('health details require loopback or internal token, not user agent alone', () => {
    expect(canSeeInternalDetails(makeReq())).toBe(false);
    expect(canSeeInternalDetails(makeReq({ headers: { 'user-agent': 'GMP-SRE-HealthCheck/1.0' } }))).toBe(false);
    expect(canSeeInternalDetails(makeReq({ ip: '127.0.0.1' }))).toBe(true);
    process['env'].INTERNAL_HEALTH_TOKEN = 'secret-token';
    expect(canSeeInternalDetails(makeReq({ headers: { 'x-healthcheck-token': 'secret-token' } }))).toBe(true);
  });
});
