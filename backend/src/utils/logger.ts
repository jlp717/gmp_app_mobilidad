/**
 * LOGGER - Sistema de Logging Empresarial
 * Configuración Winston para logging estructurado
 */

import winston from 'winston';
import { config } from '../config/env';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Formato personalizado para desarrollo
const devFormat = printf(({ level, message, timestamp: ts, stack, ...metadata }) => {
  let msg = `${ts} [${level}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  if (stack) {
    msg += `\n${stack}`;
  }
  
  return msg;
});

// Formato para producción (JSON estructurado)
const prodFormat = printf(({ level, message, timestamp: ts, ...metadata }) => {
  return JSON.stringify({
    timestamp: ts,
    level,
    message,
    ...metadata,
  });
});

// Crear logger
export const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  defaultMeta: { service: 'gmp-api' },
  transports: [
    // Consola
    new winston.transports.Console({
      format: combine(
        colorize(),
        config.isProduction ? prodFormat : devFormat
      ),
    }),
  ],
});

// En producción, agregar transporte a archivo
if (config.isProduction) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(timestamp(), prodFormat),
    })
  );
  
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(timestamp(), prodFormat),
    })
  );
}

// Stream para Morgan (HTTP logging)
export const morganStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

// Métodos helpers para contexto de request
export const createRequestLogger = (requestId: string) => ({
  info: (message: string, meta?: object) => logger.info(message, { requestId, ...meta }),
  warn: (message: string, meta?: object) => logger.warn(message, { requestId, ...meta }),
  error: (message: string, meta?: object) => logger.error(message, { requestId, ...meta }),
  debug: (message: string, meta?: object) => logger.debug(message, { requestId, ...meta }),
});

export default logger;
