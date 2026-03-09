// db.js: Capa de acceso DB2/ODBC para el módulo KPI — reutiliza el pool principal
'use strict';

const { query, queryWithParams, getPool } = require('../../config/db');
const logger = require('../../middleware/logger');

/**
 * Ejecuta una query SQL contra DB2 (esquema JAVIER).
 * Reutiliza el pool ODBC principal del backend con reintentos.
 *
 * IMPORTANTE: DB2 usa ? para placeholders (no $1 como PostgreSQL).
 * El resultado es un Array de filas (no {rows: [...]}).
 * kpiQuery wrappea para devolver {rows: [...]} compatible con las rutas.
 *
 * @param {string} sql - SQL con placeholders ?
 * @param {Array} [params] - Valores para los placeholders
 * @returns {Promise<{rows: Array}>} Formato {rows: [...]}
 */
async function kpiQuery(sql, params = []) {
  const start = Date.now();
  try {
    let result;
    if (params.length > 0) {
      result = await queryWithParams(sql, params, false, true);
    } else {
      result = await query(sql, false, true);
    }
    const duration = Date.now() - start;
    if (duration > 500) {
      logger.warn(`[kpi:db] Query lenta (${duration}ms): ${sql.substring(0, 80)}...`);
    }
    // DB2 ODBC devuelve Array directamente; wrap para compatibilidad con rutas
    return { rows: Array.isArray(result) ? result : [] };
  } catch (err) {
    logger.error(`[kpi:db] Query error: ${err.message} | SQL: ${sql.substring(0, 120)}`);
    throw err;
  }
}

async function kpiHealthCheck() {
  try {
    await query('SELECT 1 AS OK FROM SYSIBM.SYSDUMMY1', false);
    return { status: 'ok', engine: 'DB2/ODBC' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function kpiEndPool() {
  // No cerrar — el pool principal se encarga del ciclo de vida
}

/**
 * Verifica/crea las tablas KPI en DB2 si no existen.
 * Se llama desde initKpiModule() durante el arranque.
 */
async function initKpiTables() {
  const pool = getPool();
  if (!pool) {
    logger.warn('[kpi:db] Pool no disponible, omitiendo creación de tablas KPI');
    return;
  }

  const conn = await pool.connect();
  try {
    // Verificar si KPI_LOADS ya existe
    try {
      await conn.query('SELECT COUNT(*) AS CNT FROM JAVIER.KPI_LOADS');
      logger.info('[kpi:db] Tablas KPI ya existen');
      return;
    } catch (_) {
      // No existe, crearlas
    }

    logger.info('[kpi:db] Creando tablas KPI en DB2...');

    // KPI_LOADS
    try {
      await conn.query(`
        CREATE TABLE JAVIER.KPI_LOADS (
          ID              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          LOAD_ID         VARCHAR(32) NOT NULL,
          STATUS          VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
          FILES_PROCESSED VARCHAR(1024) DEFAULT '',
          TOTAL_ALERTS    INTEGER DEFAULT 0,
          ERRORS          VARCHAR(4096) DEFAULT '[]',
          STARTED_AT      TIMESTAMP DEFAULT CURRENT TIMESTAMP,
          COMPLETED_AT    TIMESTAMP,
          CHECKSUM        VARCHAR(128),
          CREATED_AT      TIMESTAMP DEFAULT CURRENT TIMESTAMP,
          CONSTRAINT UQ_KPI_LOADS_LOADID UNIQUE (LOAD_ID)
        )
      `);
      logger.info('[kpi:db] Tabla JAVIER.KPI_LOADS creada');
    } catch (e) {
      if (e.message && e.message.includes('SQL0601')) {
        logger.info('[kpi:db] JAVIER.KPI_LOADS ya existe');
      } else {
        throw e;
      }
    }

    // KPI_ALERTS
    try {
      await conn.query(`
        CREATE TABLE JAVIER.KPI_ALERTS (
          ID              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          LOAD_ID         VARCHAR(32) NOT NULL,
          CLIENT_CODE     VARCHAR(20) NOT NULL,
          ALERT_TYPE      VARCHAR(40) NOT NULL,
          SEVERITY        VARCHAR(10) NOT NULL DEFAULT 'warning',
          MESSAGE         VARCHAR(2048) NOT NULL,
          RAW_DATA        CLOB(64K) DEFAULT '{}',
          SOURCE_FILE     VARCHAR(100) NOT NULL,
          IS_ACTIVE       SMALLINT NOT NULL DEFAULT 1,
          EXPIRES_AT      TIMESTAMP,
          CREATED_AT      TIMESTAMP DEFAULT CURRENT TIMESTAMP
        )
      `);
      await safeCreateIndex(conn, 'JAVIER.IDX_KPI_AL_CLIENT', 'JAVIER.KPI_ALERTS (CLIENT_CODE)');
      await safeCreateIndex(conn, 'JAVIER.IDX_KPI_AL_LOAD', 'JAVIER.KPI_ALERTS (LOAD_ID)');
      await safeCreateIndex(conn, 'JAVIER.IDX_KPI_AL_TYPE', 'JAVIER.KPI_ALERTS (ALERT_TYPE)');
      await safeCreateIndex(conn, 'JAVIER.IDX_KPI_AL_ACTIVE', 'JAVIER.KPI_ALERTS (IS_ACTIVE, CLIENT_CODE)');
      await safeCreateIndex(conn, 'JAVIER.IDX_KPI_AL_MAIN', 'JAVIER.KPI_ALERTS (CLIENT_CODE, IS_ACTIVE, SEVERITY, CREATED_AT DESC)');
      logger.info('[kpi:db] Tabla JAVIER.KPI_ALERTS creada con índices');
    } catch (e) {
      if (e.message && e.message.includes('SQL0601')) {
        logger.info('[kpi:db] JAVIER.KPI_ALERTS ya existe');
      } else {
        throw e;
      }
    }

    // KPI_FILE_AUDIT
    try {
      await conn.query(`
        CREATE TABLE JAVIER.KPI_FILE_AUDIT (
          ID              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          LOAD_ID         VARCHAR(32) NOT NULL,
          FILENAME        VARCHAR(100) NOT NULL,
          FILE_SIZE       BIGINT DEFAULT 0,
          FILE_HASH       VARCHAR(128),
          ROWS_TOTAL      INTEGER DEFAULT 0,
          ROWS_PARSED     INTEGER DEFAULT 0,
          ROWS_SKIPPED    INTEGER DEFAULT 0,
          ALERTS_GENERATED INTEGER DEFAULT 0,
          PARSE_ERRORS    VARCHAR(4096) DEFAULT '[]',
          PROCESSED_AT    TIMESTAMP DEFAULT CURRENT TIMESTAMP
        )
      `);
      await safeCreateIndex(conn, 'JAVIER.IDX_KPI_FA_LOAD', 'JAVIER.KPI_FILE_AUDIT (LOAD_ID)');
      logger.info('[kpi:db] Tabla JAVIER.KPI_FILE_AUDIT creada');
    } catch (e) {
      if (e.message && e.message.includes('SQL0601')) {
        logger.info('[kpi:db] JAVIER.KPI_FILE_AUDIT ya existe');
      } else {
        throw e;
      }
    }

    logger.info('[kpi:db] Todas las tablas KPI creadas correctamente');
  } finally {
    try { await conn.close(); } catch (_) {}
  }
}

/**
 * Crea un índice ignorando el error si ya existe (SQL0601).
 */
async function safeCreateIndex(conn, indexName, definition) {
  try {
    await conn.query(`CREATE INDEX ${indexName} ON ${definition}`);
  } catch (e) {
    if (e.message && e.message.includes('SQL0601')) {
      // Index already exists — ignore
    } else {
      throw e;
    }
  }
}

module.exports = { kpiQuery, kpiHealthCheck, kpiEndPool, initKpiTables };
