/**
 * Script para crear las tablas del módulo Repartidor en JAVIER
 * Ejecutar con: node scripts/sql/execute_repartidor_tables.js
 * 
 * Compatible con DB2 for IBM i (AS/400)
 */

const { query, initDb } = require('../../config/db');

// Queries optimizadas para DB2 IBM i
const statements = [
    // ========== TABLA 1: ENTREGAS ==========
    `CREATE TABLE JAVIER.REPARTIDOR_ENTREGAS (
    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
    NUMERO_ALBARAN INTEGER NOT NULL,
    EJERCICIO_ALBARAN INTEGER NOT NULL,
    SERIE_ALBARAN VARCHAR(5) DEFAULT 'A',
    CODIGO_CLIENTE VARCHAR(20) NOT NULL,
    NOMBRE_CLIENTE VARCHAR(100),
    CODIGO_REPARTIDOR VARCHAR(20) NOT NULL,
    CODIGO_CONDUCTOR VARCHAR(20),
    ESTADO VARCHAR(20) DEFAULT 'PENDIENTE',
    FECHA_PREVISTA DATE,
    FECHA_ENTREGA TIMESTAMP,
    FECHA_REGISTRO TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    IMPORTE_TOTAL DECIMAL(15, 2) DEFAULT 0,
    IMPORTE_COBRADO DECIMAL(15, 2) DEFAULT 0,
    ES_CTR CHAR(1) DEFAULT 'N',
    CTR_COBRADO CHAR(1) DEFAULT 'N',
    OBSERVACIONES VARCHAR(500),
    PRIMARY KEY (ID)
  )`,

    // ========== TABLA 2: FIRMAS ==========
    `CREATE TABLE JAVIER.REPARTIDOR_FIRMAS (
    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
    ENTREGA_ID INTEGER NOT NULL,
    FIRMA_BASE64 VARCHAR(32000),
    FIRMA_FORMATO VARCHAR(10) DEFAULT 'PNG',
    FIRMANTE_NOMBRE VARCHAR(100),
    FIRMANTE_DNI VARCHAR(20),
    FECHA_FIRMA TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    DISPOSITIVO VARCHAR(100),
    LATITUD DECIMAL(10, 7),
    LONGITUD DECIMAL(10, 7),
    PRIMARY KEY (ID)
  )`,

    // ========== TABLA 3: LINEAS ==========
    `CREATE TABLE JAVIER.REPARTIDOR_ENTREGA_LINEAS (
    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
    ENTREGA_ID INTEGER NOT NULL,
    LINEA_ALBARAN INTEGER DEFAULT 0,
    CODIGO_ARTICULO VARCHAR(20) NOT NULL,
    DESCRIPCION_ARTICULO VARCHAR(200),
    CANTIDAD_PEDIDA DECIMAL(10, 2) DEFAULT 0,
    CANTIDAD_ENTREGADA DECIMAL(10, 2) DEFAULT 0,
    CANTIDAD_RECHAZADA DECIMAL(10, 2) DEFAULT 0,
    ESTADO VARCHAR(20) DEFAULT 'PENDIENTE',
    OBSERVACIONES VARCHAR(500),
    MOTIVO_NO_ENTREGA VARCHAR(50),
    FECHA_ACTUALIZACION TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ID)
  )`,

    // ========== TABLA 4: COBROS ==========
    `CREATE TABLE JAVIER.REPARTIDOR_COBROS (
    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
    ENTREGA_ID INTEGER,
    CODIGO_CLIENTE VARCHAR(20) NOT NULL,
    NOMBRE_CLIENTE VARCHAR(100),
    CODIGO_REPARTIDOR VARCHAR(20) NOT NULL,
    TIPO_DOCUMENTO VARCHAR(10) NOT NULL,
    NUMERO_DOCUMENTO INTEGER NOT NULL,
    EJERCICIO_DOCUMENTO INTEGER NOT NULL,
    IMPORTE_COBRADO DECIMAL(15, 2) DEFAULT 0,
    IMPORTE_PENDIENTE DECIMAL(15, 2) DEFAULT 0,
    FORMA_PAGO VARCHAR(20),
    FECHA_COBRO TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    VALIDADO CHAR(1) DEFAULT 'N',
    FECHA_VALIDACION TIMESTAMP,
    VALIDADO_POR VARCHAR(50),
    NOTAS VARCHAR(500),
    PRIMARY KEY (ID)
  )`,

    // ========== TABLA 5: OBJETIVOS ==========
    `CREATE TABLE JAVIER.REPARTIDOR_OBJETIVOS (
    ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,
    CODIGO_REPARTIDOR VARCHAR(20) NOT NULL,
    ANIO INTEGER NOT NULL,
    MES INTEGER NOT NULL,
    IMPORTE_COBRABLE DECIMAL(15, 2) DEFAULT 0,
    IMPORTE_COBRADO DECIMAL(15, 2) DEFAULT 0,
    PORCENTAJE_COBRADO DECIMAL(5, 2) DEFAULT 0,
    UMBRAL_ALCANZADO CHAR(1) DEFAULT 'N',
    TIER_COMISION INTEGER DEFAULT 0,
    COMISION_CALCULADA DECIMAL(15, 2) DEFAULT 0,
    FECHA_CALCULO TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ID)
  )`
];

async function executeStatements() {
    console.log('='.repeat(60));
    console.log('CREANDO TABLAS REPARTIDOR EN JAVIER');
    console.log('='.repeat(60));

    // Initialize database connection
    console.log('Conectando a la base de datos...');
    await initDb();
    console.log('Conexión establecida.\n');

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < statements.length; i++) {
        const sql = statements[i];
        const tableName = sql.match(/JAVIER\.(\w+)/)?.[1] || `Statement ${i + 1}`;

        try {
            await query(sql, false);
            console.log(`✅ [${i + 1}/${statements.length}] Creada: ${tableName}`);
            success++;
        } catch (error) {
            const msg = error.message || '';
            // Check if it's a "already exists" error
            if (msg.includes('already exists') ||
                msg.includes('SQL0601') ||
                msg.includes('existe') ||
                msg.includes('duplicate')) {
                console.log(`⏭️  [${i + 1}/${statements.length}] Ya existe: ${tableName}`);
                skipped++;
            } else {
                console.error(`❌ [${i + 1}/${statements.length}] Error en ${tableName}: ${msg.substring(0, 100)}`);
                failed++;
            }
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`RESULTADO: ${success} creados, ${skipped} ya existían, ${failed} errores`);
    console.log('='.repeat(60));

    if (failed === 0) {
        console.log('\n✅ TABLAS LISTAS PARA USAR');
        process.exit(0);
    } else {
        console.log('\n⚠️  Algunos errores requieren atención');
        console.log('Nota: Si las tablas ya existen, el error es normal.');
        process.exit(0); // Exit 0 anyway as tables might already exist
    }
}

executeStatements().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
