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
  withLocalConfirmationTransaction,
  withDraftPurgeTransaction,
  STOCK_RESERVATION_LOCK_SQL,
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

test('uses one connection and locks reservations before the local confirmation mutation', async () => {
  const callback = jest.fn(async (conn) => {
    expect(conn.query).toBe(mockQuery);
    await conn.query('UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO = ? WHERE ID = ?', ['CONFIRMADO', 42]);
    await conn.query('INSERT INTO JAVIER.TEST_PEDIDOS_STOCK_RESERVE (PEDIDO_ID) VALUES (?)', [42]);
    await conn.query('INSERT INTO JAVIER.TEST_MOVIMIENTOS_BOLSA (PEDIDO_ID) VALUES (?)', [42]);
    return { ok: true };
  });

  await expect(withLocalConfirmationTransaction(callback)).resolves.toEqual({ ok: true });

  expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls.map(([sql]) => sql)).toEqual([
    'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
    STOCK_RESERVATION_LOCK_SQL,
    'UPDATE JAVIER.TEST_PEDIDOS_CAB SET ESTADO = ? WHERE ID = ?',
    'INSERT INTO JAVIER.TEST_PEDIDOS_STOCK_RESERVE (PEDIDO_ID) VALUES (?)',
    'INSERT INTO JAVIER.TEST_MOVIMIENTOS_BOLSA (PEDIDO_ID) VALUES (?)',
  ]);
  expect(mockCommit).toHaveBeenCalledTimes(1);
  expect(mockRollback).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test.each(['stock reservation failed', 'bolsa movement failed'])(
  'rolls back and never commits when %s',
  async (message) => {
    await expect(withLocalConfirmationTransaction(async () => {
      throw new Error(message);
    })).rejects.toThrow(message);

    const statements = mockQuery.mock.calls.map(([sql]) => sql);
    expect(statements).toEqual([
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      STOCK_RESERVATION_LOCK_SQL,
    ]);
    expect(mockRollback).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  },
);

test('fails closed when no dedicated connection is available', async () => {
  const unavailable = new Error('dedicated connection unavailable');
  unavailable.code = 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE';
  unavailable.status = 503;
  mockOpenDedicatedConnection.mockRejectedValue(unavailable);

  await expect(withLocalConfirmationTransaction(jest.fn())).rejects.toMatchObject({
    code: 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE',
    status: 503,
  });
  expect(mockOpenDedicatedConnection).toHaveBeenCalledTimes(1);
});

test('draft purge locks reservations then order headers in one transaction', async () => {
  const callback = jest.fn().mockResolvedValue({ purged: true });

  await expect(withDraftPurgeTransaction(callback)).resolves.toEqual({ purged: true });

  expect(mockQuery.mock.calls.map(([sql]) => sql)).toEqual([
    'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
    STOCK_RESERVATION_LOCK_SQL,
    ORDERS_HEADER_LOCK_SQL,
  ]);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(mockCommit).toHaveBeenCalledTimes(1);
  expect(mockRollback).not.toHaveBeenCalled();
});

