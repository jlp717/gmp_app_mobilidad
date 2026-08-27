'use strict';

const db = require('../config/db');
const {
  trackingEnabled,
  resolveTrackingTable,
  normalizeDate,
  normalizeSessionId,
  normalizeSample,
  normalizeSamples,
  createSession,
  appendSamples,
  RuteroTrackingValidationError,
  RuteroTrackingUnavailableError,
} = require('../repositories/repartidor-rutero-tracking-db2-repository');

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
  acquireConfiguredConnection: jest.fn(),
}));

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    ODBC_DSN: 'GMP',
    REPARTO_WRITES_ENABLED: 'false',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    REPARTIDOR_TRACKING_ENABLED: 'true',
    ...overrides,
  };
}

function sample(eventId = 'position-12345678') {
  return {
    eventId,
    latitude: 40.4168,
    longitude: -3.7038,
    accuracy: 12,
    speed: 35,
    heading: 90,
    recordedAt: new Date().toISOString(),
  };
}

describe('repartidor rutero tracking repository', () => {
  beforeEach(() => jest.clearAllMocks());

  test('is disabled by default and resolves the isolated table only when enabled', () => {
    expect(trackingEnabled({ REPARTIDOR_TRACKING_ENABLED: 'false' })).toBe(false);
    expect(() => resolveTrackingTable(testEnv({
      REPARTIDOR_TRACKING_ENABLED: 'false',
    }))).toThrow(RuteroTrackingUnavailableError);
    expect(resolveTrackingTable(testEnv())).toBe(
      'JAVIER.TEST_REPARTIDOR_RUTERO_TRACKING',
    );
  });

  test('normalizes date, session, coordinates and rejects duplicate events', () => {
    expect(normalizeDate('2026-08-27')).toBe('2026-08-27');
    expect(normalizeSessionId('session-12345678')).toBe('session-12345678');
    expect(normalizeSample(sample()).accuracy).toBe(12);
    expect(() => normalizeDate('2026-02-30')).toThrow(RuteroTrackingValidationError);
    expect(() => normalizeSample({ ...sample(), latitude: 91 }))
      .toThrow(RuteroTrackingValidationError);
    expect(() => normalizeSamples([sample(), sample()]))
      .toThrow(RuteroTrackingValidationError);
  });

  test('creates a session idempotently and detects ownership conflicts', async () => {
    db.queryWithParams.mockResolvedValueOnce([]);
    const first = await createSession({
      repartidorId: '05',
      sessionId: 'session-12345678',
      routeDate: '2026-08-27',
      updatedBy: '05',
      env: testEnv(),
    });
    expect(first).toMatchObject({
      sessionId: 'session-12345678',
      replayed: false,
    });
    expect(db.queryWithParams).toHaveBeenCalledTimes(2);

    db.queryWithParams.mockResolvedValueOnce([{
      REPARTIDOR_ID: '94',
      ROUTE_DATE: new Date('2026-08-27T00:00:00Z'),
    }]);
    await expect(createSession({
      repartidorId: '05',
      sessionId: 'session-12345678',
      routeDate: '2026-08-27',
      env: testEnv(),
    })).rejects.toMatchObject({
      code: 'TRACKING_SESSION_OWNERSHIP_CONFLICT',
    });
  });

  test('appends bounded samples with transaction and deduplicates server-side', async () => {
    db.queryWithParams.mockResolvedValueOnce([{
      SESSION_ID: 'session-12345678',
      REPARTIDOR_ID: '05',
      ROUTE_DATE: new Date('2026-08-27T00:00:00Z'),
      EVENT_TYPE: 'START',
    }]);
    const connection = {
      query: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      close: jest.fn(),
    };
    connection.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT EVENT_ID')) return [];
      return [];
    });
    db.acquireConfiguredConnection.mockResolvedValue(connection);

    const result = await appendSamples({
      repartidorId: '05',
      sessionId: 'session-12345678',
      routeDate: '2026-08-27',
      samples: [sample(), sample('position-22345678')],
      updatedBy: '05',
      env: testEnv(),
    });

    expect(result).toMatchObject({ accepted: 2, inserted: 2, replayed: false });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(connection.query.mock.calls.filter(([sql]) =>
      sql.startsWith('INSERT INTO')).length).toBe(2);
  });

  test('rolls back when one sample cannot be persisted', async () => {
    db.queryWithParams.mockResolvedValueOnce([{
      SESSION_ID: 'session-12345678',
      REPARTIDOR_ID: '05',
      ROUTE_DATE: '2026-08-27',
      EVENT_TYPE: 'START',
    }]);
    const connection = {
      query: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      close: jest.fn(),
    };
    connection.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('DB2 insert failed'));
    db.acquireConfiguredConnection.mockResolvedValue(connection);

    await expect(appendSamples({
      repartidorId: '05',
      sessionId: 'session-12345678',
      routeDate: '2026-08-27',
      samples: [sample()],
      env: testEnv(),
    })).rejects.toThrow('DB2 insert failed');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
