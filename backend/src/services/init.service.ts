/**
 * SERVICIO DE INICIALIZACIÓN
 * Se encarga de asegurar que las tablas necesarias existan en la base de datos
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';

export async function initializeDatabaseSchema(): Promise<void> {
  try {
    logger.info('[INIT] Verificando esquema de base de datos...');

    // 1. Crear tabla JAVIER.COBROS si no existe
    await ensureCobrosTable();

    // 2. Otras tablas si fuera necesario...
    
    logger.info('[INIT] Esquema de base de datos verificado correctamente');
  } catch (error) {
    logger.error('[INIT] Error inicializando esquema:', error);
    // No bloqueamos el inicio del servidor, pero registramos el error
  }
}

async function ensureCobrosTable(): Promise<void> {
  try {
    // Verificar si existe la tabla
    const checkTable = await odbcPool.query<any[]>(
      "SELECT 1 FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'COBROS'"
    );

    if (checkTable.length === 0) {
      logger.info('[INIT] Creando tabla JAVIER.COBROS...');
      await odbcPool.query(`
        CREATE TABLE JAVIER.COBROS (
          ID VARCHAR(36) PRIMARY KEY,
          CODIGO_CLIENTE VARCHAR(20) NOT NULL,
          REFERENCIA VARCHAR(100),
          IMPORTE DECIMAL(15, 2) NOT NULL,
          FORMA_PAGO VARCHAR(10),
          TIPO_VENTA VARCHAR(5),
          TIPO_MODO VARCHAR(10),
          TIPO_USUARIO VARCHAR(20),
          CODIGO_USUARIO VARCHAR(20),
          OBSERVACIONES VARCHAR(255),
          FECHA TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logger.info('[INIT] Tabla JAVIER.COBROS creada exitosamente');
    } else {
      // Verificar si faltan columnas nuevas (migración simple)
      const cols = await odbcPool.query<any[]>(
        "SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'COBROS'"
      );
      const colNames = cols.map(c => String(c.COLUMN_NAME).toUpperCase());

      const requiredCols = [
        { name: 'TIPO_VENTA', type: 'VARCHAR(5)' },
        { name: 'TIPO_MODO', type: 'VARCHAR(10)' },
        { name: 'TIPO_USUARIO', type: 'VARCHAR(20)' },
        { name: 'CODIGO_USUARIO', type: 'VARCHAR(20)' }
      ];

      for (const col of requiredCols) {
        if (!colNames.includes(col.name)) {
          logger.info(`[INIT] Agregando columna ${col.name} a JAVIER.COBROS...`);
          await odbcPool.query(`ALTER TABLE JAVIER.COBROS ADD COLUMN ${col.name} ${col.type}`);
        }
      }
    }
  } catch (error: any) {
    logger.error('[INIT] Error en ensureCobrosTable:', error.message);
  }
}
