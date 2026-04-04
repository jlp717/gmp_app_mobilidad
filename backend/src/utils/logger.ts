/**
 * Winston Logger - Production Grade v4.0.0
 * 
 * @agent Observability - Structured logging, file rotation, console output
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Ensure logs directory exists
const logDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ============================================================
// FORMATTERS
// ============================================================

const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} ${level}: ${stack || message} ${metaStr}`.trim();
});

const fileFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  return JSON.stringify({
    timestamp,
    level,
    message: stack || message,
    ...meta,
  });
});

// ============================================================
// LOGGER INSTANCE
// ============================================================

const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: { service: 'gmp-backend' },
  transports: [
    // Console (colored, human-readable)
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        errors({ stack: true }),
        consoleFormat
      ),
    }),
    // File: all logs (JSON, rotatable)
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      maxSize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      format: combine(
        timestamp(),
        errors({ stack: true }),
        fileFormat
      ),
    }),
    // File: errors only
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxSize: 5 * 1024 * 1024,
      maxFiles: 3,
      format: combine(
        timestamp(),
        errors({ stack: true }),
        fileFormat
      ),
    }),
  ],
});

// ============================================================
// MORGAN STREAM (for HTTP logging)
// ============================================================

export const morganStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};
