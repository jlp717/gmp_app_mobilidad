#!/usr/bin/env node
/**
 * One-shot Baileys pairing helper (prints QR in terminal).
 * Usage on server:
 *   WHATSAPP_BAILEYS_ENABLED=true node scripts/whatsapp-baileys-pair.js
 *
 * Then on company phone: WhatsApp → Dispositivos vinculados → Vincular dispositivo
 */
'use strict';

process.env.WHATSAPP_BAILEYS_ENABLED = process.env.WHATSAPP_BAILEYS_ENABLED || 'true';

const baileysGw = require('../services/whatsappBaileysService');

(async () => {
  console.log('Starting Baileys… auth dir:', baileysGw.getStatus().authDir);
  await baileysGw.startSocket({ forceNewQr: process.argv.includes('--reset') });

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const status = baileysGw.getStatus();
    if (status.ready) {
      console.log('✅ Paired. Session ready. Ctrl+C to exit (PM2 keeps API session).');
      process.exit(0);
    }
    if (status.hasQr) {
      const payload = await baileysGw.getQrDataUrl();
      if (payload.qrDataUrl) {
        console.log('\nScan this QR with the company WhatsApp (linked devices):\n');
        console.log(payload.qrDataUrl);
        console.log('\n(Or open GET /api/repartidor/whatsapp/gateway/qr as JEFE_VENTAS)\n');
      }
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.error('Timeout waiting for pairing');
  process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
