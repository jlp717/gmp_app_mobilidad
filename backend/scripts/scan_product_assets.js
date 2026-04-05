#!/usr/bin/env node
/**
 * scan_product_assets.js
 * Scans the product images directory and DB2 to report which products have images, fichas, or neither.
 *
 * Usage: node backend/scripts/scan_product_assets.js [--json] [--missing-only]
 *
 * Options:
 *   --json          Output results as JSON
 *   --missing-only  Only list products with neither image nor ficha
 */
'use strict';

const path = require('path');
const fs   = require('fs');
const odbc = require('odbc');

const DSN          = process.env.DB_DSN || 'GMP';
const OUTPUT_JSON  = process.argv.includes('--json');
const MISSING_ONLY = process.argv.includes('--missing-only');

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);

// Must stay in sync with defaultPaths in backend/routes/products.js
const defaultPaths = [
  process.env.PRODUCT_IMAGES_PATH,
  '/opt/lampp/htdocs/movilidad/ImagenesGestorDocumentalNuevo',
  '/var/www/html/movilidad/ImagenesGestorDocumentalNuevo',
  '/opt/gmp-api/uploads/imagenes',
  '/opt/gmp-api/assets/imagenes',
  '/srv/www/movilidad/ImagenesGestorDocumentalNuevo',
  '/data/movilidad/ImagenesGestorDocumentalNuevo',
].filter(Boolean);

function findImagesBase() {
  for (const p of defaultPaths) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return null;
}

function hasImage(folder) {
  if (!fs.existsSync(folder)) return false;
  let files;
  try { files = fs.readdirSync(folder); } catch { return false; }

  // Root-level images
  if (files.some(f => IMAGE_EXTENSIONS.has(f.split('.').pop().toLowerCase()))) return true;

  // Any subdirectory
  for (const f of files) {
    try {
      if (fs.statSync(path.join(folder, f)).isDirectory()) {
        const sub = fs.readdirSync(path.join(folder, f));
        if (sub.some(sf => IMAGE_EXTENSIONS.has(sf.split('.').pop().toLowerCase()))) return true;
      }
    } catch { /* skip */ }
  }
  return false;
}

function hasFicha(folder) {
  if (!fs.existsSync(folder)) return false;
  let items;
  try { items = fs.readdirSync(folder); } catch { return false; }

  // Root-level PDFs
  for (const f of items) {
    try {
      const full = path.join(folder, f);
      if (!fs.statSync(full).isDirectory() && f.toLowerCase().endsWith('.pdf')) return true;
    } catch { /* skip */ }
  }

  // Subdirectory PDFs
  for (const f of items) {
    try {
      if (fs.statSync(path.join(folder, f)).isDirectory()) {
        const sub = fs.readdirSync(path.join(folder, f));
        if (sub.some(sf => sf.toLowerCase().endsWith('.pdf'))) return true;
      }
    } catch { /* skip */ }
  }
  return false;
}

function pct(n, total) {
  return total ? `${Math.round(n * 100 / total)}%` : '0%';
}

async function main() {
  if (!OUTPUT_JSON) {
    console.log('🔍 GMP Product Assets Scanner');
    console.log('================================\n');
  }

  const base = findImagesBase();
  if (!base) {
    console.error('❌ Could not find images directory. Set PRODUCT_IMAGES_PATH env var.');
    console.error('   Tried:');
    defaultPaths.forEach(p => console.error(`   - ${p}`));
    process.exit(1);
  }

  if (!OUTPUT_JSON) console.log(`📂 Images base: ${base}\n`);

  // Query all active product codes from DB2
  let productCodes = [];
  try {
    const cn = await odbc.connect(`DSN=${DSN}`);
    const rows = await cn.query(
      "SELECT TRIM(CODIGOARTICULO) AS CODE FROM DSEDAC.ART WHERE ANOBAJA = 0 OR ANOBAJA IS NULL ORDER BY CODIGOARTICULO"
    );
    await cn.close();
    productCodes = rows.map(r => (r.CODE || '').trim()).filter(Boolean);
    if (!OUTPUT_JSON) console.log(`📦 Active products from DB2: ${productCodes.length}\n`);
  } catch (err) {
    console.error(`❌ DB2 connection error: ${err.message}`);
    console.error('   Make sure DSN=GMP is configured and ODBC driver is available.');
    process.exit(1);
  }

  const results = {
    base,
    total: productCodes.length,
    withImage:  [],
    withFicha:  [],
    both:       [],
    neither:    [],
    noFolder:   [],
  };

  for (const code of productCodes) {
    const folder = path.join(base, code);
    if (!fs.existsSync(folder)) {
      results.noFolder.push(code);
      continue;
    }
    const img = hasImage(folder);
    const fic = hasFicha(folder);

    if (img && fic)   results.both.push(code);
    else if (img)     results.withImage.push(code);
    else if (fic)     results.withFicha.push(code);
    else              results.neither.push(code);
  }

  if (OUTPUT_JSON) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const { total, withImage, withFicha, both, neither, noFolder } = results;
  const withFolder = total - noFolder.length;
  const hasAny = withImage.length + withFicha.length + both.length;

  console.log('📊 SUMMARY');
  console.log('================================');
  console.log(`Total active products:        ${total}`);
  console.log(`Has image directory folder:   ${withFolder} (${pct(withFolder, total)})`);
  console.log(`  ✅ Image + Ficha:           ${both.length} (${pct(both.length, total)})`);
  console.log(`  🖼  Image only:             ${withImage.length} (${pct(withImage.length, total)})`);
  console.log(`  📄 Ficha only:              ${withFicha.length} (${pct(withFicha.length, total)})`);
  console.log(`  ❌ Folder exists, no assets:${neither.length} (${pct(neither.length, total)})`);
  console.log(`  🚫 No folder at all:        ${noFolder.length} (${pct(noFolder.length, total)})`);
  console.log(`\nHas at least one asset:       ${hasAny} (${pct(hasAny, total)})\n`);

  if (!MISSING_ONLY && neither.length > 0) {
    console.log('⚠️  Products WITH folder but NO assets (image or ficha):');
    neither.forEach(c => process.stdout.write(`  ${c}\n`));
    console.log();
  }

  if (!MISSING_ONLY && noFolder.length > 0 && noFolder.length <= 50) {
    console.log('🚫 Products with NO folder at all:');
    noFolder.forEach(c => process.stdout.write(`  ${c}\n`));
    console.log();
  } else if (!MISSING_ONLY && noFolder.length > 50) {
    console.log(`🚫 Products with NO folder: ${noFolder.length} (use --json to see full list)\n`);
  }

  if (MISSING_ONLY) {
    console.log('Products missing both image AND ficha:');
    [...neither, ...noFolder].forEach(c => console.log(c));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
