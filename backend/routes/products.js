/**
 * PRODUCT IMAGES & DATASHEETS ROUTES
 * ====================================
 * Serves product images and technical datasheets (fichas técnicas).
 * 
 * Supports TWO access modes (auto-detected at startup):
 *   1. FILE mode: Direct file access (Windows UNC or local mount)
 *   2. HTTP mode: Proxy via Apache/XAMPP on the image server
 * 
 * IMPORTANT: File names in the image server are INCONSISTENT:
 *   - `1384/1384.png` (standard)
 *   - `1415/1415 1.png` (with space+suffix)
 *   - `1353/1353 - copia (2).jpg` (copy variant)
 *   - `2450/FOTO1__(1).jpg` (completely different name)
 *   - `1866/1866 - copia (3).jpg` (copy variant)
 *   
 * So we MUST scan the folder contents (via Apache directory listing or fs.readdir)
 * and find the first image/PDF file, regardless of its name.
 * 
 * Ficha técnica folders can be:
 *   - `FICHA TECNICA/`
 *   - `FICHA TECNICA - copia/`
 * 
 * Environment variables:
 *   PRODUCT_IMAGES_PATH  — Local/UNC file path (if mounted)
 *   PRODUCT_IMAGES_URL   — HTTP base URL
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const logger = require('../middleware/logger');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PATH CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const IMAGES_FILE_PATH = process.env.PRODUCT_IMAGES_PATH || null;
const IMAGES_HTTP_URL = process.env.PRODUCT_IMAGES_URL
  || 'http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo';

let accessMode = 'http';
let IMAGES_BASE = null;

// Try file-based access first
if (IMAGES_FILE_PATH) {
  try {
    if (fs.existsSync(IMAGES_FILE_PATH)) {
      accessMode = 'file';
      IMAGES_BASE = IMAGES_FILE_PATH;
      logger.info(`[products] ✅ FILE mode: "${IMAGES_BASE}"`);
    }
  } catch (err) {
    logger.warn(`[products] PRODUCT_IMAGES_PATH error: ${err.message}`);
  }
}

if (accessMode !== 'file') {
  const defaultPaths = [
    '/opt/lampp/htdocs/movilidad/ImagenesGestorDocumentalNuevo',
    '/var/www/html/movilidad/ImagenesGestorDocumentalNuevo',
    '\\\\192.168.1.191\\acisa\\xampp\\htdocs\\movilidad\\ImagenesGestorDocumentalNuevo',
  ];
  for (const p of defaultPaths) {
    try {
      if (fs.existsSync(p)) {
        accessMode = 'file';
        IMAGES_BASE = p;
        logger.info(`[products] ✅ FILE mode (auto): "${IMAGES_BASE}"`);
        break;
      }
    } catch (e) { /* skip */ }
  }
}

if (accessMode === 'http') {
  logger.info(`[products] 🌐 HTTP proxy mode: "${IMAGES_HTTP_URL}"`);
}

function sanitizeCode(code) {
  return (code || '').replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 50);
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
const PDF_EXTENSION = 'pdf';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IN-MEMORY CACHE (avoids repeated directory listings)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return undefined; }
  return entry.value;
}
function setCache(key, value) {
  cache.set(key, { value, ts: Date.now() });
  // Prune old entries periodically
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL) cache.delete(k);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APACHE DIRECTORY LISTING PARSER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Fetch and parse Apache directory listing.
 * Returns array of filenames (with trailing / for subdirs).
 */
async function listHttpDirectory(urlPath) {
  const cacheKey = `dir:${urlPath}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${IMAGES_HTTP_URL}/${urlPath}`;
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      responseType: 'text',
      validateStatus: (s) => s < 500,
    });
    if (response.status !== 200) {
      setCache(cacheKey, null);
      return null;
    }
    const html = response.data;
    const links = [];
    const regex = /<a\s+href="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const href = match[1];
      if (href === '/' || href === '../' || href.startsWith('?') || href.startsWith('/')) continue;
      try {
        links.push(decodeURIComponent(href));
      } catch {
        links.push(href);
      }
    }
    setCache(cacheKey, links);
    return links;
  } catch (err) {
    logger.warn(`[products] Dir listing error for ${url}: ${err.code || err.message}`);
    setCache(cacheKey, null);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SMART FILE DISCOVERY (scans folders, handles inconsistent names)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Find the best image file for a product code.
 * Scans the folder and picks the first image file, preferring {code}.{ext} matches.
 */
async function findImageHttp(code) {
  const cacheKey = `img:${code}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const items = await listHttpDirectory(`${code}/`);
  if (!items) { setCache(cacheKey, null); return null; }

  // Filter to image files only
  const imageFiles = items.filter(f => {
    if (f.endsWith('/')) return false; // skip subdirectories
    const ext = f.split('.').pop().toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });

  if (imageFiles.length === 0) { setCache(cacheKey, null); return null; }

  // Prefer exact match: {code}.{ext}
  let best = imageFiles.find(f => {
    const name = f.split('.').slice(0, -1).join('.');
    return name === code;
  });

  // Then prefer files starting with the code
  if (!best) {
    best = imageFiles.find(f => f.startsWith(code));
  }

  // Otherwise take the first image file
  if (!best) {
    best = imageFiles[0];
  }

  const result = `${code}/${best}`;
  setCache(cacheKey, result);
  return result;
}

/**
 * Find the ficha técnica PDF for a product code.
 * Checks: FICHA TECNICA/, FICHA TECNICA - copia/, and root folder.
 */
async function findFichaHttp(code) {
  const cacheKey = `ficha:${code}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  // First, list the product folder to find ficha subdirs
  const items = await listHttpDirectory(`${code}/`);
  if (!items) { setCache(cacheKey, null); return null; }

  // Separate subdirectories and root-level PDFs
  const allDirs = items.filter(f => f.endsWith('/') && f !== '../');
  const rootPdfs = items.filter(f => !f.endsWith('/') && f.toLowerCase().endsWith('.pdf'));

  // Priority order for subdirectories:
  // 1. FICHA TECNICA (exact)
  // 2. FICHA TECNICA - copia (or similar)
  // 3. Any other subdirectory
  const fichaDirs = [];
  const otherDirs = [];
  for (const d of allDirs) {
    if (d.toUpperCase().startsWith('FICHA')) fichaDirs.push(d);
    else otherDirs.push(d);
  }
  fichaDirs.sort((a, b) => a.length - b.length); // shorter = more canonical
  const searchDirs = [...fichaDirs, ...otherDirs];

  // Search ALL subdirectories for any PDF
  for (const dir of searchDirs) {
    const dirName = dir.replace(/\/$/, '');
    const subItems = await listHttpDirectory(`${code}/${encodeURIComponent(dirName)}/`);
    if (!subItems) continue;

    const pdfs = subItems.filter(f => !f.endsWith('/') && f.toLowerCase().endsWith('.pdf'));
    if (pdfs.length > 0) {
      // Prefer PDF named after the code
      let best = pdfs.find(f => f.startsWith(code));
      if (!best) best = pdfs[0];
      const result = `${code}/${encodeURIComponent(dirName)}/${encodeURIComponent(best)}`;
      setCache(cacheKey, result);
      return result;
    }
  }

  // Fallback: ANY PDF in root folder
  if (rootPdfs.length > 0) {
    let best = rootPdfs.find(f => f.startsWith(code));
    if (!best) best = rootPdfs.find(f =>
      f.toLowerCase().includes('ficha') || f.toLowerCase().includes('tecnica')
    );
    if (!best) best = rootPdfs[0];
    const result = `${code}/${encodeURIComponent(best)}`;
    setCache(cacheKey, result);
    return result;
  }

  setCache(cacheKey, null);
  return null;
}

/**
 * Fetch a file by its discovered HTTP path.
 */
async function fetchFileHttp(relativePath) {
  const url = `${IMAGES_HTTP_URL}/${relativePath}`;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });
    if (response.status === 200) {
      return {
        data: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'application/octet-stream',
      };
    }
    return null;
  } catch (err) {
    logger.warn(`[products] HTTP fetch error: ${url}: ${err.code || err.message}`);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE ACCESS HELPERS (scan folder contents)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function findLocalImage(code) {
  if (!IMAGES_BASE) return null;
  const folder = path.join(IMAGES_BASE, code);
  if (!fs.existsSync(folder)) return null;

  try {
    const files = fs.readdirSync(folder);
    const images = files.filter(f => {
      const ext = f.split('.').pop().toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    });
    if (images.length === 0) return null;

    // Prefer exact match
    let best = images.find(f => f.split('.').slice(0, -1).join('.') === code);
    if (!best) best = images.find(f => f.startsWith(code));
    if (!best) best = images[0];

    const resolved = path.resolve(path.join(folder, best));
    const resolvedBase = path.resolve(IMAGES_BASE);
    return resolved.startsWith(resolvedBase) ? resolved : null;
  } catch { return null; }
}

function findLocalFicha(code) {
  if (!IMAGES_BASE) return null;
  const folder = path.join(IMAGES_BASE, code);
  if (!fs.existsSync(folder)) return null;

  try {
    const items = fs.readdirSync(folder);
    // Separate dirs into ficha-priority and others
    const fichaDirs = [];
    const otherDirs = [];
    for (const f of items) {
      const full = path.join(folder, f);
      try {
        if (!fs.statSync(full).isDirectory()) continue;
      } catch { continue; }
      if (f.toUpperCase().startsWith('FICHA')) fichaDirs.push(f);
      else otherDirs.push(f);
    }
    fichaDirs.sort((a, b) => a.length - b.length);
    const allDirs = [...fichaDirs, ...otherDirs];

    for (const dir of allDirs) {
      const subFiles = fs.readdirSync(path.join(folder, dir));
      const pdfs = subFiles.filter(f => f.toLowerCase().endsWith('.pdf'));
      if (pdfs.length > 0) {
        let best = pdfs.find(f => f.startsWith(code));
        if (!best) best = pdfs[0];
        const resolved = path.resolve(path.join(folder, dir, best));
        const resolvedBase = path.resolve(IMAGES_BASE);
        return resolved.startsWith(resolvedBase) ? resolved : null;
      }
    }

    // Fallback: root-level PDFs
    const rootPdfs = items.filter(f => {
      const full = path.join(folder, f);
      try { return !fs.statSync(full).isDirectory() && f.toLowerCase().endsWith('.pdf'); }
      catch { return false; }
    });
    if (rootPdfs.length > 0) {
      let best = rootPdfs.find(f => f.startsWith(code));
      if (!best) best = rootPdfs[0];
      const resolved = path.resolve(path.join(folder, best));
      const resolvedBase = path.resolve(IMAGES_BASE);
      return resolved.startsWith(resolvedBase) ? resolved : null;
    }
  } catch { /* ignore */ }
  return null;
}

// =============================================================================
// DIAGNOSTICS
// =============================================================================
router.get('/diagnostico', async (req, res) => {
  const result = {
    accessMode,
    filePath: IMAGES_BASE,
    httpUrl: IMAGES_HTTP_URL,
    platform: process.platform,
    cacheSize: cache.size,
    samples: [],
  };

  const testCodes = ['1384', '1965', '1415', '1353', '1866', '2450', '2413'];
  for (const code of testCodes) {
    const imgPath = await findImageHttp(code);
    const fichaPath = await findFichaHttp(code);
    const folder = await listHttpDirectory(`${code}/`);
    result.samples.push({
      code,
      folderExists: folder !== null,
      folderContents: folder || [],
      imageFound: imgPath || false,
      fichaFound: fichaPath || false,
    });
  }

  res.json(result);
});

// =============================================================================
// GET /api/products/:code/exists — Check availability
// =============================================================================
router.get('/:code/exists', async (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'Invalid product code' });

  let hasImage = false, hasFicha = false;

  if (accessMode === 'file') {
    hasImage = !!findLocalImage(code);
    hasFicha = !!findLocalFicha(code);
  } else {
    hasImage = !!(await findImageHttp(code));
    hasFicha = !!(await findFichaHttp(code));
  }

  res.json({ productCode: code, hasImage, hasFicha });
});

// =============================================================================
// GET /api/products/:code/image — Serve product image
// =============================================================================
router.get('/:code/image', async (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'Invalid product code' });

  // FILE mode
  if (accessMode === 'file' || IMAGES_BASE) {
    const localPath = findLocalImage(code);
    if (localPath) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(localPath);
    }
  }

  // HTTP mode — discover the actual image file
  const imagePath = await findImageHttp(code);
  if (imagePath) {
    const result = await fetchFileHttp(imagePath);
    if (result) {
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Type', result.contentType);
      return res.send(result.data);
    }
  }

  logger.warn(`[products] Image not found for ${code} (mode=${accessMode})`);
  return res.status(404).json({ error: 'Image not found', productCode: code });
});

// =============================================================================
// GET /api/products/:code/ficha — Serve technical datasheet PDF
// =============================================================================
router.get('/:code/ficha', async (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'Invalid product code' });

  // FILE mode
  if (accessMode === 'file' || IMAGES_BASE) {
    const localPath = findLocalFicha(code);
    if (localPath) {
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Disposition', `inline; filename="${code}_ficha_tecnica.pdf"`);
      return res.sendFile(localPath);
    }
  }

  // HTTP mode — discover the ficha PDF
  const fichaPath = await findFichaHttp(code);
  if (fichaPath) {
    const result = await fetchFileHttp(fichaPath);
    if (result) {
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${code}_ficha_tecnica.pdf"`);
      return res.send(result.data);
    }
  }

  logger.warn(`[products] Ficha not found for ${code} (mode=${accessMode})`);
  return res.status(404).json({ error: 'Datasheet not found', productCode: code });
});

// =============================================================================
// POST /api/products/batch-exists — Batch check for multiple product codes
// =============================================================================
router.post('/batch-exists', async (req, res) => {
  const { codes } = req.body;
  if (!Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: 'codes array required' });
  }

  const limitedCodes = codes.slice(0, 200);
  const results = {};

  // Process in batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < limitedCodes.length; i += BATCH_SIZE) {
    const batch = limitedCodes.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (rawCode) => {
      const code = sanitizeCode(rawCode);
      if (!code) return;
      if (accessMode === 'file') {
        results[code] = {
          hasImage: !!findLocalImage(code),
          hasFicha: !!findLocalFicha(code),
        };
      } else {
        results[code] = {
          hasImage: !!(await findImageHttp(code)),
          hasFicha: !!(await findFichaHttp(code)),
        };
      }
    }));
  }

  res.set('Cache-Control', 'public, max-age=3600');
  res.json(results);
});

module.exports = router;
