/**
 * WhatsApp delivery gateway — picks free Baileys session, Cloud API, or local share.
 *
 * Priority when sending:
 *   1. Baileys (free, linked company phone) if enabled + paired
 *   2. Meta Cloud API if enabled + credentials
 *   3. Caller falls back to LOCAL_USER_ACTION
 */

'use strict';

const baileys = require('./whatsappBaileysService');
const cloud = require('./whatsappCloudService');

function activeProvider() {
  if (baileys.isConfigured() && baileys.isReady()) return 'BAILEYS';
  if (cloud.isConfigured()) return 'CLOUD';
  if (baileys.isConfigured()) return 'BAILEYS_PENDING';
  return 'NONE';
}

function isBotConfigured() {
  // Baileys counts as configured even before QR (admin can pair).
  // Cloud requires credentials.
  return baileys.isConfigured() || cloud.isConfigured();
}

function isBotReady() {
  return (baileys.isConfigured() && baileys.isReady()) || cloud.isConfigured();
}

function getStatus() {
  return {
    activeProvider: activeProvider(),
    botReady: isBotReady(),
    baileys: baileys.getStatus(),
    cloud: {
      provider: 'CLOUD',
      enabled: cloud.isEnabled(),
      configured: cloud.isConfigured(),
    },
  };
}

/**
 * @returns {Promise<{success:true,messageId:string,mode:string,to:string,provider:string}>}
 */
async function sendDocumentFromBot(params) {
  if (baileys.isConfigured()) {
    const ready = await baileys.ensureReady();
    if (ready) {
      const result = await baileys.sendDocumentFromBot(params);
      return { ...result, provider: 'BAILEYS' };
    }
    // Enabled but not paired — do not silently fall through to Cloud unless Cloud works.
    if (!cloud.isConfigured()) {
      const err = new Error('WhatsApp Baileys no emparejado — escanea QR');
      err.code = 'WHATSAPP_BAILEYS_NOT_PAIRED';
      throw err;
    }
  }

  if (cloud.isConfigured()) {
    const result = await cloud.sendDocumentFromBot(params);
    return { ...result, provider: 'CLOUD' };
  }

  const err = new Error('Ningún gateway WhatsApp configurado');
  err.code = 'WHATSAPP_NOT_CONFIGURED';
  throw err;
}

module.exports = {
  activeProvider,
  isBotConfigured,
  isBotReady,
  getStatus,
  sendDocumentFromBot,
  baileys,
  cloud,
};
