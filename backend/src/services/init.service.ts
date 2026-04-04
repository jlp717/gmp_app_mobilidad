/**
 * Database Schema Initialization Service
 * Creates/verifies application-owned tables (JAVIER schema)
 * 
 * NOTE: DSED and DSEDAC are ERP tables — READ ONLY, never created by us.
 * 
 * @agent Architect - Idempotent schema setup
 */

import { Db2ConnectionPool } from '../core/infrastructure/database/db2-connection-pool';
import { logger } from '../utils/logger';

export async function initDatabaseSchema(pool: Db2ConnectionPool): Promise<void> {
  const tables = [
    {
      name: 'JAVIER.APP_USUARIOS',
      // Stores bcrypt hashes for vendors (DSEDAC.VDPL1.CODIGOPIN is too small for bcrypt)
      sql: `
        CREATE TABLE JAVIER.APP_USUARIOS (
          USUARIO VARCHAR(50) NOT NULL PRIMARY KEY,
          PASSWORD_HASH VARCHAR(100),
          ACTIVO SMALLINT DEFAULT 1
        )
      `,
    },
    {
      name: 'JAVIER.APP_LOGIN_LOG',
      // Login audit log
      sql: `
        CREATE TABLE JAVIER.APP_LOGIN_LOG (
          USUARIO VARCHAR(50),
          EXITO SMALLINT,
          IP VARCHAR(45),
          FECHA TIMESTAMP DEFAULT CURRENT TIMESTAMP
        )
      `,
    },
    {
      name: 'JAVIER.DELIVERY_STATUS',
      // Delivery confirmation tracking
      sql: `
        CREATE TABLE JAVIER.DELIVERY_STATUS (
          ID VARCHAR(64) NOT NULL PRIMARY KEY,
          STATUS VARCHAR(20) DEFAULT 'PENDIENTE',
          OBSERVACIONES VARCHAR(512),
          FIRMA_PATH VARCHAR(255),
          LATITUD DECIMAL(10, 8),
          LONGITUD DECIMAL(11, 8),
          UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
          REPARTIDOR_ID VARCHAR(20)
        )
      `,
    },
    {
      name: 'JAVIER.CLIENT_NOTES',
      // Client observations/notes
      sql: `
        CREATE TABLE JAVIER.CLIENT_NOTES (
          CLIENT_CODE VARCHAR(50) NOT NULL PRIMARY KEY,
          OBSERVACIONES VARCHAR(1000),
          MODIFIED_BY VARCHAR(50),
          MODIFIED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP
        )
      `,
    },
    {
      name: 'JAVIER.PEDIDOS_CAB',
      // Order header
      sql: `
        CREATE TABLE JAVIER.PEDIDOS_CAB (
          ID VARCHAR(64) NOT NULL PRIMARY KEY,
          SUBEMPRESA VARCHAR(10),
          EJERCICIO INTEGER,
          NUMEROPEDIDO INTEGER,
          SERIEPEDIDO VARCHAR(10),
          TERMINAL VARCHAR(10),
          DIADOCUMENTO INTEGER,
          MESDOCUMENTO INTEGER,
          ANODOCUMENTO INTEGER,
          HORADOCUMENTO VARCHAR(10),
          CODIGOCLIENTE VARCHAR(50),
          NOMBRECLIENTE VARCHAR(100),
          CODIGOVENDEDOR VARCHAR(50),
          CODIGOFORMAPAGO VARCHAR(20),
          CODIGOTARIFA VARCHAR(20),
          CODIGOALMACEN VARCHAR(20),
          TIPOVENTA VARCHAR(10),
          ESTADO VARCHAR(20),
          IMPORTETOTAL DECIMAL(15,2),
          IMPORTEBASE DECIMAL(15,2),
          IMPORTEIVA DECIMAL(15,2),
          IMPORTECOSTO DECIMAL(15,2),
          IMPORTEMARGEN DECIMAL(15,2),
          OBSERVACIONES VARCHAR(500),
          ORIGEN VARCHAR(20),
          CREATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
          UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP
        )
      `,
    },
    {
      name: 'JAVIER.PEDIDOS_LIN',
      // Order lines
      sql: `
        CREATE TABLE JAVIER.PEDIDOS_LIN (
          ID VARCHAR(64) NOT NULL PRIMARY KEY,
          PEDIDO_ID VARCHAR(64),
          SECUENCIA INTEGER,
          CODIGOARTICULO VARCHAR(50),
          DESCRIPCION VARCHAR(200),
          CANTIDADENVASES DECIMAL(15,2),
          CANTIDADUNIDADES DECIMAL(15,2),
          UNIDADMEDIDA VARCHAR(10),
          UNIDADESCAJA INTEGER,
          PRECIOVENTA DECIMAL(15,4),
          PRECIOCOSTO DECIMAL(15,4),
          PRECIOTARIFA DECIMAL(15,4),
          PRECIOTARIFACLIENTE DECIMAL(15,4),
          PRECIOMINIMO DECIMAL(15,4),
          IMPORTEVENTA DECIMAL(15,2),
          IMPORTECOSTO DECIMAL(15,2),
          IMPORTEMARGEN DECIMAL(15,2),
          PORCENTAJEMARGEN DECIMAL(5,2),
          TIPOLINEA VARCHAR(10),
          TIPOVENTA VARCHAR(10),
          CLASELINEA VARCHAR(10),
          ORDEN INTEGER,
          CREATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP
        )
      `,
    },
    {
      name: 'JAVIER.PEDIDOS_SEQ',
      // Order number sequence
      sql: `
        CREATE TABLE JAVIER.PEDIDOS_SEQ (
          EJERCICIO INTEGER NOT NULL PRIMARY KEY,
          ULTIMO_NUMERO INTEGER DEFAULT 0
        )
      `,
    },
    {
      name: 'JAVIER.PEDIDOS_STOCK_RESERVE',
      // Stock reservations
      sql: `
        CREATE TABLE JAVIER.PEDIDOS_STOCK_RESERVE (
          ID VARCHAR(64) NOT NULL PRIMARY KEY,
          PEDIDO_ID VARCHAR(64),
          CODIGOARTICULO VARCHAR(50),
          CANTIDADENVASES DECIMAL(15,2),
          CANTIDADUNIDADES DECIMAL(15,2),
          CREATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP
        )
      `,
    },
  ];

  for (const table of tables) {
    try {
      await pool.query(`SELECT COUNT(*) AS CNT FROM ${table.name}`);
      logger.info(`  ✅ Table ${table.name} verified`);
    } catch {
      try {
        await pool.query(table.sql);
        logger.info(`  ✅ Table ${table.name} created`);
      } catch (createError: unknown) {
        const msg = (createError as Error).message || '';
        if (msg.includes('SQL0601') || msg.includes('already exists')) {
          logger.info(`  ✅ Table ${table.name} already exists`);
        } else {
          logger.warn(`  ⚠️ Could not create ${table.name}: ${msg}`);
        }
      }
    }
  }
}
