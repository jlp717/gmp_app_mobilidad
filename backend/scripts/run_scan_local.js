/**
 * run_scan_local.js  v2
 * Full product asset scan from Windows dev machine.
 *
 * Strategy:
 *   1. DB2  via local ODBC (DSN=GMP) — get all active product codes
 *   2. HTTP direct to Apache 192.168.1.191 — parse directory listings
 *      Same logic as products.js but executed locally (no rate-limits)
 *   3. API  login check (api.mari-pepa.com) — server health + diagnostics
 *
 * Usage:
 *   node backend/scripts/run_scan_local.js
 *   node backend/scripts/run_scan_local.js --missing-only
 *   node backend/scripts/run_scan_local.js --json
 */
'use strict';

const http  = require('http');
const https = require('https');
const path  = require('path');
const fs    = require('fs');
const odbc  = require('odbc');

// ─────────────────────────────────
// CONFIG
// ─────────────────────────────────
const IMAGES_BASE_URL = process.env.PRODUCT_IMAGES_URL
  || 'http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo';

const DB_DSN      = 'DSN=GMP;UID=JAVIER;PWD=JAVIER';
const API_BASE    = 'https://api.mari-pepa.com';
const VENDOR      = '98';
const PIN         = '9322';
const CONCURRENCY = 15;

const MISSING_ONLY = process.argv.includes('--missing-only');
const OUTPUT_JSON  = process.argv.includes('--json');

const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','bmp','webp','tif','tiff','avif']);

// ─────────────────────────────────
// HTTP HELPER (raw Node, no proxy)
// ─────────────────────────────────
function httpGet(urlStr, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname : url.hostname,
      port     : url.port || (url.protocol === 'https:' ? 443 : 80),
      path     : url.pathname + url.search,
      method   : 'GET',
      headers  : Object.assign({ 'User-Agent': 'GMP-Scanner/2.0' }, extraHeaders || {}),
      timeout  : 8000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(urlStr, bodyStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const buf = Buffer.from(bodyStr);
    const req = https.request({
      hostname : url.hostname,
      port     : url.port || 443,
      path     : url.pathname,
      method   : 'POST',
      headers  : { 'Content-Type': 'application/json', 'Content-Length': buf.length, 'User-Agent': 'GMP-Scanner/2.0' },
      timeout  : 10000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, body: text }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ─────────────────────────────────
// APACHE DIR LISTING PARSER
// ─────────────────────────────────
const dirCache = new Map();

async function listDir(relPath) {
  if (dirCache.has(relPath)) return dirCache.get(relPath);
  // Build URL — avoid double slash
  const base = IMAGES_BASE_URL.replace(/\/$/, '');
  const url  = relPath ? base + '/' + relPath : base + '/';
  try {
    const res = await httpGet(url);
    if (res.status !== 200) { dirCache.set(relPath, null); return null; }
    const links = [];
    const rx = /<a\s+href="([^"?#][^"]*)"[^>]*>/gi;
    let m;
    while ((m = rx.exec(res.body)) !== null) {
      const href = m[1];
      if (href === '../' || href === '/' || href.startsWith('/')) continue;
      try { links.push(decodeURIComponent(href)); }
      catch { links.push(href); }
    }
    dirCache.set(relPath, links);
    return links;
  } catch {
    dirCache.set(relPath, null);
    return null;
  }
}

// ─────────────────────────────────
// IMAGE / FICHA DETECTION
// (mirrors products.js logic exactly)
// ─────────────────────────────────
async function checkProduct(code) {
  const enc   = encodeURIComponent(code);
  const items = await listDir(enc + '/');
  if (items === null) return { exists: false, hasImage: false, hasFicha: false };

  const rootImages = items.filter(f => !f.endsWith('/') && IMAGE_EXTS.has(f.split('.').pop().toLowerCase()));
  const rootPdfs   = items.filter(f => !f.endsWith('/') && f.toLowerCase().endsWith('.pdf'));
  const subdirs    = items.filter(f => f.endsWith('/'));

  let hasImage = rootImages.length > 0;
  let hasFicha = rootPdfs.length > 0;

  if (!hasImage || !hasFicha) {
    const upper  = f => f.toUpperCase().replace(/\/$/, '');
    const fotos  = subdirs.filter(f => upper(f).startsWith('FOTO'));
    const fichas = subdirs.filter(f => upper(f).startsWith('FICHA') || upper(f).startsWith('TECNICA'));
    const others = subdirs.filter(f => !upper(f).startsWith('FOTO') && !upper(f).startsWith('FICHA') && !upper(f).startsWith('TECNICA'));

    for (const dirEntry of [...fotos, ...fichas, ...others]) {
      if (hasImage && hasFicha) break;
      const dn  = dirEntry.replace(/\/$/, '');
      const sub = await listDir(enc + '/' + encodeURIComponent(dn) + '/');
      if (!sub) continue;
      if (!hasImage && sub.some(f => !f.endsWith('/') && IMAGE_EXTS.has(f.split('.').pop().toLowerCase()))) hasImage = true;
      if (!hasFicha && sub.some(f => !f.endsWith('/') && f.toLowerCase().endsWith('.pdf')))                 hasFicha = true;
    }
  }

  return { exists: true, hasImage, hasFicha, subdirs: subdirs.map(s => s.replace(/\/$/, '')) };
}

// ─────────────────────────────────
// CONCURRENCY POOL
// ─────────────────────────────────
async function runPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

// ─────────────────────────────────
// API HEALTH + DIAGNOSTICS
// ─────────────────────────────────
async function apiHealthCheck() {
  process.stdout.write('► API login (api.mari-pepa.com, DIEGO/9322)... ');
  try {
    const res = await httpPost(API_BASE + '/api/auth/login', JSON.stringify({ username: VENDOR, password: PIN }));
    if (!res.body || !res.body.token) {
      console.log('WARN — ' + JSON.stringify(res.body));
      return;
    }
    console.log('OK — ' + (res.body.name || '?') + ' (' + (res.body.role || '?') + ')');
    const tok  = res.body.token;
    const diag = await httpGet(API_BASE + '/api/products/diagnostico', { Authorization: 'Bearer ' + tok });
    if (diag.status === 200) {
      const d = JSON.parse(diag.body);
      console.log('   Server mode    : ' + d.accessMode);
      console.log('   Server filePath: ' + (d.filePath || '(none — HTTP mode)'));
      console.log('   Server httpUrl : ' + d.httpUrl);
      console.log('   Server cache   : ' + d.cacheSize + ' entries');
      if (d.samples) {
        console.log('   Sample probes from server:');
        d.samples.forEach(s => {
          const img = s.imageFound ? 'img✓' : 'img✗';
          const fic = s.fichaFound ? 'ficha✓' : 'ficha✗';
          const fld = s.folderExists ? (s.folderContents || []).length + ' items' : 'NO FOLDER';
          console.log('     [' + s.code + '] ' + img + ' ' + fic + ' folder:' + fld);
        });
      }
    } else {
      console.log('   Diagnostics HTTP ' + diag.status);
    }
  } catch (e) {
    console.log('WARN — ' + e.message);
  }
  console.log();
}

// ─────────────────────────────────
// MAIN
// ─────────────────────────────────
async function main() {
  if (!OUTPUT_JSON) {
    console.log('====================================================');
    console.log(' GMP Product Assets Scanner v2');
    console.log(' Images: ' + IMAGES_BASE_URL);
    console.log('====================================================\n');
  }

  // 1. DB2
  process.stdout.write('► DB2: loading active products... ');
  const cn   = await odbc.connect(DB_DSN);
  const rows = await cn.query(
    "SELECT TRIM(CODIGOARTICULO) AS CODE FROM DSEDAC.ART WHERE ANOBAJA = 0 OR ANOBAJA IS NULL ORDER BY CODIGOARTICULO"
  );
  await cn.close();
  const codes = rows.map(r => (r.CODE || '').trim()).filter(Boolean);
  console.log(codes.length + ' active products\n');

  // 2. Probe HTTP — test with known product folder (root listing may be disabled)
  process.stdout.write('► HTTP image server probe (testing with code 1384)... ');
  const probe1384 = await listDir('1384/');
  if (!probe1384) {
    // Try an alternate path format
    const alt = await listDir(encodeURIComponent('1384') + '/');
    if (!alt) {
      console.log('FAIL\n  Cannot reach: ' + IMAGES_BASE_URL);
      console.log('  Make sure 192.168.1.191 is on the same network and Apache is running.');
      process.exit(1);
    }
  }
  const sampleContents = probe1384 || [];
  console.log('OK — folder 1384 has ' + sampleContents.length + ' items: [' + sampleContents.slice(0,5).join(', ') + ']\n');
  const sampleFolders = ['1384'];

  // 3. API health
  await apiHealthCheck();

  // 4. Detail-explore sample products
  const toExplore = [...new Set([...sampleFolders.slice(0,3), '1384','1965','1415','1353','1866','2450'])];
  console.log('► Detail exploration of sample products:');
  for (const code of toExplore) {
    const r   = await checkProduct(code);
    const raw = r.exists ? (await listDir(encodeURIComponent(code) + '/') || []).slice(0,8).join(', ') : '';
    if (!r.exists) {
      console.log('   [' + code + '] NO FOLDER');
    } else {
      console.log('   [' + code + '] img=' + (r.hasImage?'Y':'N') + ' ficha=' + (r.hasFicha?'Y':'N') +
        ' subdirs=[' + (r.subdirs||[]).join(', ') + '] root=[' + raw + ']');
    }
  }
  console.log();

  // 5. Full scan
  if (!OUTPUT_JSON) process.stdout.write('► Scanning all ' + codes.length + ' products (concurrency=' + CONCURRENCY + ')...\n');
  const scan = { both:[], withImage:[], withFicha:[], neither:[], noFolder:[] };
  let done = 0;
  const t0 = Date.now();

  await runPool(codes, CONCURRENCY, async code => {
    const r = await checkProduct(code);
    if (!r.exists)                     scan.noFolder.push(code);
    else if (r.hasImage && r.hasFicha) scan.both.push(code);
    else if (r.hasImage)               scan.withImage.push(code);
    else if (r.hasFicha)               scan.withFicha.push(code);
    else                               scan.neither.push(code);
    done++;
    if (!OUTPUT_JSON && done % 50 === 0) {
      process.stdout.write('\r   ' + done + '/' + codes.length + ' (' + Math.round(done*100/codes.length) + '%) — ' + ((Date.now()-t0)/1000).toFixed(1) + 's  ');
    }
  });

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  if (!OUTPUT_JSON) console.log('\r   Done: ' + codes.length + '/' + codes.length + ' in ' + elapsed + 's              \n');

  // 6. Report
  const { both, withImage, withFicha, neither, noFolder } = scan;
  const total  = codes.length;
  const hasAny = both.length + withImage.length + withFicha.length;
  const pct    = n => Math.round(n*100/total) + '%';

  if (OUTPUT_JSON) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), total, both: both.length, withImage: withImage.length, withFicha: withFicha.length, neither: neither.length, noFolder: noFolder.length, hasAny, neitherCodes: neither, noFolderCodes: noFolder }, null, 2));
    return;
  }

  console.log('====================================================');
  console.log('                     RESULTADOS');
  console.log('====================================================');
  console.log('  Total productos activos:      ' + total);
  console.log('  Con imagen + ficha (ambos):   ' + both.length + ' (' + pct(both.length) + ')');
  console.log('  Solo imagen:                  ' + withImage.length + ' (' + pct(withImage.length) + ')');
  console.log('  Solo ficha:                   ' + withFicha.length + ' (' + pct(withFicha.length) + ')');
  console.log('  Carpeta existe, sin assets:   ' + neither.length + ' (' + pct(neither.length) + ')');
  console.log('  Sin carpeta en el servidor:   ' + noFolder.length + ' (' + pct(noFolder.length) + ')');
  console.log('----------------------------------------------------');
  console.log('  Con al menos un asset:        ' + hasAny + ' (' + pct(hasAny) + ')');
  console.log('====================================================\n');

  if (!MISSING_ONLY && neither.length > 0) {
    console.log('Carpeta existe pero SIN imagen ni ficha (' + neither.length + '):');
    neither.slice(0, 60).forEach(c => process.stdout.write('  ' + c + '\n'));
    if (neither.length > 60) console.log('  ... y ' + (neither.length-60) + ' mas');
    console.log();
  }

  if (MISSING_ONLY) {
    console.log('--- Sin imagen NI ficha (carpeta existe) ---');
    neither.forEach(c => console.log(c));
    console.log('\n--- Sin carpeta en el servidor ---');
    noFolder.forEach(c => console.log(c));
    return;
  }

  const outFile = path.join(__dirname, 'scan_results.json');
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp  : new Date().toISOString(),
    imagesUrl  : IMAGES_BASE_URL,
    elapsed_s  : parseFloat(elapsed),
    total, both: both.length, withImage: withImage.length,
    withFicha  : withFicha.length, neither: neither.length, noFolder: noFolder.length,
    hasAny,
    neitherCodes  : neither,
    noFolderCodes : noFolder.slice(0, 300),
  }, null, 2));
  console.log('Resultados guardados en: ' + outFile);
}

main().catch(e => { console.error('\nERROR: ' + (e.message||e)); process.exit(1); });
