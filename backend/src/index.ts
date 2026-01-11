/**
 * GMP APP UNIFIED - SERVIDOR PRINCIPAL
 * Backend unificado para la aplicación de movilidad
 * 
 * Stack: Node.js + Express + TypeScript + IBM i (ODBC)
 */

import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import { config } from './config/env';
import { initDatabase, closeDatabase } from './config/database';
import { logger, morganStream } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { securityMiddleware } from './middleware/security.middleware';

// Rutas
import authRoutes from './routes/auth.routes';
import productRoutes from './routes/products.routes';
import clienteRoutes from './routes/clientes.routes';
import cobrosRoutes from './routes/cobros.routes';
import promocionesRoutes from './routes/promociones.routes';
import ventasRoutes from './routes/ventas.routes';
import ruteroRoutes from './routes/rutero.routes';
import pedidosRoutes from './routes/pedidos.routes';
import dashboardRoutes from './routes/dashboard.routes';
import entregasRoutes from './routes/entregas.routes';

// Cron Jobs
import { iniciarJobsCobros } from './cron/transferencias.job';


// ============================================
// CONFIGURACIÓN DE LA APLICACIÓN
// ============================================

const app: Application = express();

// Configurar trust proxy para proxies reversos
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE GLOBAL
// ============================================

// Seguridad HTTP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS
const corsOptions: cors.CorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = config.cors.origins;

    // Permitir requests sin origin (mobile apps, Postman, etc)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client-Version'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 86400, // 24 horas
};

app.use(cors(corsOptions));

// Compresión de respuestas
app.use(compression({
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
}));

// Parseo de JSON y URL-encoded
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging HTTP
if (config.env !== 'test') {
  app.use(morgan('combined', { stream: morganStream }));
}

// Middleware de seguridad personalizado
app.use(securityMiddleware);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.env,
    version: process.env.npm_package_version || '1.0.0',
  });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// RUTAS DE LA API
// ============================================

const API_PREFIX = '/api';

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/productos`, productRoutes);
app.use(`${API_PREFIX}/clientes`, clienteRoutes);
app.use(`${API_PREFIX}/cobros`, cobrosRoutes);
app.use(`${API_PREFIX}/promociones`, promocionesRoutes);
app.use(`${API_PREFIX}/ventas`, ventasRoutes);
app.use(`${API_PREFIX}/rutero`, ruteroRoutes);
app.use(`${API_PREFIX}/pedidos`, pedidosRoutes);
app.use(`${API_PREFIX}/dashboard`, dashboardRoutes);
app.use(`${API_PREFIX}/entregas`, entregasRoutes);


// ============================================
// MANEJO DE ERRORES
// ============================================

// 404 - Ruta no encontrada
app.use(notFoundHandler);

// Error handler global
app.use(errorHandler);

// ============================================
// INICIO DEL SERVIDOR
// ============================================

async function startServer(): Promise<void> {
  try {
    // Inicializar conexión a base de datos
    logger.info('Inicializando conexión a base de datos...');
    await initDatabase();
    logger.info('Base de datos conectada correctamente');

    // Iniciar jobs cron de cobros
    iniciarJobsCobros();
    logger.info('Jobs cron de cobros iniciados');


    // Iniciar servidor HTTP
    const server = app.listen(config.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════════════════╗
║                  GMP APP UNIFIED - BACKEND                    ║
╠══════════════════════════════════════════════════════════════╣
║  Servidor iniciado correctamente                              ║
║  Puerto: ${String(config.port).padEnd(50)}║
║  Entorno: ${config.env.padEnd(49)}║
║  API Base: ${`http://localhost:${config.port}${API_PREFIX}`.padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} recibido. Cerrando servidor...`);

      server.close(async () => {
        logger.info('Servidor HTTP cerrado');

        try {
          await closeDatabase();
          logger.info('Conexiones a BD cerradas');
          process.exit(0);
        } catch (err) {
          logger.error('Error cerrando conexiones:', err);
          process.exit(1);
        }
      });

      // Forzar cierre si tarda más de 10 segundos
      setTimeout(() => {
        logger.error('Cierre forzado por timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Manejo de errores no capturados
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      logger.error('Unhandled Rejection:', { reason, promise });
    });

  } catch (error) {
    logger.error('Error iniciando servidor:', error);
    process.exit(1);
  }
}

// Iniciar servidor
startServer();

export default app;
