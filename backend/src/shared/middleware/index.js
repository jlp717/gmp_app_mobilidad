/**
 * Shared Middleware - Security & Validation
 * Mountable Express middleware for all routes
 */
const { validate, validateBody, validateQuery, Schemas } = require('../core/infrastructure/security/input-validator');
const { securePath, sanitizeFilename, validateUploadPath, SecurityError } = require('../core/infrastructure/security/path-sanitizer');
const { ResponseCache } = require('../core/infrastructure/cache/response-cache');

// Global response cache instance
const responseCache = new ResponseCache();

// Cache middleware factory
function cacheMiddleware(keyFn, ttl) {
  return async (req, res, next) => {
    const key = keyFn(req);
    const cached = await responseCache.get(key);
    if (cached) {
      return res.json(cached);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      responseCache.set(key, body, ttl);
      return originalJson(body);
    };
    next();
  };
}

// Error handler for security violations
function handleSecurityError(err, req, res, next) {
  if (err instanceof SecurityError) {
    return res.status(403).json({
      error: 'Security violation',
      code: 'SECURITY_ERROR',
      message: err.message
    });
  }
  next(err);
}

module.exports = {
  validate,
  validateBody,
  validateQuery,
  Schemas,
  securePath,
  sanitizeFilename,
  validateUploadPath,
  SecurityError,
  responseCache,
  cacheMiddleware,
  handleSecurityError
};
