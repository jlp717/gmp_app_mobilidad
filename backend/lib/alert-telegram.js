'use strict';
/**
 * Fire-and-forget Telegram alerting for crash/unhealthy events.
 * Reuses the Telegram channel already used by the team Daily Digest.
 * Falls back to a local JSONL so alerts are never silently lost when the
 * TELEGRAM_ALERT_* env vars are not configured.
 */

const fs = require('fs');
const path = require('path');

const FALLBACK_FILE = path.resolve(__dirname, '../../.opencode/state/alerts-fallback.jsonl');

function appendFallback(entry) {
  try {
    fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
    fs.appendFileSync(FALLBACK_FILE, JSON.stringify(entry) + '\n');
  } catch (_) { /* last-resort sink; never throw from an alert */ }
}

/**
 * Send an alert. Never throws. Timeout-bounded (5s), fire-and-forget.
 * no_retry_reason documented: transient Telegram failures are logged to the
 * fallback JSONL instead of retried to avoid alert storms during incidents.
 */
async function sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_ALERT_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) {
    appendFallback({ ts: new Date().toISOString(), channel: 'telegram', status: 'skipped', no_retry_reason: 'TELEGRAM_ALERT_BOT_TOKEN/TELEGRAM_ALERT_CHAT_ID not configured', text });
    return { sent: false, reason: 'not_configured' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      appendFallback({ ts: new Date().toISOString(), channel: 'telegram', status: 'http_' + res.status, no_retry_reason: 'single-shot alert, see runbook', text });
      return { sent: false, reason: 'http_' + res.status };
    }
    return { sent: true };
  } catch (err) {
    appendFallback({ ts: new Date().toISOString(), channel: 'telegram', status: 'error', error: err.message, no_retry_reason: 'single-shot alert, see runbook', text });
    return { sent: false, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Build and dispatch a structured alert. Safe to call from crash handlers. */
function alert(title, details = {}) {
  const host = require('os').hostname();
  const text = `[GMP-ALERT] ${title}\nhost: ${host}\nenv: ${process.env.NODE_ENV || 'development'}\n${JSON.stringify(details)}`;
  // Promise intentionally not awaited by callers (fire-and-forget).
  return sendTelegramAlert(text);
}

module.exports = { alert, sendTelegramAlert };
