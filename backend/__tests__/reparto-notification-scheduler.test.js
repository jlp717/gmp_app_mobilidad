'use strict';

const mockRedis = {
  isConnected: true,
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
};
const mockDigest = jest.fn();
const mockOutbox = jest.fn();
const mockScheduleJob = jest.fn();

jest.mock('node-schedule', () => ({
  RecurrenceRule: class RecurrenceRule {},
  Range: class Range {
    constructor(start, end, step) {
      this.start = start;
      this.end = end;
      this.step = step;
    }
  },
  scheduleJob: (...args) => mockScheduleJob(...args),
}));
jest.mock('../services/redis-cache', () => ({ redisCache: mockRedis }));
jest.mock('../services/reparto-variance-notification-service', () => ({
  sendDailyVarianceDigest: (...args) => mockDigest(...args),
}));
jest.mock('../services/repartidor-liquidacion-outbox-service', () => ({
  processPendingLiquidacionOutbox: (...args) => mockOutbox(...args),
}));

const scheduler = require('../services/reparto-notification-scheduler');

describe('reparto notification scheduler', () => {
  const original = {
    pmId: process.env.pm_id,
    nodeAppInstance: process.env.NODE_APP_INSTANCE,
    instanceId: process.env.INSTANCE_ID,
    enabled: process.env.REPARTO_NOTIFICATION_SCHEDULER_ENABLED,
  };

  beforeEach(() => {
    scheduler.stopRepartoNotificationScheduler();
    jest.clearAllMocks();
    mockRedis.isConnected = true;
    mockDigest.mockResolvedValue({ sent: 4, items: 1 });
    mockOutbox.mockResolvedValue({ processed: 0, sent: 0 });
    mockScheduleJob.mockImplementation(() => ({
      cancel: jest.fn(),
      nextInvocation: () => new Date('2026-08-20T05:00:00.000Z'),
    }));
    delete process.env.NODE_APP_INSTANCE;
    delete process.env.INSTANCE_ID;
    delete process.env.REPARTO_NOTIFICATION_SCHEDULER_ENABLED;
  });

  afterAll(() => {
    scheduler.stopRepartoNotificationScheduler();
    const entries = [
      ['pm_id', original.pmId],
      ['NODE_APP_INSTANCE', original.nodeAppInstance],
      ['INSTANCE_ID', original.instanceId],
      ['REPARTO_NOTIFICATION_SCHEDULER_ENABLED', original.enabled],
    ];
    for (const [key, value] of entries) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('executes a digest once when only one worker wins the distributed lock', async () => {
    mockRedis.acquireLock
      .mockResolvedValueOnce('leader-token')
      .mockResolvedValueOnce(null);

    const results = await Promise.all([
      scheduler.runVarianceDigestJob(),
      scheduler.runVarianceDigestJob(),
    ]);

    expect(mockDigest).toHaveBeenCalledTimes(1);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ sent: 4, items: 1 }),
      { skipped: true, reason: 'not_leader' },
    ]));
    expect(mockRedis.releaseLock).toHaveBeenCalledWith(
      'reparto-notify',
      'scheduler:variance-digest',
      'leader-token',
    );
  });

  test('does not silently run without a distributed lock', async () => {
    mockRedis.isConnected = false;
    const result = await scheduler.runLiquidacionOutboxJob();
    expect(result).toEqual({ skipped: true, reason: 'redis_lock_unavailable' });
    expect(mockOutbox).not.toHaveBeenCalled();
  });

  test('schedules the Madrid jobs when PM2 only exposes a numeric pm_id', () => {
    process.env.pm_id = '455';
    const started = scheduler.startRepartoNotificationScheduler();
    const status = scheduler.getRepartoNotificationSchedulerStatus();

    expect(started.digestJob).not.toBeNull();
    expect(started.outboxJob).not.toBeNull();
    expect(mockScheduleJob).toHaveBeenCalledTimes(2);
    expect(status).toMatchObject({
      active: true,
      timezone: 'Europe/Madrid',
      digestCron: '0 7 * * *',
      outboxDrainActive: true,
      distributedExecutionLock: true,
    });
  });
});
