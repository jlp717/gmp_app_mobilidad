'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    isConnected: false,
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  },
}));

describe('pedidos-draft-purge-scheduler', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.PEDIDOS_DRAFT_PURGE_SCHEDULER_ENABLED;
    delete process.env.NODE_APP_INSTANCE;
    delete process.env.INSTANCE_ID;
  });

  test('runDraftPurgeJob invokes purge helper', async () => {
    const purge = jest.fn().mockResolvedValue({ purged: 2, candidates: 2 });
    const { runDraftPurgeJob } = require('../services/pedidos-draft-purge-scheduler');
    const result = await runDraftPurgeJob({ purge, limit: 10 });
    expect(purge).toHaveBeenCalledWith({ limit: 10 });
    expect(result).toEqual({ purged: 2, candidates: 2 });
  });

  test('scheduler can be disabled via env', () => {
    process.env.PEDIDOS_DRAFT_PURGE_SCHEDULER_ENABLED = 'false';
    const {
      startPedidosDraftPurgeScheduler,
      getPedidosDraftPurgeSchedulerStatus,
    } = require('../services/pedidos-draft-purge-scheduler');
    const started = startPedidosDraftPurgeScheduler();
    expect(started.purgeJob).toBeNull();
    expect(getPedidosDraftPurgeSchedulerStatus().active).toBe(false);
  });
});
