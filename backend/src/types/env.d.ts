/**
 * TIPOS DE ENTORNO - CONFIGURACIÓN
 * Definiciones TypeScript para variables de entorno
 */

export interface EnvConfig {
  // Entorno
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HOST: string;

  // Base de datos
  ODBC_CONNECTION_STRING: string;
  ODBC_POOL_MIN: number;
  ODBC_POOL_MAX: number;
  ODBC_POOL_IDLE_TIMEOUT: number;
  ODBC_POOL_ACQUIRE_TIMEOUT: number;

  // JWT
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES: string;
  JWT_REFRESH_EXPIRES: string;

  // Redis
  REDIS_URL: string;
  REDIS_PASSWORD?: string;
  REDIS_TTL_DEFAULT: number;
  REDIS_TTL_PRODUCTS: number;
  REDIS_TTL_PROMOTIONS: number;

  // CORS
  CORS_ORIGINS: string[];

  // Seguridad
  BCRYPT_ROUNDS: number;
  MAX_LOGIN_ATTEMPTS: number;
  LOCK_TIME_MINUTES: number;
  SESSION_TTL: number;
  MAX_SESSIONS_PER_USER: number;

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  LOGIN_RATE_LIMIT: number;
  LOGIN_RATE_WINDOW: number;

  // Email
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;

  // Empresa
  EMPRESA_NOMBRE: string;
  EMPRESA_CIF: string;
  EMPRESA_TELEFONO: string;
  EMPRESA_EMAIL: string;

  // URLs
  FRONTEND_URL: string;
  GOOGLE_MAPS_API_KEY: string;

  // Logging
  LOG_LEVEL: string;
  LOG_FORMAT: string;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Partial<Record<keyof EnvConfig, string>> {}
  }
}
