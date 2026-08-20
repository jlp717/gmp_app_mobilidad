'use strict';

const mockAcquire = jest.fn();
const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
  acquireConfiguredConnection: (...args) => mockAcquire(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../config/reparto-runtime', () => ({
  resolveRepartoRuntime: () => ({
    valid: true,
    tableSet: 'isolated_test',
    tables: { routing: { order: 'JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN' } },
  }),
}));

const repo = require('../repositories/repartidor-rutero-orden-db2-repository');

const prior = [{ DOCUMENT_ID: 'DOC-1', CLIENTE_CODIGO: 'C1', ORDEN: 0, UPDATED_AT: '2026-08-20-10.00.00.000001', UPDATED_BY: '05' }];
const next = [{ DOCUMENT_ID: 'DOC-2', CLIENTE_CODIGO: 'C2', ORDEN: 0, UPDATED_AT: '2026-08-20-10.01.00.000001', UPDATED_BY: '05' }];

function connection(sequence, calls) {
  const query = jest.fn(async (sql) => {
    if (/LOCK TABLE/.test(sql)) {
      calls.push('lock');
      return [];
    }
    if (/SELECT/.test(sql)) {
      calls.push('select');
      return sequence.shift() || [];
    }
    if (/DELETE/.test(sql)) {
      calls.push('delete');
      return [];
    }
    if (/INSERT/.test(sql)) {
      calls.push('insert');
      if (sequence[0] instanceof Error) throw sequence.shift();
      return [];
    }
    return [];
  });
  return {
    query,
    beginTransaction: jest.fn(async () => calls.push('begin')),
    commit: jest.fn(async () => calls.push('commit')),
    rollback: jest.fn(async () => calls.push('rollback')),
    close: jest.fn(async () => calls.push('close')),
  };
}

describe('repartidor-rutero-orden-db2-repository', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('rolls back when an insert fails and never commits a partial route', async () => {
    const calls = [];
    const db = connection([prior, new Error('insert failed')], calls);
    mockAcquire.mockResolvedValue(db);
    await expect(repo.replaceOrder('05', '2026-08-20', [{ documentId: 'DOC-2', cliente: 'C2', posicion: 0 }], '05', repo.revisionForRows(prior))).rejects.toThrow('insert failed');
    expect(db.beginTransaction).toHaveBeenCalledTimes(1);
    expect(db.rollback).toHaveBeenCalledTimes(1);
    expect(db.commit).not.toHaveBeenCalled();
    expect(calls).toEqual(['begin', 'lock', 'select', 'delete', 'insert', 'rollback', 'close']);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  test('rejects a stale revision before DELETE', async () => {
    const calls = [];
    const db = connection([prior], calls);
    mockAcquire.mockResolvedValue(db);
    await expect(repo.replaceOrder('05', '2026-08-20', [{ documentId: 'DOC-2', cliente: 'C2', posicion: 0 }], '05', 'stale')).rejects.toMatchObject({ code: 'RUTERO_ORDER_CONFLICT', statusCode: 409 });
    expect(db.query.mock.calls.some(([sql]) => /^DELETE/.test(sql))).toBe(false);
    expect(db.rollback).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['begin', 'lock', 'select', 'rollback', 'close']);
  });

  test('reads back canonical rows and revision after the atomic save', async () => {
    const calls = [];
    const db = connection([prior, next], calls);
    mockAcquire.mockResolvedValue(db);
    const saved = await repo.replaceOrder('05', '2026-08-20', [{ documentId: 'DOC-2', cliente: 'C2', posicion: 0 }], '05', repo.revisionForRows(prior));
    expect(saved.orden).toEqual([{ documentId: 'DOC-2', cliente: 'C2', posicion: 0 }]);
    expect(saved.revision).toBe(repo.revisionForRows(next));
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['begin', 'lock', 'select', 'delete', 'insert', 'select', 'commit', 'close']);
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
