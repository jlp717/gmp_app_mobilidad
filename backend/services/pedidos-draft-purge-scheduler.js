'use strict';

/**
 * Periodic purge of comercial draft orders older than 24h (+ stock reserves).
 * Relying only on createOrder best-effort left expired drafts sitting when
 * nobody created a new pedido. Redis lock → one worker executes per tick.
 */

const schedule = require('node-schedule');
const logger = require('../middleware/logger');
const { redisCache } = require('./redis-cache');

const TZ = process.env.PEDIDOS_DRAFT_PURGE_TZ || 'Europe/Madrid';
const DEFAULT_CRON = process.env.PEDIDOS_DRAFT_PURGE_CRON || '*/15 * * * *';
const DEFAULT_LIMIT = Math.min(
  Math.max(parseInt(process.env.PEDIDOS_DRAFT_PURGE_LIMIT, 10) || 50, 1),
  200,
);

let purgeJob = null;

function buildEveryFifteenMinutesRule() {
  const rule = new schedule.RecurrenceRule();
  rule.tz = TZ;
  rule.minute = new schedule.Range(0, 59, 15);
  return rule;
}

async function runExclusively(task, ttlMs) {
  if (!redisCache?.isConnected || typeof redisCache.acquireLock !== 'function') {
    // Still run on a single local worker when Redis lock is unavailable —
    // better to purge twice than never.
    return task();
  }
  const lockKey = 'scheduler:pedidos-draft-purge';
  const token = await redisCache.acquireLock('pedidos-draft-purge', lockKey, ttlMs);
  if (!token) {
    return { skipped: true, reason: 'not_leader' };
  }
  try {
    return await task();
  } finally {
    await redisCache.releaseLock?.('pedidos-draft-purge', lockKey, token);
  }
}

async function runDraftPurgeJob({
  purge = null,
  limit = DEFAULT_LIMIT,
} = {}) {
  return runExclusively(async () => {
    const fn = purge || require('./pedidos').purgeExpiredDraftReservations;
    const result = await fn({ limit });
    if (result?.purged > 0) {
      logger.info(
        `[pedidos-draft-purge] purged=${result.purged} candidates=${result.candidates || 0}`,
      );
    }
    return result;
  }, 10 * 60 * 1000);
}

function startPedidosDraftPurgeScheduler() {
  if (process.env.PEDIDOS_DRAFT_PURGE_SCHEDULER_ENABLED === 'false') {
    logger.info('[pedidos-draft-purge] scheduler disabled');
    return { purgeJob: null };
  }

  const instanceRaw = process.env.NODE_APP_INSTANCE ?? process.env.INSTANCE_ID;
  if (instanceRaw !== undefined && instanceRaw !== '' && String(instanceRaw) !== '0') {
    logger.info(`[pedidos-draft-purge] skipped on worker instance=${instanceRaw}`);
    return { purgeJob: null };
  }

  if (purgeJob) purgeJob.cancel();
  // Prefer explicit cron when provided; otherwise every 15 minutes.
  const cronExpr = process.env.PEDIDOS_DRAFT_PURGE_CRON;
  purgeJob = cronExpr
    ? schedule.scheduleJob(cronExpr, () => {
      runDraftPurgeJob().catch((err) => {
        logger.warn(`[pedidos-draft-purge] tick failed: ${err.message}`);
      });
    })
    : schedule.scheduleJob(buildEveryFifteenMinutesRule(), () => {
      runDraftPurgeJob().catch((err) => {
        logger.warn(`[pedidos-draft-purge] tick failed: ${err.message}`);
      });
    });

  const next = purgeJob ? purgeJob.nextInvocation() : null;
  logger.info(
    `[pedidos-draft-purge] cron=${cronExpr || DEFAULT_CRON} (${TZ}); next=${
      next ? new Date(next).toLocaleString('es-ES', { timeZone: TZ }) : 'n/a'
    }`,
  );

  // Fire once shortly after boot so expired drafts do not wait for the first cron.
  setTimeout(() => {
    runDraftPurgeJob().catch((err) => {
      logger.warn(`[pedidos-draft-purge] boot tick failed: ${err.message}`);
    });
  }, 15_000).unref?.();

  return { purgeJob };
}

function stopPedidosDraftPurgeScheduler() {
  if (purgeJob) {
    purgeJob.cancel();
    purgeJob = null;
  }
  logger.info('[pedidos-draft-purge] scheduler stopped');
}

function getPedidosDraftPurgeSchedulerStatus() {
  const next = purgeJob ? purgeJob.nextInvocation() : null;
  return {
    active: purgeJob !== null,
    timezone: TZ,
    cron: process.env.PEDIDOS_DRAFT_PURGE_CRON || DEFAULT_CRON,
    next,
    nextFormatted: next
      ? new Date(next).toLocaleString('es-ES', { timeZone: TZ })
      : null,
  };
}

module.exports = {
  startPedidosDraftPurgeScheduler,
  stopPedidosDraftPurgeScheduler,
  getPedidosDraftPurgeSchedulerStatus,
  runDraftPurgeJob,
};
