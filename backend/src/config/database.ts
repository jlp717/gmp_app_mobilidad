/**
 * CONFIGURACIÓN POOL ODBC
 * Pool de conexiones a IBM i con manejo robusto de errores
 */

import odbc from 'odbc';
import { config } from './env';
import { logger } from '../utils/logger';

interface PoolConnection {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  close: () => Promise<void>;
}

class ODBCPool {
  private pool: odbc.Pool | null = null;
  private isInitialized = false;

  /**
   * Inicializa el pool de conexiones
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Pool ODBC ya inicializado');
      return;
    }

    try {
      const safeConnString = config.odbc.connectionString.replace(/PWD=[^;]+/, 'PWD=***');
      logger.info(`Inicializando pool ODBC: ${safeConnString}`);

      this.pool = await odbc.pool({
        connectionString: config.odbc.connectionString,
        initialSize: config.odbc.pool.min,
        maxSize: config.odbc.pool.max,
        connectionTimeout: config.odbc.pool.acquireTimeout,
        loginTimeout: 30,
      });

      // Probar conexión
      const testConn = await this.pool.connect();
      const result = await testConn.query('SELECT 1 FROM SYSIBM.SYSDUMMY1');
      await testConn.close();

      logger.info('✅ Pool ODBC inicializado correctamente', { testResult: result });
      this.isInitialized = true;
    } catch (error) {
      logger.error('❌ Error inicializando pool ODBC:', error);
      throw error;
    }
  }

  /**
   * Ensure a connection uses CCSID 1208 (UTF-8).
   * Mirrors the JS pool ensureUtf8() from config/db.js.
   */
  private async ensureUtf8(connection: PoolConnection): Promise<void> {
    try {
      await connection.query("CALL QSYS.QCMDEXC('CHGJOB CCSID(1208)', 0000000018.00000)");
      logger.debug('[DB-TS] Connection CCSID set to 1208 (UTF-8)');
    } catch {
      // Non-fatal: CCSID=1208 in connection string may already handle it
      logger.debug('[DB-TS] CHGJOB CCSID(1208) skipped (may already be set)');
    }
  }

  /**
   * Adquiere una conexión del pool
   */
  async acquire(): Promise<PoolConnection> {
    if (!this.pool) {
      throw new Error('Pool ODBC no inicializado. Llame a initialize() primero.');
    }

    try {
      const connection = await this.pool.connect();
      const conn = connection as unknown as PoolConnection;
      await this.ensureUtf8(conn);
      return conn;
    } catch (error) {
      logger.error('Error adquiriendo conexión ODBC:', error);
      throw error;
    }
  }

  /**
   * Libera una conexión al pool
   */
  async release(connection: PoolConnection): Promise<void> {
    try {
      await connection.close();
    } catch (error) {
      logger.error('Error liberando conexión ODBC:', error);
    }
  }

  /**
   * Ejecuta una query con conexión auto-gestionada
   */
  async query<T = unknown[]>(sql: string, params?: unknown[]): Promise<T> {
    const connection = await this.acquire();
    try {
      const result = await connection.query(sql, params);
      return result as T;
    } finally {
      await this.release(connection);
    }
  }

  /**
   * Cierra el pool de conexiones
   */
  async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
        this.pool = null;
        this.isInitialized = false;
        logger.info('Pool ODBC cerrado correctamente');
      } catch (error) {
        logger.error('Error cerrando pool ODBC:', error);
        throw error;
      }
    }
  }

  /**
   * Verifica el estado del pool
   */
  isHealthy(): boolean {
    return this.isInitialized && this.pool !== null;
  }
}

// Singleton
export const odbcPool = new ODBCPool();

// Funciones para inicializar y cerrar desde el servidor
export async function initDatabase(): Promise<void> {
  await odbcPool.initialize();
}

export async function closeDatabase(): Promise<void> {
  await odbcPool.close();
}

export default odbcPool;
