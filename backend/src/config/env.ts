/**
 * Environment Configuration - Production Grade v4.0.0
 * 
 * @agent Security - Validated secrets, no fallbacks
 * @agent Architect - Single source of truth for all env vars
 */

import dotenv from 'dotenv';
import path from 'path';

// Load env file based on environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(__dirname, '../../', envFile) });

// ============================================================
// HELPERS
// ============================================================

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue!;
  const num = Number(value);
  if (isNaN(num)) throw new Error(`Invalid number for ${key}: ${value}`);
  return num;
}

function getBoolean(key: string, defaultValue = false): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function getArray(key: string, defaultValue: string[] = []): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// ============================================================
// DATABASE CONFIG
// ============================================================

export const database = {
  odbcDsn: getEnv('ODBC_DSN', ''),
  odbcUid: process.env.ODBC_UID || '',
  odbcPwd: process.env.ODBC_PWD || '',
  poolMin: getNumber('DB_POOL_MIN', 2),
  poolMax: getNumber('DB_POOL_MAX', 10),
  poolIncrement: getNumber('DB_POOL_INCREMENT', 2),
  poolTimeout: getNumber('DB_POOL_TIMEOUT', 30),
  keepAliveInterval: getNumber('DB_KEEP_ALIVE_INTERVAL', 120), // seconds
  maxRetries: getNumber('DB_MAX_RETRIES', 3),
  retryDelay: getNumber('DB_RETRY_DELAY', 1000), // ms
};

// ============================================================
// JWT / AUTH CONFIG
// ============================================================

export const auth = {
  accessTokenSecret: getEnv('JWT_SECRET'),
  refreshTokenSecret: getEnv('JWT_REFRESH_SECRET'),
  accessTokenExpiry: getEnv('JWT_ACCESS_EXPIRY', '1h'),
  refreshTokenExpiry: getEnv('JWT_REFRESH_EXPIRY', '7d'),
  bcryptRounds: getNumber('BCRYPT_ROUNDS', 12),
  maxSessionsPerUser: getNumber('MAX_SESSIONS_PER_USER', 5),
  lockoutThreshold: getNumber('LOCKOUT_THRESHOLD', 5),
  lockoutDuration: getNumber('LOCKOUT_DURATION', 15 * 60 * 1000), // 15 min
};

// ============================================================
// REDIS CONFIG
// ============================================================

export const redis = {
  url: getEnv('REDIS_URL', 'redis://localhost:6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  keyPrefix: getEnv('REDIS_KEY_PREFIX', 'gmp:'),
  ttl: {
    short: getNumber('REDIS_TTL_SHORT', 300),     // 5 min
    medium: getNumber('REDIS_TTL_MEDIUM', 1800),   // 30 min
    long: getNumber('REDIS_TTL_LONG', 86400),      // 24 h
    realtime: getNumber('REDIS_TTL_REALTIME', 60), // 1 min
    // Role-specific TTLs for dashboard cache
    jefeVentas: getNumber('REDIS_TTL_JEFE', 600),  // 10 min
    comercial: getNumber('REDIS_TTL_COMERCIAL', 1800), // 30 min
    repartidor: getNumber('REDIS_TTL_REPARTIDOR', 900), // 15 min
  },
  maxRetries: getNumber('REDIS_MAX_RETRIES', 3),
  retryDelay: getNumber('REDIS_RETRY_DELAY', 1000),
};

// ============================================================
// SERVER CONFIG
// ============================================================

export const server = {
  port: getNumber('PORT', 3334),
  host: getEnv('HOST', '0.0.0.0'),
  env: getEnv('NODE_ENV', 'development'),
  trustProxy: getBoolean('TRUST_PROXY', true),
};

// ============================================================
// CORS CONFIG
// ============================================================

export const cors = {
  origins: getArray('CORS_ORIGIN', ['*']),
};

// ============================================================
// RATE LIMITING
// ============================================================

export const rateLimit = {
  global: {
    windowMs: getNumber('RATE_LIMIT_GLOBAL_WINDOW', 15 * 60 * 1000), // 15 min
    maxRequests: getNumber('RATE_LIMIT_GLOBAL_MAX', 100),
  },
  login: {
    windowMs: getNumber('RATE_LIMIT_LOGIN_WINDOW', 15 * 60 * 1000),
    maxRequests: getNumber('RATE_LIMIT_LOGIN_MAX', 5),
  },
  cobros: {
    windowMs: getNumber('RATE_LIMIT_COBROS_WINDOW', 15 * 60 * 1000),
    maxRequests: getNumber('RATE_LIMIT_COBROS_MAX', 30),
  },
  pedidos: {
    windowMs: getNumber('RATE_LIMIT_PEDIDOS_WINDOW', 15 * 60 * 1000),
    maxRequests: getNumber('RATE_LIMIT_PEDIDOS_MAX', 50),
  },
};

// ============================================================
// LOGGING
// ============================================================

export const logging = {
  level: getEnv('LOG_LEVEL', 'info'),
  format: getEnv('LOG_FORMAT', 'combined'),
  file: getEnv('LOG_FILE', 'logs/app.log'),
};

// ============================================================
// EMAIL CONFIG
// ============================================================

export const email = {
  host: getEnv('SMTP_HOST', 'localhost'),
  port: getNumber('SMTP_PORT', 587),
  secure: getBoolean('SMTP_SECURE', false),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: getEnv('SMTP_FROM', 'noreply@gmpapp.com'),
};

// ============================================================
// APP CONFIG
// ============================================================

export const app = {
  companyName: getEnv('COMPANY_NAME', 'Granja Mari Pepa'),
  minYear: getNumber('MIN_YEAR', 2020),
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
};

// ============================================================
// EXPORTED CONFIG OBJECT
// ============================================================

export const config = {
  env: server.env,
  port: server.port,
  host: server.host,
  database,
  auth,
  redis,
  cors,
  rateLimit,
  logging,
  email,
  app,
};

// ============================================================
// CONFIG VALIDATION (production gate)
// ============================================================

export function validateConfig(): void {
  const errors: string[] = [];

  // JWT secrets are MANDATORY - no fallbacks
  if (!auth.accessTokenSecret || auth.accessTokenSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }
  if (!auth.refreshTokenSecret || auth.refreshTokenSecret.length < 32) {
    errors.push('JWT_REFRESH_SECRET must be at least 32 characters');
  }

  // DB connection
  if (!database.odbcDsn) {
    errors.push('ODBC_DSN is required');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
}
