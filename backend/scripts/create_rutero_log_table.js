/**
 * Script para crear la tabla JAVIER.RUTERO_LOG
 * Esta tabla guarda el historial de todos los cambios realizados en el rutero
 * Compatible con IBM iSeries / AS400
 */

const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: envPath });
const odbc = require('odbc');

// Usar las mismas variables que usa el servidor principal (db.js)
const DB_UID = process.env.ODBC_UID || 'JAVIER';
const DB_PWD = process.env.ODBC_PWD || 'JAVIER';
const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_CONFIG = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;`;

console.log(`📋 Configuración: DSN=${DB_DSN}, UID=${DB_UID}`);

async function main() {
    let conn;
    try {
        console.log('🔌 Conectando a la base de datos...');
        conn = await odbc.connect(DB_CONFIG);
        console.log('✅ Conexión establecida');

        // Verificar si la tabla ya existe
        const checkTable = `
            SELECT COUNT(*) AS CNT 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'RUTERO_LOG'
        `;
        
        const result = await conn.query(checkTable);
        const tableExists = result[0]?.CNT > 0;
        
        if (tableExists) {
            console.log('ℹ️  La tabla JAVIER.RUTERO_LOG ya existe');
        } else {
            // Crear tabla de log - Sintaxis compatible con IBM iSeries
            const createTableSQL = `
                CREATE TABLE JAVIER.RUTERO_LOG (
                    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1),
                    FECHA_HORA TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    VENDEDOR VARCHAR(10) NOT NULL,
                    TIPO_CAMBIO VARCHAR(50) NOT NULL,
                    DIA_ORIGEN VARCHAR(20),
                    DIA_DESTINO VARCHAR(20),
                    CLIENTE VARCHAR(20) NOT NULL,
                    NOMBRE_CLIENTE VARCHAR(100),
                    POSICION_ANTERIOR INTEGER,
                    POSICION_NUEVA INTEGER,
                    DETALLES VARCHAR(500),
                    CONSTRAINT RUTERO_LOG_PK PRIMARY KEY (ID)
                )
            `;

            await conn.query(createTableSQL);
            console.log('✅ Tabla JAVIER.RUTERO_LOG creada exitosamente');
        }

        // Crear índices para búsquedas rápidas (ignorar errores si ya existen)
        try {
            await conn.query('CREATE INDEX JAVIER.RUTERO_LOG_VEND_IDX ON JAVIER.RUTERO_LOG (VENDEDOR)');
            console.log('✅ Índice por vendedor creado');
        } catch (e) { 
            if (!e.message.includes('already exists') && !e.message.includes('SQL0601')) {
                console.log('ℹ️  Índice por vendedor ya existe o no se pudo crear');
            }
        }

        try {
            await conn.query('CREATE INDEX JAVIER.RUTERO_LOG_FECHA_IDX ON JAVIER.RUTERO_LOG (FECHA_HORA)');
            console.log('✅ Índice por fecha creado');
        } catch (e) { 
            if (!e.message.includes('already exists') && !e.message.includes('SQL0601')) {
                console.log('ℹ️  Índice por fecha ya existe o no se pudo crear');
            }
        }

        console.log('\n🎉 Tabla de logs lista para usar');

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.odbcErrors) {
            error.odbcErrors.forEach(e => console.error('   ODBC:', e.message));
        }
        process.exit(1);
    } finally {
        if (conn) await conn.close();
    }
}

main();
