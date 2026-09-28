'use strict';

/**
 * L10: exposition Prometheus valida sin red.
 * - http_requests_total emite labels con comillas {method="GET",path="...",status="200"}
 * - HELP/TYPE presentes, Content-Type version 0.0.4
 */

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  prometheusMetrics,
  getPrometheusMetrics,
  metricsHandler,
  resetMetrics,
  stopPeriodicCleanup,
} = require('../middleware/prometheus-metrics');

function driveOneRequest({ method = 'GET', path = '/api/pedidos/123', status = 200 } = {}) {
  const req = { method, path, headers: {} };
  const originalEnd = jest.fn();
  const res = { statusCode: status, end: originalEnd };
  prometheusMetrics(req, res, jest.fn());
  res.end('{}');
  return originalEnd;
}

describe('prometheus exposition format (L10)', () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterAll(() => {
    stopPeriodicCleanup();
  });

  test('http_requests_total expone labels con comillas', () => {
    driveOneRequest({ method: 'GET', path: '/api/pedidos/123', status: 200 });
    const out = getPrometheusMetrics();
    const lines = out.split('\n').filter((l) => l.startsWith('http_requests_total{'));
    expect(lines.length).toBeGreaterThan(0);
    // path normalizado: /123 -> /:id
    expect(out).toContain('http_requests_total{method="GET",path="/api/pedidos/:id",status="200"} 1');
    // formato invalido previo no debe aparecer: {method:GET,...} sin comillas
    expect(out).not.toMatch(/http_requests_total\{method:/);
    // cada linea con labels debe llevar valores entre comillas
    for (const line of lines) {
      expect(line).toMatch(/^[a-z_]+(\{[a-zA-Z_][a-zA-Z0-9_]*="[^"]*"(,[a-zA-Z_][a-zA-Z0-9_]*="[^"]*")*\})? \d+(\.\d+)?$/);
    }
  });

  test('HELP/TYPE presentes y Content-Type version 0.0.4', () => {
    driveOneRequest({ method: 'POST', path: '/api/cobros', status: 500 });
    const out = getPrometheusMetrics();
    expect(out).toContain('# HELP http_requests_total Total HTTP requests');
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toContain('status="500"');

    const req = { query: {} };
    const res = { set: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
    metricsHandler(req, res);
    expect(res.set).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringContaining('version=0.0.4')
    );
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('http_requests_total{'));
  });
});
