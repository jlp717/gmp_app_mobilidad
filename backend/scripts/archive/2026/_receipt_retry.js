// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-retry | _-scratch gitignored; reintento puntual recibos | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Re-GET receipt 16 + signature after confirm. No token printed.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const mint = JSON.parse(fs.readFileSync(path.join(__dirname, '_mint_out.json'), 'utf8'));
if (!mint.ok || !mint.token) {
  console.log(JSON.stringify({ ok: false, reason: 'mint missing' }));
  process.exit(1);
}

function request(method, apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'api.mari-pepa.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'GMP-App/1.0 Dart/3.0 (receipt-retry)',
        Accept: 'application/json',
        Authorization: `Bearer ${mint.token}`,
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size <= 12 * 1024 * 1024) chunks.push(c);
      });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, json, bytes: size });
      });
    });
    req.setTimeout(90000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const receipt = await request('GET', '/api/repartidor-finanzas/rutero/confirmations/16/receipt');
  const sig = await request(
    'GET',
    '/api/repartidor/history/signature?ejercicio=2026&serie=J&terminal=93&numero=1867',
  );
  const evidence = await request(
    'GET',
    '/api/repartidor-finanzas/rutero/evidence/ev_491e54198637666ac21c51cbd41185c567cb749418a9958083b610c3e4958ee7',
  );
  console.log(JSON.stringify({
    receipt: {
      status: receipt.status,
      code: receipt.json?.code || null,
      pdfLen: receipt.json?.pdfBase64 ? String(receipt.json.pdfBase64).length : 0,
      confirmationId: receipt.json?.confirmationId || null,
    },
    signature: {
      status: sig.status,
      hasSignature: Boolean(sig.json?.hasSignature),
      hasBase64: Boolean(sig.json?.signature?.base64),
      dni: sig.json?.signature?.dni || null,
      nombre: sig.json?.signature?.nombre || sig.json?.signature?.firmante || null,
      apellidos: sig.json?.signature?.apellidos || null,
      source: sig.json?.signature?.source || null,
    },
    evidence: {
      status: evidence.status,
      code: evidence.json?.code || null,
      kind: evidence.json?.kind || null,
    },
  }));
  process.exit(receipt.status === 200 && (receipt.json?.pdfBase64 || '').length > 20 ? 0 : 1);
})().catch((error) => {
  console.log(JSON.stringify({ ok: false, message: String(error.message || error).slice(0, 180) }));
  process.exit(1);
});
