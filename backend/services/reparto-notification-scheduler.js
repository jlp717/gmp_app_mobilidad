'use strict';

/**
 * Daily 18:00 Europe/Madrid variance digest + liquidacion outbox drain.
 */

const schedule = require('node-schedule');
const logger = require('../middleware/logger');
const { sendDailyVarianceDigest } = require('./reparto-variance-notification-service');
const {
  processPendingLiquidacionOutbox,
} = require('./repartidor-liquidacion-outbox-service');

const TZ = process.env.REPARTO_NOTIFICATION_TZ || 'Europe/Madrid';
const DEFAULT_CRON = '0 18 * * *';

let digestJob = null;
let outboxJob = null;

function buildRule(cronExpr) {
  const rule = new schedule.RecurrenceRule();
  rule.tz = TZ;
  const parts = String(cronExpr || DEFAULT_CRON).trim().split(/\s+/);
  rule.minute = parseInt(parts[0], 10) || 0;
  rule.hour = parseInt(parts[1], 10);
  if (Number.isNaN(rule.hour)) rule.hour = 18;
  if (parts[4] && parts[4] !== '*') {
    if (parts[4].includes('-')) {
      const [start, end] = parts[4].split('-').map(Number);
      rule.dayOfWeek = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    } else if (parts[4].includes(',')) {
      rule.dayOfWeek = parts[4].split(',').map(Number);
    } else {
      rule.dayOfWeek = parseInt(parts[4], 10);
    }
  }
  return rule;
}

async function runVarianceDigestJob() {
  const started = new Date().toLocaleString('es-ES', { timeZone: TZ });
  logger.info(`[reparto-notify] variance digest start (${started})`);
  try {
    const result = await sendDailyVarianceDigest();
    logger.info(`[reparto-notify] variance digest done sent=${result.sent} items=${result.items}`);
    return result;
  } catch (error) {
    logger.error(`[reparto-notify] variance digest error: ${error.message}`);
    throw error;
  }
}

async function runLiquidacionOutboxJob() {
  try {
    const result = await processPendingLiquidacionOutbox();
    if (result.processed > 0) {
      logger.info(`[reparto-notify] liquidacion outbox processed=${result.processed} sent=${result.sent}`);
    }
    return result;
  } catch (error) {
    logger.error(`[reparto-notify] liquidacion outbox error: ${error.message}`);
    throw error;
  }
}

function startRepartoNotificationScheduler() {
  if (process.env.REPARTO_NOTIFICATION_SCHEDULER_ENABLED === 'false') {
    logger.info('[reparto-notify] scheduler disabled (REPARTO_NOTIFICATION_SCHEDULER_ENABLED=false)');
    return { digestJob: null, outboxJob: null };
  }

  // PM2 cluster: only instance 0 owns cron (avoid N digests).
  const instanceRaw = process.env.NODE_APP_INSTANCE ?? process.env.pm_id ?? process.env.INSTANCE_ID;
  if (instanceRaw !== undefined && instanceRaw !== '' && String(instanceRaw) !== '0') {
    logger.info(`[reparto-notify] scheduler skipped on worker instance=${instanceRaw}`);
    return { digestJob: null, outboxJob: null };
  }

  const cronExpr = process.env.REPARTO_VARIANCE_DIGEST_CRON || DEFAULT_CRON;
  if (digestJob) digestJob.cancel();
  digestJob = schedule.scheduleJob(buildRule(cronExpr), () => {
    runVarianceDigestJob().catch(() => {});
  });

  // Safety drain for PENDING liquidacion emails every 15 minutes
  if (outboxJob) outboxJob.cancel();
  const outboxRule = new schedule.RecurrenceRule();
  outboxRule.tz = TZ;
  outboxRule.minute = new schedule.Range(0, 59, 15);
  outboxJob = schedule.scheduleJob(outboxRule, () => {
    runLiquidacionOutboxJob().catch(() => {});
  });

  const nextDigest = digestJob ? digestJob.nextInvocation() : null;
  logger.info(
    `[reparto-notify] digest cron=${cronExpr} (${TZ}); next=${
      nextDigest ? new Date(nextDigest).toLocaleString('es-ES', { timeZone: TZ }) : 'n/a'
    }`,
  );

  return { digestJob, outboxJob };
}

function stopRepartoNotificationScheduler() {
  if (digestJob) {
    digestJob.cancel();
    digestJob = null;
  }
  if (outboxJob) {
    outboxJob.cancel();
    outboxJob = null;
  }
  logger.info('[reparto-notify] scheduler stopped');
}

function getRepartoNotificationSchedulerStatus() {
  const nextDigest = digestJob ? digestJob.nextInvocation() : null;
  return {
    active: digestJob !== null,
    timezone: TZ,
    digestCron: process.env.REPARTO_VARIANCE_DIGEST_CRON || DEFAULT_CRON,
    nextDigest,
    nextDigestFormatted: nextDigest
      ? new Date(nextDigest).toLocaleString('es-ES', { timeZone: TZ })
      : null,
    outboxDrainActive: outboxJob !== null,
  };
}

module.exports = {
  startRepartoNotificationScheduler,
  stopRepartoNotificationScheduler,
  getRepartoNotificationSchedulerStatus,
  runVarianceDigestJob,
  runLiquidacionOutboxJob,
};
