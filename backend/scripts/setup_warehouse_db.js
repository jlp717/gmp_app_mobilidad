/**
 * SETUP WAREHOUSE DB - Tablas satélite Almacén/Expediciones
 * Ejecutar: node scripts/setup_warehouse_db.js
 */
const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

const TABLES = [
  {
    name: 'JAVIER.ALMACEN_ART_DIMENSIONES',
    ddl: `CREATE TABLE JAVIER.ALMACEN_ART_DIMENSIONES (
      CODIGOARTICULO VARCHAR(20) NOT NULL PRIMARY KEY,
      LARGO_CM       DECIMAL(8,2) DEFAULT 30.00,
      ANCHO_CM       DECIMAL(8,2) DEFAULT 20.00,
      ALTO_CM        DECIMAL(8,2) DEFAULT 15.00,
      PESO_CAJA_KG   DECIMAL(8,3),
      NOTAS          VARCHAR(200),
      UPDATED_AT     TIMESTAMP,
      UPDATED_BY     VARCHAR(20)
    )`
  },
  {
    name: 'JAVIER.ALMACEN_PERSONAL',
    ddl: `CREATE TABLE JAVIER.ALMACEN_PERSONAL (
      ID              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      NOMBRE          VARCHAR(100) NOT NULL,
      CODIGO_VENDEDOR VARCHAR(20),
      ROL             VARCHAR(30) DEFAULT 'PREPARADOR',
      ACTIVO          CHAR(1) DEFAULT 'S',
      TELEFONO        VARCHAR(20),
      EMAIL           VARCHAR(100),
      CREATED_AT      TIMESTAMP,
      UPDATED_AT      TIMESTAMP
    )`
  },
  {
    name: 'JAVIER.ALMACEN_CAMIONES_CONFIG',
    ddl: `CREATE TABLE JAVIER.ALMACEN_CAMIONES_CONFIG (
      CODIGOVEHICULO    VARCHAR(10) NOT NULL PRIMARY KEY,
      LARGO_INTERIOR_CM DECIMAL(8,2) DEFAULT 600.00,
      ANCHO_INTERIOR_CM DECIMAL(8,2) DEFAULT 240.00,
      ALTO_INTERIOR_CM  DECIMAL(8,2) DEFAULT 220.00,
      TOLERANCIA_EXCESO DECIMAL(5,2) DEFAULT 5.00,
      NOTAS             VARCHAR(255),
      UPDATED_AT        TIMESTAMP,
      UPDATED_BY        VARCHAR(20)
    )`
  },
  {
    name: 'JAVIER.ALMACEN_CARGA_HISTORICO',
    ddl: `CREATE TABLE JAVIER.ALMACEN_CARGA_HISTORICO (
      ID                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      CODIGOVEHICULO      VARCHAR(10) NOT NULL,
      FECHA_PLANIFICACION DATE,
      PESO_TOTAL_KG       DECIMAL(10,2) DEFAULT 0,
      VOLUMEN_TOTAL_CM3   DECIMAL(14,2) DEFAULT 0,
      PCT_VOLUMEN         DECIMAL(5,2) DEFAULT 0,
      PCT_PESO            DECIMAL(5,2) DEFAULT 0,
      NUM_ORDENES         INTEGER DEFAULT 0,
      NUM_BULTOS          INTEGER DEFAULT 0,
      ESTADO              VARCHAR(20) DEFAULT 'PLANIFICADO',
      DETALLES_JSON       VARCHAR(32000),
      CREATED_BY          VARCHAR(20),
      CREATED_AT          TIMESTAMP
    )`
  }
];

async function run() {
  let conn;
  try {
    conn = await odbc.connect(DB_CONFIG);
    console.log('Conectado a DB2');

    for (const t of TABLES) {
      try {
        await conn.query(t.ddl);
        console.log(`✅ ${t.name} CREADA`);
      } catch (err) {
        const msg = (err.message || '').substring(0, 150);
        if (msg.includes('SQL0601')) {
          console.log(`⏭️  ${t.name} ya existe`);
        } else {
          console.log(`❌ ${t.name}: ${msg}`);
        }
      }
    }

    // Seed vehículos
    try {
      await conn.query(`
        INSERT INTO JAVIER.ALMACEN_CAMIONES_CONFIG 
          (CODIGOVEHICULO, LARGO_INTERIOR_CM, ANCHO_INTERIOR_CM, ALTO_INTERIOR_CM, TOLERANCIA_EXCESO)
        SELECT TRIM(V.CODIGOVEHICULO), 600.00, 240.00, 220.00, 5.00
        FROM DSEDAC.VEH V
        WHERE NOT EXISTS (
          SELECT 1 FROM JAVIER.ALMACEN_CAMIONES_CONFIG C 
          WHERE C.CODIGOVEHICULO = TRIM(V.CODIGOVEHICULO)
        )`);
      console.log('✅ Vehículos seeded');
    } catch (e) {
      console.log('Seed:', (e.message || '').substring(0, 100));
    }

    // Verificar
    for (const t of TABLES) {
      try {
        const r = await conn.query(`SELECT COUNT(*) AS CNT FROM ${t.name}`);
        console.log(`  ${t.name}: ${r[0].CNT} registros`);
      } catch (e) {
        console.log(`  ${t.name}: error`);
      }
    }

    console.log('DONE');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (conn) await conn.close();
    process.exit(0);
  }
}

run();
