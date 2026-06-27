'use strict';

const request = require('supertest');
const express = require('express');

const mockKpiQuery = jest.fn();

jest.mock('../kpi/config/db', () => ({
  kpiQuery: (...args) => mockKpiQuery(...args),
  kpiHealthCheck: jest.fn(),
}));

jest.mock('../kpi/services/redis_cache', () => ({
  getCachedClientAlerts: jest.fn(),
  getRedisStatus: jest.fn(() => ({ ok: true })),
  getLastLoadInfo: jest.fn(() => null),
}));

jest.mock('../kpi/services/etl_orchestrator', () => ({
  runETL: jest.fn(),
}));

jest.mock('../kpi/services/scheduler', () => ({
  getSchedulerStatus: jest.fn(() => ({ running: false })),
}));

jest.mock('../kpi/services/metrics', () => ({
  getPrometheusMetrics: jest.fn(() => ''),
  metricsMiddleware: (_req, _res, next) => next(),
}));

jest.mock('../kpi/services/alert_transformer', () => ({
  transformAlert: ({ alertType, message }) => ({
    title: alertType,
    summary: message || '',
    detail: '',
    actions: [],
    ui_hint: {},
  }),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const kpiRouter = require('../kpi/routes');

const activeAlerts = [
  {
    CLIENT_CODE: '4300000001',
    ALERT_TYPE: 'DESVIACION_VENTAS',
    SEVERITY: 'critical',
    MESSAGE: 'Cliente 1',
    RAW_DATA: '{}',
  },
  {
    CLIENT_CODE: '4300000002',
    ALERT_TYPE: 'AVISO',
    SEVERITY: 'warning',
    MESSAGE: 'Cliente 2',
    RAW_DATA: '{}',
  },
];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', kpiRouter);
  return app;
}

function mockDashboardDb({ laclaeRows = [] } = {}) {
  mockKpiQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (/FROM\s+DSED\.LACLAE/i.test(text)) {
      return { rows: laclaeRows };
    }
    if (/SELECT\s+CLIENT_CODE,\s+ALERT_TYPE,\s+SEVERITY\s+FROM\s+JAVIER\.KPI_ALERTS\s+WHERE\s+IS_ACTIVE\s*=\s*1/i.test(text)) {
      return { rows: activeAlerts };
    }
    if (/FROM\s+DSEDAC\.CLI/i.test(text)) {
      return {
        rows: params.map(code => ({
          CODE: code,
          NAME: `Cliente ${code}`,
          ADDRESS: '',
          CITY: '',
        })),
      };
    }
    if (/SELECT\s+CLIENT_CODE,\s+ALERT_TYPE,\s+SEVERITY,\s+MESSAGE,\s+RAW_DATA/i.test(text)) {
      return { rows: activeAlerts };
    }
    if (/FROM\s+JAVIER\.KPI_LOADS/i.test(text)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe('kpi dashboard route performance contract', () => {
  beforeEach(() => {
    mockKpiQuery.mockReset();
  });

  test('skips LACLAE vendor lookup for manager-sized vendor lists', async () => {
    mockDashboardDb();
    const vendorCodes = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0')).join(',');

    const res = await request(makeApp()).get(`/dashboard?vendorCode=${vendorCodes}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      totals: { alerts: 2, clients: 2 },
    });
    expect(mockKpiQuery.mock.calls.some(([sql]) => /FROM\s+DSED\.LACLAE/i.test(String(sql)))).toBe(false);
  });

  test('normalizes short vendor filter binds for DB2 fixed-width columns', async () => {
    mockDashboardDb({ laclaeRows: [{ CLIENT_CODE: '4300000001' }] });

    const res = await request(makeApp()).get('/dashboard?vendorCode=0199');

    expect(res.status).toBe(200);
    expect(res.body.totals.alerts).toBe(1);

    const laclaeCall = mockKpiQuery.mock.calls.find(([sql]) => /FROM\s+DSED\.LACLAE/i.test(String(sql)));
    expect(laclaeCall).toBeTruthy();
    expect(laclaeCall[0]).toMatch(/CAST\(\?\s+AS\s+VARCHAR\(2\)\)/i);
    expect(laclaeCall[1]).toEqual(['01']);
  });
});
