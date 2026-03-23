/**
 * PRODUCT IMAGES & DATASHEETS ROUTES
 * ====================================
 * Serves product images and technical datasheets (fichas técnicas)
 * from the shared network folder.
 * 
 * Base path (env): PRODUCT_IMAGES_PATH
 * Structure: {basePath}/{productCode}/{productCode}.png       (image)
 *            {basePath}/{productCode}/FICHA_TECNICA/{productCode}.pdf (datasheet)
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const logger = require('../middleware/logger');

// Configurable base path — fallback to default UNC path
const IMAGES_BASE = process.env.PRODUCT_IMAGES_PATH
  || '\\\\192.168.1.191\\acisa\\GestorDocumental\\Articulos_catalogo';

// Sanitize product code: only allow alphanumeric, dash, underscore, dot
function sanitizeCode(code) {
  return (code || '').replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 50);
}

// =============================================================================
// DIAGNOSTICS — Remove after verifying access in production
// =============================================================================
router.get('/diagnostico', async (req, res) => {
  try {
    const exists = fs.existsSync(IMAGES_BASE);
    if (!exists) {
      return res.json({
        status: 'error',
        basePath: IMAGES_BASE,
        message: 'Base path does not exist or is not accessible',
        hint: 'Check UNC path permissions for the Node.js service user'
      });
    }

    const items = fs.readdirSync(IMAGES_BASE).slice(0, 10);
    // For each item, check if it has an image and/or ficha
    const samples = items.map(folder => {
      const code = folder;
      const imgPath = path.join(IMAGES_BASE, code, `${code}.png`);
      const fichaPath = path.join(IMAGES_BASE, code, 'FICHA_TECNICA', `${code}.pdf`);
      return {
        code,
        hasImage: fs.existsSync(imgPath),
        hasFicha: fs.existsSync(fichaPath),
      };
    });

    res.json({
      status: 'ok',
      basePath: IMAGES_BASE,
      sampleFolders: samples,
      totalFolders: fs.readdirSync(IMAGES_BASE).length
    });
  } catch (err) {
    logger.error(`[products/diagnostico] ${err.message}`);
    res.status(500).json({
      status: 'error',
      basePath: IMAGES_BASE,
      message: err.message,
      code: err.code
    });
  }
});

// =============================================================================
// GET /api/products/:code/exists — Check availability without downloading
// =============================================================================
router.get('/:code/exists', (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'Invalid product code' });

  const imgPath = path.join(IMAGES_BASE, code, `${code}.png`);
  const fichaPath = path.join(IMAGES_BASE, code, 'FICHA_TECNICA', `${code}.pdf`);

  res.json({
    productCode: code,
    hasImage: fs.existsSync(imgPath),
    hasFicha: fs.existsSync(fichaPath),
  });
});

// =============================================================================
// GET /api/products/:code/image — Serve product image
// =============================================================================
router.get('/:code/image', (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'Invalid product code' });

  // Try common extensions
  const extensions = ['png', 'jpg', 'jpeg', 'PNG', 'JPG', 'JPEG'];
  let filePath = null;

  for (const ext of extensions) {
    const candidate = path.join(IMAGES_BASE, code, `${code}.${ext}`);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    return res.status(404).json({ error: 'Image not found', productCode: code });
  }

  // Security: verify resolved path is within IMAGES_BASE
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(IMAGES_BASE);
  if (!resolved.startsWith(resolvedBase)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Cache for 24h — product images rarely change
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(resolved);
});

// =============================================================================
// GET /api/products/:code/ficha — Serve technical datasheet PDF
// =============================================================================
router.get('/:code/ficha', (req, res) => {
  const code = sanitizeCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'Invalid product code' });

  const fichaPath = path.join(IMAGES_BASE, code, 'FICHA_TECNICA', `${code}.pdf`);

  if (!fs.existsSync(fichaPath)) {
    return res.status(404).json({ error: 'Datasheet not found', productCode: code });
  }

  // Security: verify resolved path is within IMAGES_BASE
  const resolved = path.resolve(fichaPath);
  const resolvedBase = path.resolve(IMAGES_BASE);
  if (!resolved.startsWith(resolvedBase)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.set('Cache-Control', 'public, max-age=86400');
  res.set('Content-Disposition', `inline; filename="${code}_ficha_tecnica.pdf"`);
  res.sendFile(resolved);
});

// =============================================================================
// POST /api/products/batch-exists — Batch check for multiple product codes
// More efficient than N individual /exists calls
// =============================================================================
router.post('/batch-exists', (req, res) => {
  const { codes } = req.body;
  if (!Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: 'codes array required' });
  }

  // Limit batch size
  const limitedCodes = codes.slice(0, 200);
  const results = {};

  for (const rawCode of limitedCodes) {
    const code = sanitizeCode(rawCode);
    if (!code) continue;

    const imgPath = path.join(IMAGES_BASE, code, `${code}.png`);
    const fichaPath = path.join(IMAGES_BASE, code, 'FICHA_TECNICA', `${code}.pdf`);

    results[code] = {
      hasImage: fs.existsSync(imgPath),
      hasFicha: fs.existsSync(fichaPath),
    };
  }

  // Cache batch results for 1h
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(results);
});

module.exports = router;
