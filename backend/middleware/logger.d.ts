/**
 * Type declarations for middleware/logger.js
 */
import winston from 'winston';

declare const logger: winston.Logger;

export const secureLog: {
    debug: (message: string, meta?: any) => void;
    info: (message: string, meta?: any) => void;
    warn: (message: string, meta?: any) => void;
    error: (message: string, meta?: any) => void;
    http: (message: string, meta?: any) => void;
};

export const NODE_ENV: string;

export default logger;
