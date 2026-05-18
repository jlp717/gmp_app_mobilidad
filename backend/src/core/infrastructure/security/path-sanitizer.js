/**
 * Path Sanitizer - Prevents directory traversal attacks
 * Used for file uploads, signature paths, and any user-controlled file paths
 */
const path = require('path');

class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
  }
}

function securePath(userPath, allowedPrefix) {
  const resolved = path.resolve(allowedPrefix, userPath);
  const allowedResolved = path.resolve(allowedPrefix);

  if (!resolved.startsWith(allowedResolved)) {
    throw new SecurityError('Path traversal detected');
  }

  return resolved;
}

function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new SecurityError('Invalid filename');
  }

  const sanitized = filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\.\./g, '')
    .trim();

  if (!sanitized || sanitized.length > 255) {
    throw new SecurityError('Invalid filename after sanitization');
  }

  return sanitized;
}

function validateUploadPath(uploadPath, allowedBase) {
  try {
    return securePath(uploadPath, allowedBase);
  } catch (error) {
    if (error instanceof SecurityError) {
      throw error;
    }
    throw new SecurityError(`Invalid upload path: ${error.message}`);
  }
}

module.exports = { securePath, sanitizeFilename, validateUploadPath, SecurityError };
