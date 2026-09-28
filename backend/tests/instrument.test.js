'use strict';
/**
 * instrument.test.js — Sentry fail-fast en produccion.
 * - prod sin SENTRY_DSN -> throw al requerir (antes de listen).
 * - dev/test sin SENTRY_DSN -> no throw, silencioso.
 * - prod con DSN ficticio -> Sentry.init intentado (mock, sin red real).
 */

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
}));

const INSTRUMENT_PATH = '../instrument';

function loadFresh({ nodeEnv, sentryDsn }) {
  jest.resetModules();
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
  if (sentryDsn === undefined) {
    delete process.env.SENTRY_DSN;
  } else {
    process.env.SENTRY_DSN = sentryDsn;
  }
  // eslint-disable-next-line global-require
  return require(INSTRUMENT_PATH);
}

describe('instrument (Sentry fail-fast)', () => {
  const OLD_NODE_ENV = process.env.NODE_ENV;
  const OLD_SENTRY_DSN = process.env.SENTRY_DSN;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetModules();
    if (OLD_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = OLD_NODE_ENV;
    }
    if (OLD_SENTRY_DSN === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = OLD_SENTRY_DSN;
    }
  });

  test('prod sin DSN -> throw que nombra SENTRY_DSN sin mostrar valores', () => {
    expect(() => loadFresh({ nodeEnv: 'production', sentryDsn: undefined }))
      .toThrow(/SENTRY_DSN/);
  });

  test('dev sin DSN -> no throw y no intenta init', () => {
    let exported;
    expect(() => {
      exported = loadFresh({ nodeEnv: 'development', sentryDsn: undefined });
    }).not.toThrow();
    expect(exported).toBeDefined();
    // Referencia fresca: loadFresh hace resetModules y crea nueva instancia del mock.
    const SentryMock = require('@sentry/node');
    expect(SentryMock.init).not.toHaveBeenCalled();
  });

  test('test sin DSN -> no throw (opcional y silencioso)', () => {
    expect(() => loadFresh({ nodeEnv: 'test', sentryDsn: undefined })).not.toThrow();
  });

  test('prod con DSN ficticio -> init intentado sin red real', () => {
    const fakeDsn = 'https://publickey@localhost/1';
    expect(() => loadFresh({ nodeEnv: 'production', sentryDsn: fakeDsn })).not.toThrow();
    // Referencia fresca: loadFresh hace resetModules y crea nueva instancia del mock.
    const SentryMock = require('@sentry/node');
    expect(SentryMock.init).toHaveBeenCalledTimes(1);
    expect(SentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: fakeDsn, sendDefaultPii: false })
    );
  });
});
