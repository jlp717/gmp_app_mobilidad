/**
 * Free corporate WhatsApp gateway via Baileys (WhatsApp Web multi-device).
 *
 * NOT Meta WhatsApp Business API. Links a normal company phone (QR once) and
 * sends text + PDF from that number — same UX as a "bot" for the recipient.
 *
 * Trade-offs (senior notes):
 * - €0 / no WABA / no templates
 * - Violates WhatsApp ToS if abused; use a dedicated company SIM, low volume,
 *   human-like cadence. Ban risk exists.
 * - Session must stay on the server (auth files + reconnect).
 *
 * Env:
 *   WHATSAPP_BAILEYS_ENABLED=true
 *   WHATSAPP_BAILEYS_AUTH_DIR=/opt/gmp-api/data/whatsapp-baileys  (optional)
 *   WHATSAPP_BAILEYS_MIN_INTERVAL_MS=2500                         (optional)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../middleware/logger');

const DEFAULT_AUTH_DIR = path.join(__dirname, '../data/whatsapp-baileys');
const MIN_INTERVAL_MS = Math.max(
  500,
  parseInt(process.env.WHATSAPP_BAILEYS_MIN_INTERVAL_MS || '2500', 10) || 2500,
);

let sock = null;
let starting = null;
let connectionStatus = 'idle'; // idle | connecting | qr | open | close
let lastQr = null;
let lastQrAt = 0;
let lastSendAt = 0;
let sendChain = Promise.resolve();

function isEnabled() {
  return String(process.env.WHATSAPP_BAILEYS_ENABLED || '').toLowerCase() === 'true';
}

function authDir() {
  const fromEnv = String(process.env.WHATSAPP_BAILEYS_AUTH_DIR || '').trim();
  return fromEnv || DEFAULT_AUTH_DIR;
}

function ensureAuthDir() {
  const dir = authDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeE164Digits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits)) {
    const err = new Error('PHONE_INVALID');
    err.code = 'PHONE_INVALID';
    throw err;
  }
  if (digits.length === 9 && digits.startsWith('6')) {
    return `34${digits}`;
  }
  return digits;
}

function toJid(phone) {
  return `${normalizeE164Digits(phone)}@s.whatsapp.net`;
}

function getStatus() {
  return {
    provider: 'BAILEYS',
    enabled: isEnabled(),
    status: connectionStatus,
    ready: connectionStatus === 'open' && Boolean(sock),
    hasQr: Boolean(lastQr) && connectionStatus === 'qr',
    qrAgeMs: lastQr ? Date.now() - lastQrAt : null,
    authDir: authDir(),
  };
}

async function loadBaileys() {
  // CJS-friendly require of the published package.
  // eslint-disable-next-line import/no-extraneous-dependencies
  const baileys = require('@whiskeysockets/baileys');
  return baileys;
}

async function startSocket({ forceNewQr = false } = {}) {
  if (!isEnabled()) {
    const err = new Error('Baileys gateway disabled');
    err.code = 'WHATSAPP_BAILEYS_DISABLED';
    throw err;
  }
  if (starting) return starting;
  if (sock && connectionStatus === 'open' && !forceNewQr) {
    return sock;
  }

  starting = (async () => {
    const baileys = await loadBaileys();
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const {
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers,
    } = baileys;

    const dir = ensureAuthDir();
    if (forceNewQr) {
      try {
        for (const name of fs.readdirSync(dir)) {
          fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        }
      } catch (error) {
        logger.warn('[WhatsAppBaileys] could not clear auth dir', { message: error.message });
      }
      sock = null;
      connectionStatus = 'connecting';
      lastQr = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined;
    }

    connectionStatus = 'connecting';
    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers?.ubuntu?.('Chrome') || ['GMP', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update || {};
      if (qr) {
        lastQr = qr;
        lastQrAt = Date.now();
        connectionStatus = 'qr';
        logger.info('[WhatsAppBaileys] QR ready — scan with company phone (Dispositivos vinculados)');
      }
      if (connection === 'open') {
        connectionStatus = 'open';
        lastQr = null;
        logger.info('[WhatsAppBaileys] session open');
      }
      if (connection === 'close') {
        connectionStatus = 'close';
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        sock = null;
        starting = null;
        logger.warn('[WhatsAppBaileys] connection closed', { statusCode, loggedOut });
        if (!loggedOut && isEnabled()) {
          setTimeout(() => {
            startSocket().catch((error) => {
              logger.error('[WhatsAppBaileys] reconnect failed', { message: error.message });
            });
          }, 3000);
        }
      }
    });

    sock = socket;
    return socket;
  })();

  try {
    return await starting;
  } finally {
    // keep starting until open/qr settles; clear only on failure
    if (connectionStatus === 'close') {
      starting = null;
    }
  }
}

async function ensureReady() {
  if (!isEnabled()) return false;
  if (connectionStatus === 'open' && sock) return true;
  await startSocket();
  // Wait briefly for open after restart with existing creds.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (connectionStatus === 'open' && sock) return true;
    if (connectionStatus === 'qr') return false;
    await new Promise((r) => setTimeout(r, 250));
  }
  return connectionStatus === 'open' && Boolean(sock);
}

function isConfigured() {
  return isEnabled();
}

function isReady() {
  return isEnabled() && connectionStatus === 'open' && Boolean(sock);
}

async function getQrDataUrl() {
  if (!isEnabled()) {
    const err = new Error('Baileys gateway disabled');
    err.code = 'WHATSAPP_BAILEYS_DISABLED';
    throw err;
  }
  await startSocket();
  if (connectionStatus === 'open') {
    return { paired: true, qrDataUrl: null, status: getStatus() };
  }
  const deadline = Date.now() + 20000;
  while (!lastQr && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!lastQr) {
    return { paired: false, qrDataUrl: null, status: getStatus() };
  }
  // eslint-disable-next-line import/no-extraneous-dependencies
  const QRCode = require('qrcode');
  const qrDataUrl = await QRCode.toDataURL(lastQr, { margin: 1, width: 320 });
  return { paired: false, qrDataUrl, status: getStatus() };
}

async function waitSendSlot() {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastSendAt));
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * Send PDF + caption from the linked company WhatsApp number.
 */
async function sendDocumentFromBot({ telefono, pdfBuffer, filename, caption }) {
  if (!isEnabled()) {
    const err = new Error('Baileys gateway disabled');
    err.code = 'WHATSAPP_BAILEYS_DISABLED';
    throw err;
  }
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('PDF buffer requerido');
  }

  const ready = await ensureReady();
  if (!ready || !sock) {
    const err = new Error('WhatsApp gateway not paired — scan QR first');
    err.code = 'WHATSAPP_BAILEYS_NOT_PAIRED';
    throw err;
  }

  const to = normalizeE164Digits(telefono);
  const jid = toJid(to);
  const safeName = String(filename || 'documento.pdf')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 120) || 'documento.pdf';

  const run = async () => {
    await waitSendSlot();
    try {
      const exists = await sock.onWhatsApp(to);
      const ok = Array.isArray(exists) ? exists.some((row) => row?.exists) : false;
      if (!ok) {
        const err = new Error('Número sin WhatsApp');
        err.code = 'WHATSAPP_NUMBER_NOT_REGISTERED';
        throw err;
      }
    } catch (error) {
      if (error.code === 'WHATSAPP_NUMBER_NOT_REGISTERED') throw error;
      // Some Baileys builds throw on check; proceed to send.
      logger.debug('[WhatsAppBaileys] onWhatsApp check skipped', { message: error.message });
    }

    const result = await sock.sendMessage(jid, {
      document: pdfBuffer,
      mimetype: 'application/pdf',
      fileName: safeName,
      caption: caption ? String(caption).slice(0, 1024) : undefined,
    });

    lastSendAt = Date.now();
    const messageId = result?.key?.id ? String(result.key.id) : '';
    if (!messageId) {
      const err = new Error('WhatsApp no devolvió message id');
      err.code = 'WHATSAPP_MESSAGE_ID_REQUIRED';
      throw err;
    }

    logger.info('[WhatsAppBaileys] document sent', {
      toSuffix: to.slice(-4),
      messageId,
    });

    return {
      success: true,
      messageId,
      mode: 'BAILEYS_DOCUMENT',
      to,
    };
  };

  // Serialize outbound sends (ban-risk / rate).
  const job = sendChain.then(run, run);
  sendChain = job.catch(() => {});
  return job;
}

module.exports = {
  isEnabled,
  isConfigured,
  isReady,
  getStatus,
  startSocket,
  ensureReady,
  getQrDataUrl,
  sendDocumentFromBot,
  normalizeE164Digits,
};
