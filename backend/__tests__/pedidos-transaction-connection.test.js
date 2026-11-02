'use strict';

const mockOdbcConnect = jest.fn();
const mockGetPool = jest.fn();
const mockInitDb = jest.fn();

jest.mock('odbc', () => ({
  connect: (...args) => mockOdbcConnect(...args),
}));

jest.mock('../config/db', () => ({
  getPool: (...args) => mockGetPool(...args),
  initDb: (...args) => mockInitDb(...args),
}));

const {
  dedicatedConnectionConfig,
  openDedicatedPedidosTransactionConnection,
} = require('../adapters/pedidos-transaction-connection');

beforeEach(() => {
  jest.clearAllMocks();
  mockInitDb.mockResolvedValue(undefined);
});

test('opens a physical ODBC connection from the central pool configuration', async () => {
  const connection = { close: jest.fn().mockResolvedValue(undefined) };
  mockGetPool.mockReturnValue({
    connectionConfig: {
      connectionString: 'DSN=TEST_REFERENCE_ONLY',
      connectionTimeout: 30,
      loginTimeout: 10,
      fetchArray: true,
      ignoredPoolSetting: 'not-forwarded',
    },
  });
  mockOdbcConnect.mockResolvedValue(connection);

  await expect(openDedicatedPedidosTransactionConnection()).resolves.toBe(connection);
  expect(mockOdbcConnect).toHaveBeenCalledWith({
    connectionString: 'DSN=TEST_REFERENCE_ONLY',
    connectionTimeout: 30,
    loginTimeout: 10,
    fetchArray: true,
  });
});

test('initializes DB once and then reads the central connection configuration', async () => {
  const pool = { connectionConfig: { connectionString: 'DSN=AFTER_INIT' } };
  mockGetPool.mockReturnValueOnce(null).mockReturnValueOnce(pool);
  mockOdbcConnect.mockResolvedValue({ close: jest.fn() });

  await openDedicatedPedidosTransactionConnection();

  expect(mockInitDb).toHaveBeenCalledTimes(1);
  expect(mockOdbcConnect).toHaveBeenCalledWith({
    connectionString: 'DSN=AFTER_INIT',
  });
});

test.each([
  null,
  {},
  { connectionConfig: {} },
  { connectionConfig: { connectionString: '   ' } },
])('fails closed without a usable central config: %p', async (pool) => {
  mockGetPool.mockReturnValue(pool);

  await expect(openDedicatedPedidosTransactionConnection()).rejects.toMatchObject({
    code: 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE',
    status: 503,
  });
  expect(mockOdbcConnect).not.toHaveBeenCalled();
});

test('copies only supported ODBC connection fields', () => {
  expect(dedicatedConnectionConfig({
    connectionConfig: {
      connectionString: 'DSN=SAFE',
      connectionTimeout: 12,
      secretAdjacentField: 'never-forward',
    },
  })).toEqual({
    connectionString: 'DSN=SAFE',
    connectionTimeout: 12,
  });
});
