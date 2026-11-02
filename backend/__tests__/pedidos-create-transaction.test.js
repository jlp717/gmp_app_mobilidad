'use strict';

const mockQuery = jest.fn();
const mockClose = jest.fn();
const mockOpenDedicatedConnection = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();

jest.mock('../adapters/pedidos-transaction-connection', () => ({
  openDedicatedPedidosTransactionConnection: (...args) =>
    mockOpenDedicatedConnection(...args),
}));

jest.mock('../middleware/logger', () => ({
  error: jest.fn(),
}));

const {
  ORDERS_HEADER_LOCK_SQL,
  STOCK_RESERVATION_LOCK_SQL,
  withDraftCreationTransaction,
} = require('../services/pedidos/local-confirmation-transaction');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockClose.mockResolvedValue(undefined);
  mockBeginTransaction.mockResolvedValue(undefined);
  mockCommit.mockResolvedValue(undefined);
  mockRollback.mockResolvedValue(undefined);
  mockOpenDedicatedConnection.mockResolvedValue({
    query: mockQuery,
    beginTransaction: mockBeginTransaction,
    commit: mockCommit,
    rollback: mockRollback,
    close: mockClose,
  });
});

test('draft create locks global reservations then headers and commits once', async () => {
  const callback = jest.fn(async (conn) => {
    await conn.query('SELECT stock after lock');
    await conn.query('INSERT header');
    await conn.query('INSERT lines');
    await conn.query('UPDATE totals');
    await conn.query('INSERT reservation');
    await conn.query('INSERT idempotency');
    return { pedidoId: 42 };
  });

  await expect(withDraftCreationTransaction(callback)).resolves.toEqual({ pedidoId: 42 });

  expect(mockQuery.mock.calls.map(([sql]) => sql)).toEqual([
    'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
    STOCK_RESERVATION_LOCK_SQL,
    ORDERS_HEADER_LOCK_SQL,
    'SELECT stock after lock',
    'INSERT header',
    'INSERT lines',
    'UPDATE totals',
    'INSERT reservation',
    'INSERT idempotency',
  ]);
  expect(mockCommit).toHaveBeenCalledTimes(1);
  expect(mockRollback).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test.each([
  'header failed',
  'line failed',
  'totals failed',
  'reservation failed',
  'idempotency failed',
])('draft create rolls back and never commits when %s', async (message) => {
  await expect(withDraftCreationTransaction(() => {
    throw new Error(message);
  })).rejects.toThrow(message);

  expect(mockRollback).toHaveBeenCalledTimes(1);
  expect(mockCommit).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test('draft create fails closed when a dedicated transaction is unavailable', async () => {
  const unavailable = new Error('dedicated connection unavailable');
  unavailable.code = 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE';
  unavailable.status = 503;
  mockOpenDedicatedConnection.mockRejectedValue(unavailable);

  await expect(withDraftCreationTransaction(jest.fn())).rejects.toMatchObject({
    code: 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE',
    status: 503,
  });
  expect(mockCommit).not.toHaveBeenCalled();
});

