/**
 * CONFIGURACIÓN DE ENTORNO
 * Carga y valida variables de entorno con valores por defecto seguros
 */

import dotenv from 'dotenv';
import path from 'path';

// Cargar .env según entorno
const envFile = process.env.NODE_ENV === 'production' 
  ? '.env.production' 
  : '.env';

dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// Función helper para obtener números
function getNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Función helper para obtener booleanos
function getBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

// Función helper para obtener arrays
function getArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// Función para construir connection string ODBC
function buildOdbcConnectionString(): string {
  const uid = process.env.ODBC_UID || '';
  const pwd = process.env.ODBC_PWD || '';
  // Usar DSN configurado en Windows ODBC con credenciales
  return `DSN=GMP;UID=${uid};PWD=${pwd};NAM=1;`;
}

export const config = {
  // Entorno
  env: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
  port: getNumber('PORT', 3001),
  host: process.env.HOST || '0.0.0.0',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',

  // Base de datos ODBC
  odbc: {
    // Construir connection string desde variables separadas
    connectionString: buildOdbcConnectionString(),
    uid: process.env.ODBC_UID || '',
    pwd: process.env.ODBC_PWD || '',
    pool: {
      min: getNumber('ODBC_POOL_MIN', 5),
      max: getNumber('ODBC_POOL_MAX', 50),
      idleTimeout: getNumber('ODBC_POOL_IDLE_TIMEOUT', 30000),
      acquireTimeout: getNumber('ODBC_POOL_ACQUIRE_TIMEOUT', 30000),
    },
  },

  // JWT - Autenticación
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-in-production-32chars',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production-32chars',
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },

  // Redis - Caching
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    ttl: {
      default: getNumber('REDIS_TTL_DEFAULT', 3600),
      products: getNumber('REDIS_TTL_PRODUCTS', 86400),
      promotions: getNumber('REDIS_TTL_PROMOTIONS', 1800),
    },
  },

  // CORS
  cors: {
    origins: getArray('CORS_ORIGINS', ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8081']),
  },

  // Seguridad
  security: {
    bcryptRounds: getNumber('BCRYPT_ROUNDS', 12),
    maxLoginAttempts: getNumber('MAX_LOGIN_ATTEMPTS', 5),
    lockTimeMinutes: getNumber('LOCK_TIME_MINUTES', 30),
    sessionTtl: getNumber('SESSION_TTL', 3600),
    maxSessionsPerUser: getNumber('MAX_SESSIONS_PER_USER', 5),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: getNumber('RATE_LIMIT_WINDOW_MS', 900000), // 15 minutos
    maxRequests: getNumber('RATE_LIMIT_MAX_REQUESTS', 100),
    loginLimit: getNumber('LOGIN_RATE_LIMIT', 5),
    loginWindow: getNumber('LOGIN_RATE_WINDOW', 900000),
  },

  // Email
  email: {
    host: process.env.SMTP_HOST || '',
    port: getNumber('SMTP_PORT', 587),
    secure: getBoolean('SMTP_SECURE', false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'noreply@example.com',
  },

  // Empresa
  empresa: {
    nombre: process.env.EMPRESA_NOMBRE || 'Granja Mari Pepa',
    cif: process.env.EMPRESA_CIF || '',
    telefono: process.env.EMPRESA_TELEFONO || '',
    email: process.env.EMPRESA_EMAIL || '',
  },

  // URLs
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
  },

  // Circuit Breaker
  circuitBreaker: {
    timeout: getNumber('CIRCUIT_BREAKER_TIMEOUT', 15000),
    errorThreshold: getNumber('CIRCUIT_BREAKER_ERROR_THRESHOLD', 50),
    resetTimeout: getNumber('CIRCUIT_BREAKER_RESET_TIMEOUT', 30000),
  },
};

// Validar configuración crítica en producción
export function validateConfig(): void {
  if (config.isProduction) {
    if (!config.odbc.connectionString) {
      throw new Error('ODBC_CONNECTION_STRING es requerido en producción');
    }
    if (config.jwt.accessSecret.includes('dev-')) {
      throw new Error('JWT_ACCESS_SECRET debe ser cambiado en producción');
    }
    if (config.jwt.refreshSecret.includes('dev-')) {
      throw new Error('JWT_REFRESH_SECRET debe ser cambiado en producción');
    }
  }
}

export default config;
