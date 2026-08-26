'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');

const router = express.Router();
const isProduction = process.env.NODE_ENV === 'production';
const isPublic = process.env.DOCS_PUBLIC === 'true' && !isProduction;
const specPath = path.resolve(__dirname, '..', '..', 'docs', 'openapi', 'openapi.yaml');
const document = yaml.load(fs.readFileSync(specPath, 'utf8'));

function timingSafeTextEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const size = Math.max(actualBuffer.length, expectedBuffer.length, 1);
  const paddedActual = Buffer.alloc(size);
  const paddedExpected = Buffer.alloc(size);
  actualBuffer.copy(paddedActual);
  expectedBuffer.copy(paddedExpected);
  return crypto.timingSafeEqual(paddedActual, paddedExpected)
    && actualBuffer.length === expectedBuffer.length;
}

function basicAuth(req, res, next) {
  const expectedUser = process.env.SWAGGER_BASIC_USER;
  const expectedPass = process.env.SWAGGER_BASIC_PASS;
  if (!expectedUser || !expectedPass) {
    return res.status(503).json({
      success: false,
      code: 'SWAGGER_AUTH_NOT_CONFIGURED',
      error: 'API documentation unavailable',
    });
  }

  const match = /^Basic\s+(.+)$/i.exec(req.get('Authorization') || '');
  const decoded = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
  const separator = decoded.indexOf(':');
  const user = separator >= 0 ? decoded.slice(0, separator) : '';
  const pass = separator >= 0 ? decoded.slice(separator + 1) : '';
  const userValid = timingSafeTextEqual(user, expectedUser);
  const passValid = timingSafeTextEqual(pass, expectedPass);

  if (userValid && passValid) return next();
  res.set('WWW-Authenticate', 'Basic realm="GMP API Docs", charset="UTF-8"');
  return res.status(401).json({
    success: false,
    code: 'SWAGGER_AUTH_REQUIRED',
    error: 'Authentication required',
  });
}

const guards = isPublic ? [] : [basicAuth];

router.get('/docs.json', ...guards, (_req, res) => res.json(document));
router.use('/docs', ...guards, swaggerUi.serve, swaggerUi.setup(document, {
  customSiteTitle: 'GMP Movilidad API',
  swaggerOptions: { persistAuthorization: !isProduction },
}));

module.exports = router;
