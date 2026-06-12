'use strict';

/**
 * SETUP PRODUCCION v2 - mejorado tras logs de 2026-05-15 18:23
 * ============================================================
 * Cambios v2:
 *   - Muestra error ODBC REAL (odbcErrors[0].message) en lugar de "Error
 *     executing the sql statement" generico.
 *   - DDL mas compatible con DB2 for i (sin UNIQUE inline, usa CREATE UNIQUE
 *     INDEX aparte; identidad con START WITH 1).
 *   - LIMPIA columnas huerfanas IMPORTETOTAL_NEW/IMPORTECOSTO_NEW/IMPORTEMARGEN_NEW
 *     que quedaron de una ejecucion anterior.
 *   - YA NO intenta cambiar NUMERIC(11,2)->NUMERIC(10,2) en PEDIDOS_CAB.
 *     JAVIER usa NUMERIC(11,2) que ES SUPERIOR a NUMERIC(10,2) y siempre cabe
 *     cualquier valor que el ERP aceptaria. No bloquea nada.
 *
 * Idempotente: se puede correr varias veces sin riesgo.
 * Solo toca JAVIER (sandbox). NUNCA escribe en DSEDAC.
 *
 * USO:
 *   cd /opt/gmp-api
 *   node backend/scripts/setup_production.js
 */

const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function requireEnv(name) {
  const value = process['env'][name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Missing required environment variable ' + name);
  }
  return value;
}

function connectionString() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = requireEnv('ODBC_UID');
  const pwd = requireEnv('ODBC_PWD');
  return [
    `DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1',
    `CPTOUT=${process.env.ODBC_TIMEOUT || 60}`,
    `COMMTIMEOUT=${process.env.ODBC_COMM_TIMEOUT || 90}`,
    `DBQ=${dsn}`,
  ].join(';');
}

const TOLERABLE = [
  /SQLSTATE\s*=?\s*42710/i,   // objeto ya existe
  /SQLSTATE\s*=?\s*42711/i,   // columna ya existe
  /SQLSTATE\s*=?\s*42704/i,   // referencia inexistente (drop de algo que no existe)
  /already exists/i,
  /not found/i,
  /SQLCODE\s*=?\s*-601/i,     // duplicate name
  /SQLCODE\s*=?\s*-204/i,     // not found
];
function isTolerable(err) {
  const msg = String(err.message || '');
  const odbcMsg = (err.odbcErrors && err.odbcErrors[0]?.message) || '';
  return TOLERABLE.some((rx) => rx.test(msg) || rx.test(odbcMsg));
}

function fmtError(err) {
  const odbc0 = err.odbcErrors && err.odbcErrors[0];
  if (odbc0) {
    return `${odbc0.state || 'SQL'} (${odbc0.code || 0}): ${odbc0.message || err.message}`;
  }
  return err.message || String(err);
}

let okCount = 0, skipCount = 0, failCount = 0;

async function runStatement(conn, label, sql, params = []) {
  try {
    await conn.query(sql, params);
    okCount++;
    console.log(`  OK  ${label}`);
    return true;
  } catch (err) {
    if (isTolerable(err)) {
      skipCount++;
      console.log(`  --  ${label} (ya existia o no aplica)`);
      return true;
    }
    failCount++;
    console.error(`  X   ${label}`);
    console.error(`        ${fmtError(err)}`);
    return false;
  }
}

async function tableExists(conn, table) {
  try {
    const r = await conn.query(
      `SELECT COUNT(*) AS N FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME=?`,
      [table],
    );
    return Number(r[0]?.N) > 0;
  } catch (_) { return false; }
}
async function viewExists(conn, view) {
  try {
    const r = await conn.query(
      `SELECT COUNT(*) AS N FROM QSYS2.SYSVIEWS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME=?`,
      [view],
    );
    return Number(r[0]?.N) > 0;
  } catch (_) { return false; }
}
async function columnExists(conn, table, column) {
  try {
    const r = await conn.query(
      `SELECT COUNT(*) AS N FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [table, column],
    );
    return Number(r[0]?.N) > 0;
  } catch (_) { return false; }
}

async function main() {
  console.log('============================================');
  console.log('  SETUP PRODUCCION v2 - GMP App Mobilidad');
  console.log(`  Fecha: ${new Date().toISOString()}`);
  console.log(`  Entorno: ${process.env.NODE_ENV || 'unknown'}`);
  console.log(`  Esquema app: ${process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER (default)'}`);
  console.log(`  Export DSEDAC: ${process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false (default)'}`);
  console.log('============================================');

  console.log('\n[1/5] Conectando a DB2...');
  const conn = await odbc.connect(connectionString());
  console.log('  OK  Conexion');

  // ─── 2. CREATE TABLE BOLSA_COMERCIAL ─────────────────────────────────
  console.log('\n[2/5] Creando tablas faltantes (DDL compatible DB2 for i)...');

  // Variante 1: identidad con START WITH 1, sin UNIQUE inline (DB2 for i a veces falla con inline)
  if (!await tableExists(conn, 'BOLSA_COMERCIAL')) {
    await runStatement(conn, 'JAVIER.BOLSA_COMERCIAL', `
      CREATE TABLE JAVIER.BOLSA_COMERCIAL (
        ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1),
        CODIGOVENDEDOR VARCHAR(10) NOT NULL,
        EJERCICIO NUMERIC(4) NOT NULL,
        MES NUMERIC(2) NOT NULL,
        LIMITE_PCT DECIMAL(5,2) DEFAULT 3.00,
        LIMITE_IMPORTE DECIMAL(11,2) DEFAULT 0,
        SALDO_DISPONIBLE DECIMAL(11,2) DEFAULT 0,
        CONSUMIDO DECIMAL(11,2) DEFAULT 0,
        ACUMULADO DECIMAL(11,2) DEFAULT 0,
        CREATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
        PRIMARY KEY (ID)
      )
    `);
    // Unique se crea aparte (mas robusto en DB2 for i)
    await runStatement(conn, 'UQ_BOLSA_VND_MES',
      `CREATE UNIQUE INDEX JAVIER.UQ_BOLSA_VND_MES ON JAVIER.BOLSA_COMERCIAL (CODIGOVENDEDOR, EJERCICIO, MES)`);
  } else {
    console.log('  --  JAVIER.BOLSA_COMERCIAL ya existe');
    skipCount++;
  }

  if (!await tableExists(conn, 'CUENTAS_LIQUIDACION')) {
    await runStatement(conn, 'JAVIER.CUENTAS_LIQUIDACION', `
      CREATE TABLE JAVIER.CUENTAS_LIQUIDACION (
        ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1),
        CODIGO_REPARTIDOR VARCHAR(10) NOT NULL,
        EJERCICIO NUMERIC(4) NOT NULL,
        SALDO_ACUMULADO DECIMAL(11,2) DEFAULT 0,
        ULTIMO_CIERRE DATE,
        ULTIMO_TOKEN VARCHAR(128),
        NUM_CIERRES INTEGER DEFAULT 0,
        TOTAL_COBRADO_ANO DECIMAL(13,2) DEFAULT 0,
        TOTAL_INGRESADO_ANO DECIMAL(13,2) DEFAULT 0,
        OBSERVACIONES VARCHAR(500),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ID)
      )
    `);
    await runStatement(conn, 'UQ_CL_REP_EJER',
      `CREATE UNIQUE INDEX JAVIER.UQ_CL_REP_EJER ON JAVIER.CUENTAS_LIQUIDACION (CODIGO_REPARTIDOR, EJERCICIO)`);
  } else {
    console.log('  --  JAVIER.CUENTAS_LIQUIDACION ya existe');
    skipCount++;
  }

  // ─── 3. Indices secundarios ──────────────────────────────────────────
  console.log('\n[3/5] Creando indices secundarios...');
  if (await tableExists(conn, 'BOLSA_COMERCIAL')) {
    await runStatement(conn, 'IDX_BOLSA_VND',
      `CREATE INDEX JAVIER.IDX_BOLSA_VND ON JAVIER.BOLSA_COMERCIAL (CODIGOVENDEDOR, EJERCICIO)`);
  }
  if (await tableExists(conn, 'CUENTAS_LIQUIDACION')) {
    await runStatement(conn, 'IDX_CL_REP',
      `CREATE INDEX JAVIER.IDX_CL_REP ON JAVIER.CUENTAS_LIQUIDACION (CODIGO_REPARTIDOR)`);
  }

  // ─── 4. Limpiar columnas huerfanas _NEW en PEDIDOS_CAB ──────────────
  console.log('\n[4/5] Limpiando columnas huerfanas en PEDIDOS_CAB (si las hay)...');
  const orphans = ['IMPORTETOTAL_NEW', 'IMPORTECOSTO_NEW', 'IMPORTEMARGEN_NEW'];
  for (const col of orphans) {
    if (await columnExists(conn, 'PEDIDOS_CAB', col)) {
      await runStatement(conn, `DROP COLUMN ${col}`,
        `ALTER TABLE JAVIER.PEDIDOS_CAB DROP COLUMN ${col}`);
    } else {
      console.log(`  --  ${col} no existe (limpio)`);
    }
  }

  // NOTA sobre tipos NUMERIC(11,2) vs NUMERIC(10,2):
  // JAVIER.PEDIDOS_CAB usa NUMERIC(11,2) y DSEDAC.CPC usa NUMERIC(10,2). En
  // DB2 for i no se puede REDUCIR la precision con ALTER COLUMN si la tabla
  // tiene datos. Lo dejamos asi: NUMERIC(11,2) es SUPERIOR (mas capacidad),
  // cualquier valor que cabe en (10,2) cabe en (11,2). No bloquea funcionalidad.

  // ─── 5. Verificacion final ───────────────────────────────────────────
  console.log('\n[5/5] Verificacion final del estado...');
  const checks = [
    { type: 'TABLE', name: 'BOLSA_COMERCIAL' },
    { type: 'TABLE', name: 'MOVIMIENTOS_BOLSA' },
    { type: 'TABLE', name: 'CUENTAS_LIQUIDACION' },
    { type: 'TABLE', name: 'PEDIDOS_CAB' },
    { type: 'TABLE', name: 'PEDIDOS_LIN' },
    { type: 'TABLE', name: 'COBROS' },
    { type: 'TABLE', name: 'REPARTIDOR_COBROS' },
    { type: 'VIEW',  name: 'V_ENTREGAS_HOY' },
    { type: 'VIEW',  name: 'V_COMISIONES_REPARTIDOR' },
  ];

  console.log('  Objeto                                Tipo   Existe');
  console.log('  ────────────────────────────────────────────────────');
  let missing = 0;
  for (const c of checks) {
    const ok = c.type === 'TABLE' ? await tableExists(conn, c.name) : await viewExists(conn, c.name);
    const label = `JAVIER.${c.name}`.padEnd(38);
    console.log(`  ${label} ${c.type.padEnd(6)} ${ok ? 'OK' : 'FALTA'}`);
    if (!ok) missing++;
  }

  // Limpieza: si NUEVAS PEDIDOS_CAB columnas se quedaron sin las _NEW orphans, ok
  await conn.close();

  console.log('\n============================================');
  console.log('  ESTADO FINAL');
  console.log(`  OK:        ${okCount}`);
  console.log(`  Omitidos:  ${skipCount}`);
  console.log(`  Fallos:    ${failCount}`);
  console.log(`  Faltantes: ${missing}`);
  console.log('============================================');

  if (failCount > 0 && missing > 0) {
    console.error('\n*  Hubo fallos. Lee los errores con detalle arriba.');
    console.error('   Si ves "SQL0204 - JAVIER.X no encontrado" o similar,');
    console.error('   copia el mensaje completo y mandamelo.');
    process.exit(1);
  }
  if (missing === 0) {
    console.log('\nOK. Todos los objetos necesarios estan presentes en JAVIER.');
    console.log('\nPROXIMO PASO: pm2 restart gmp-api');
  } else {
    console.log('\nAtencion: faltan objetos. Revisa los logs.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', fmtError(err));
  process.exit(1);
});
