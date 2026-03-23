/**
 * PRODUCT IMAGES & DATASHEETS ROUTES
 * ====================================
 * Serves product images and technical datasheets (fichas técnicas).
 * 
 * Supports TWO access modes (auto-detected at startup):
 *   1. FILE mode: Direct file access (Windows UNC or local mount)
 *   2. HTTP mode: Proxy via Apache/XAMPP on the image server
 * 
 * Structure: {basePath}/{productCode}/{productCode}.png         (image)
 *            {basePath}/{productCode}/FICHA TECNICA/{productCode}.pdf (datasheet)
 * 
 * Environment variables:
 *   PRODUCT_IMAGES_PATH  — Local/UNC file path (if mounted)
 *   PRODUCT_IMAGES_URL   — HTTP base URL (e.g. http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo)
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

// File-based access (Windows UNC or local mount point)
const IMAGES_FILE_PATH = process.env.PRODUCT_IMAGES_PATH || null;

// HTTP-based access (Apache/XAMPP serves the images)
const IMAGES_HTTP_URL = process.env.PRODUCT_IMAGES_URL
  || 'http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo';

// Auto-detect mode
let accessMode = 'http'; // default to HTTP (works on Linux without mounts)
let IMAGES_BASE = null;

// Try file-based access first
if (IMAGES_FILE_PATH) {
  try {
    if (fs.existsSync(IMAGES_FILE_PATH)) {
      accessMode = 'file';
      IMAGES_BASE = IMAGES_FILE_PATH;
      const folders = fs.readdirSync(IMAGES_BASE).slice(0, 5);
      logger.info(`[products] ✅ FILE mode: "${IMAGES_BASE}" (sample: ${folders.join(', ')})`);
    } else {
      logger.warn(`[products] PRODUCT_IMAGES_PATH set but not accessible: "${IMAGES_FILE_PATH}"`);
    }
  } catch (err) {
    logger.warn(`[products] PRODUCT_IMAGES_PATH error: ${err.message}`);
  }
}

// Also try default UNC/local paths if no explicit path set
if (accessMode !== 'file') {
  const defaultPaths = [
    // Linux local XAMPP paths
    '/opt/lampp/htdocs/movilidad/ImagenesGestorDocumentalNuevo',
    '/var/www/html/movilidad/ImagenesGestorDocumentalNuevo',
    // Windows UNC path
    '\\\\192.168.1.191\\acisa\\xampp\\htdocs\\movilidad\\ImagenesGestorDocumentalNuevo',
  ];
  for (const p of defaultPaths) {
    try {
      if (fs.existsSync(p)) {
        accessMode = 'file';
        IMAGES_BASE = p;
        const folders = fs.readdirSync(IMAGES_BASE).slice(0, 5);
        logger.info(`[products] ✅ FILE mode (auto): "${IMAGES_BASE}" (sample: ${folders.join(', ')})`);
        break;
      }
    } catch (e) { /* skip */ }
  }
}

if (accessMode === 'http') {
  logger.info(`[products] 🌐 HTTP proxy mode: "${IMAGES_HTTP_URL}"`);
}

// Sanitize product code: only allow alphanumeric, dash, underscore, dot
function sanitizeCode(code) {
  return (code || '').replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 50);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP PROXY HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Try to fetch a file via HTTP from the image server.
 * Returns { data: Buffer, contentType: string } or null if not found.
 */
async function fetchViaHttp(urlPath) {
  const url = `${IMAGES_HTTP_URL}/${urlPath}`;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      validateStatus: (status) => status < 500, // don't throw on 404
    });
    if (response.status === 200) {
      return {
        data: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'application/octet-stream',
      };
    }
    return null;
  } catch (err) {
    logger.warn(`[products] HTTP fetch error for ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Check if a remote file exists via HTTP HEAD request.
 */
async function existsViaHttp(urlPath) {
  const url = `${IMAGES_HTTP_URL}/${urlPath}`;
  try {
    const response = await axios.head(url, {
      timeout: 5000,
      validateStatus: (status) => status < 500,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE ACCESS HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function findLocalImage(code) {
  if (!IMAGES_BASE) return null;
  const extensions = ['png', 'jpg', 'jpeg', 'PNG', 'JPG', 'JPEG'];
  for (const ext of extensions) {
    const candidate = path.join(IMAGES_BASE, code, `${code}.${ext}`);
    if (fs.existsSync(candidate)) {
      // Security: verify resolved path is within IMAGES_BASE
      const resolved = path.resolve(candidate);
      const resolvedBase = path.resolve(IMAGES_BASE);
      if (resolved.startsWith(resolvedBase)) return resolved;
    }
  }
  return null;
}

function findLocalFicha(code) {
  if (!IMAGES_BASE) return null;
  const fichaPath = path.join(IMAGES_BASE, code, 'FICHA TECNICA', `${code}.pdf`);
  if (fs.existsSync(fichaPath)) {
    const resolved = path.resolve(fichaPath);
    const resolvedBase = path.resolve(IMAGES_BASE);
    if (resolved.startsWith(resolvedBase)) return resolved;
  }
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
    fileAccessible: false,
    httpAccessible: false,
    samples: [],
  };

  // Test file access
  if (IMAGES_BASE) {
    try {
      result.fileAccessible = fs.existsSync(IMAGES_BASE);
      if (result.fileAccessible) {
        const items = fs.readdirSync(IMAGES_BASE).slice(0, 10);
        result.samples = items.map(folder => {
          const code = folder;
          const imgPath = path.join(IMAGES_BASE, code, `${code}.png`);
          const fichaPath = path.join(IMAGES_BASE, code, 'FICHA TECNICA', `${code}.pdf`);
          return {
            code,
            hasImage: fs.existsSync(imgPath),
            hasFicha: fs.existsSync(fichaPath),
          };
        });
      }
    } catch (e) {
      result.fileError = e.message;
    }
  }

  // Test HTTP access
  try {
    const httpResult = await axios.head(IMAGES_HTTP_URL + '/', {
      timeout: 5000,
      validateStatus: () => true,
    });
    result.httpAccessible = httpResult.status < 500;
    result.httpStatus = httpResult.status;
  } catch (e) {
    result.httpError = e.message;
  }

  // If HTTP works, try to list a sample image
  if (result.httpAccessible && result.samples.length === 0) {
    // Try known codes from request
    const testCodes = ['1866', '1127', '1801'];
    for (const code of testCodes) {
      const extensions = ['png', 'jpg', 'jpeg'];
      let found = false;
      for (const ext of extensions) {
        const exists = await existsViaHttp(`${code}/${code}.${ext}`);
        if (exists) {
          result.samples.push({ code, hasImage: true, imageFormat: ext });
          found = true;
          break;
        }
      }
      if (!found) {
        result.samples.push({ code, hasImage: false });
      }
    }
  }

  res.json(result);
});

// =============================================================================
// GET /api/products/:code/exists — Check availability
// =============================================================================
router.get('/:code/exists', async (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'Invalid product code' });

  if (accessMode === 'file') {
    const imgPath = path.join(IMAGES_BASE, code, `${code}.png`);
    const fichaPath = path.join(IMAGES_BASE, code, 'FICHA TECNICA', `${code}.pdf`);
    return res.json({
      productCode: code,
      hasImage: fs.existsSync(imgPath),
      hasFicha: fs.existsSync(fichaPath),
    });
  }

  // HTTP mode: check via HEAD requests
  const extensions = ['png', 'jpg', 'jpeg'];
  let hasImage = false;
  for (const ext of extensions) {
    if (await existsViaHttp(`${code}/${code}.${ext}`)) {
      hasImage = true;
      break;
    }
  }
  const hasFicha = await existsViaHttp(`${code}/FICHA%20TECNICA/${code}.pdf`);
  
  res.json({ productCode: code, hasImage, hasFicha });
});

// =============================================================================
// GET /api/products/:code/image — Serve product image
// =============================================================================
router.get('/:code/image', async (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'Invalid product code' });

  // --- Try file access first ---
  if (accessMode === 'file' || IMAGES_BASE) {
    const localPath = findLocalImage(code);
    if (localPath) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(localPath);
    }
  }

  // --- Fall back to HTTP proxy ---
  const extensions = ['png', 'jpg', 'jpeg', 'PNG', 'JPG', 'JPEG'];
  for (const ext of extensions) {
    const result = await fetchViaHttp(`${code}/${code}.${ext}`);
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

  // --- Try file access first ---
  if (accessMode === 'file' || IMAGES_BASE) {
    const localPath = findLocalFicha(code);
    if (localPath) {
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Content-Disposition', `inline; filename="${code}_ficha_tecnica.pdf"`);
      return res.sendFile(localPath);
    }
  }

  // --- Fall back to HTTP proxy ---
  // "FICHA TECNICA" has a space — URL-encode it
  const result = await fetchViaHttp(`${code}/FICHA%20TECNICA/${code}.pdf`);
  if (result) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${code}_ficha_tecnica.pdf"`);
    return res.send(result.data);
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

  if (accessMode === 'file') {
    // Fast local check
    for (const rawCode of limitedCodes) {
      const code = sanitizeCode(rawCode);
      if (!code) continue;
      const imgPath = path.join(IMAGES_BASE, code, `${code}.png`);
      const fichaPath = path.join(IMAGES_BASE, code, 'FICHA TECNICA', `${code}.pdf`);
      results[code] = {
        hasImage: fs.existsSync(imgPath),
        hasFicha: fs.existsSync(fichaPath),
      };
    }
  } else {
    // HTTP mode: parallel HEAD checks (limited concurrency)
    const BATCH_SIZE = 10;
    for (let i = 0; i < limitedCodes.length; i += BATCH_SIZE) {
      const batch = limitedCodes.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (rawCode) => {
        const code = sanitizeCode(rawCode);
        if (!code) return;
        const extensions = ['png', 'jpg', 'jpeg'];
        let hasImage = false;
        for (const ext of extensions) {
          if (await existsViaHttp(`${code}/${code}.${ext}`)) {
            hasImage = true;
            break;
          }
        }
        const hasFicha = await existsViaHttp(`${code}/FICHA%20TECNICA/${code}.pdf`);
        results[code] = { hasImage, hasFicha };
      }));
    }
  }

  res.set('Cache-Control', 'public, max-age=3600');
  res.json(results);
});

module.exports = router;
