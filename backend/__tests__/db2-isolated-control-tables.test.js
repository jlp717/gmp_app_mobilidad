'use strict';

const ORIGINAL_ENV = { ...process.env };

const CONTROL_TABLES = [
  'REPARTO_CONFIRMACIONES',
  'REPARTO_EVIDENCIAS',
  'REPARTO_CONFIRM_EVIDENCIAS',
];

const ISOLATED_TABLES = [
  'COBROS',
  'REPARTIDOR_COBROS',
  'PEDIDOS_CAB',
  'PEDIDOS_LIN',
  'PEDIDOS_SEQ',
  'PEDIDO_IDEMPOTENCY',
  'PEDIDOS_STOCK_RESERVE',
  'BOLSA_COMERCIAL',
  'MOVIMIENTOS_BOLSA',
  'PEDIDO_STATE_EVENTS',
  'LIQUIDACION_COMERCIAL',
  'DEVOLUCIONES_COMERCIAL',
  ...CONTROL_TABLES,
];

function loadResolver(env) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  for (const key of [
    'APP_ENV',
    'REPARTO_ENVIRONMENT',
    'REPARTO_TABLE_SET',
    'DB2_WRITE_SCHEMA',
    'ALLOW_DSEDAC_APP_BUFFERS',
    'ODBC_DSN',
  ]) {
    if (env[key] === undefined) delete process.env[key];
  }
  return require('../utils/db2-schemas').db2AppTable;
}

function loadLocalOrderGuard(env) {
  loadResolver(env);
  return require('../adapters/pedidos-local-order-state-guard');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('DB2 isolated commercial control-table family', () => {
  test.each(['test', 'demo'])(
    'APP_ENV=%s resolves control and commercial buffers to JAVIER.TEST_* without a valid reparto runtime',
    (appEnv) => {
      const db2AppTable = loadResolver({
        APP_ENV: appEnv,
        DB2_WRITE_SCHEMA: 'JAVIER',
      });

      for (const table of ISOLATED_TABLES) {
        expect(db2AppTable(table)).toBe(`JAVIER.TEST_${table}`);
      }
    },
  );

  test('legacy isolated_test selection remains fail-safe when the full runtime is invalid', () => {
    const db2AppTable = loadResolver({
      REPARTO_TABLE_SET: 'isolated_test',
      DB2_WRITE_SCHEMA: 'JAVIER',
    });

    for (const table of ISOLATED_TABLES) {
      expect(db2AppTable(table)).toBe(`JAVIER.TEST_${table}`);
    }
  });

  test('APP_ENV is normalized and still isolates all buffers before contradictory runtime routing', () => {
    const db2AppTable = loadResolver({
      APP_ENV: ' TeSt ',
      REPARTO_TABLE_SET: 'production',
      DB2_WRITE_SCHEMA: 'DSEDAC',
      ALLOW_DSEDAC_APP_BUFFERS: 'true',
    });

    for (const table of ISOLATED_TABLES) {
      expect(db2AppTable(table)).toBe(`JAVIER.TEST_${table}`);
    }
  });

  test.each([
    [
      'test',
      { APP_ENV: 'test', DB2_WRITE_SCHEMA: 'JAVIER' },
      'JAVIER.TEST_',
    ],
    [
      'production',
      {
        APP_ENV: 'production',
        REPARTO_ENVIRONMENT: 'production',
        REPARTO_TABLE_SET: 'production',
        DB2_WRITE_SCHEMA: 'JAVIER',
      },
      'JAVIER.',
    ],
  ])('local order guard uses one coherent %s table family', (_, env, prefix) => {
    const { TABLES } = loadLocalOrderGuard(env);

    expect(TABLES).toEqual({
      stock: `${prefix}PEDIDOS_STOCK_RESERVE`,
      headers: `${prefix}PEDIDOS_CAB`,
      confirmations: `${prefix}REPARTO_CONFIRMACIONES`,
      evidences: `${prefix}REPARTO_EVIDENCIAS`,
      confirmationEvidences: `${prefix}REPARTO_CONFIRM_EVIDENCIAS`,
      repartidorCobros: `${prefix}REPARTIDOR_COBROS`,
      commercialCobros: `${prefix}COBROS`,
    });
  });

  test('production keeps the normal JAVIER control-table mapping', () => {
    const db2AppTable = loadResolver({
      APP_ENV: 'production',
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_TABLE_SET: 'production',
      DB2_WRITE_SCHEMA: 'JAVIER',
    });

    for (const table of CONTROL_TABLES) {
      expect(db2AppTable(table)).toBe(`JAVIER.${table}`);
    }
  });
});
