/**
 * Script para crear la tabla JAVIER.RUTERO_LOG
 * Esta tabla guarda el historial de todos los cambios realizados en el rutero
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');

const DB_DSN = process.env.DB_DSN || 'GMP';
const DB_UID = process.env.DB_UID;
const DB_PWD = process.env.DB_PWD;
const DB_CONFIG = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;`;

async function main() {
    let conn;
    try {
        console.log('🔌 Conectando a la base de datos...');
        conn = await odbc.connect(DB_CONFIG);
        console.log('✅ Conexión establecida');

        // Crear tabla de log si no existe
        const createTableSQL = `
            CREATE TABLE JAVIER.RUTERO_LOG (
                ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                FECHA_HORA TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                VENDEDOR VARCHAR(10) NOT NULL,
                TIPO_CAMBIO VARCHAR(50) NOT NULL,
                DIA_ORIGEN VARCHAR(20),
                DIA_DESTINO VARCHAR(20),
                CLIENTE VARCHAR(20) NOT NULL,
                NOMBRE_CLIENTE VARCHAR(100),
                POSICION_ANTERIOR INTEGER,
                POSICION_NUEVA INTEGER,
                DETALLES VARCHAR(500)
            )
        `;

        try {
            await conn.query(createTableSQL);
            console.log('✅ Tabla JAVIER.RUTERO_LOG creada exitosamente');
        } catch (err) {
            if (err.message.includes('already exists') || err.message.includes('SQL0601')) {
                console.log('ℹ️  La tabla JAVIER.RUTERO_LOG ya existe');
            } else {
                throw err;
            }
        }

        // Crear índices para búsquedas rápidas
        try {
            await conn.query('CREATE INDEX RUTERO_LOG_VEND_IDX ON JAVIER.RUTERO_LOG (VENDEDOR)');
            console.log('✅ Índice por vendedor creado');
        } catch (e) { /* ignore if exists */ }

        try {
            await conn.query('CREATE INDEX RUTERO_LOG_FECHA_IDX ON JAVIER.RUTERO_LOG (FECHA_HORA)');
            console.log('✅ Índice por fecha creado');
        } catch (e) { /* ignore if exists */ }

        console.log('\n🎉 Tabla de logs lista para usar');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        if (conn) await conn.close();
    }
}

main();
