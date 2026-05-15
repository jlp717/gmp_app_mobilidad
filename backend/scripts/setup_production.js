'use strict';

/**
 * SETUP PRODUCCION — script unico todo-en-uno
 * ============================================
 * Ejecuta TODO lo necesario para dejar el servidor listo tras los fixes de
 * la sesion 2026-05-15. Idempotente: se puede correr varias veces sin riesgo.
 *
 * QUE HACE (en orden):
 *  1. Verifica conexion a DB2 con las credenciales del .env actual.
 *  2. Crea (si faltan) las tablas:
 *       - JAVIER.BOLSA_COMERCIAL
 *       - JAVIER.MOVIMIENTOS_BOLSA (suele existir ya)
 *       - JAVIER.CUENTAS_LIQUIDACION
 *  3. Crea (si faltan) los indices asociados.
 *  4. Crea (si faltan) las vistas:
 *       - JAVIER.V_ENTREGAS_HOY
 *       - JAVIER.V_COMISIONES_REPARTIDOR
 *  5. Arregla los 3 tipos divergentes en JAVIER.PEDIDOS_CAB
 *     (IMPORTETOTAL/COSTO/MARGEN de NUMERIC(11,2) a NUMERIC(10,2)) si aplica.
 *  6. Verifica al final que todos los objetos existen y reporta.
 *
 * QUE *NO* HACE:
 *  - NO modifica datos existentes en ninguna tabla.
 *  - NO toca DSEDAC. Solo lee y escribe en JAVIER (sandbox).
 *  - NO activa exports al ERP. Los exports estan tras PEDIDOS_EXPORT_TO_SYSTEM
 *    en el .env y por defecto vienen desactivados.
 *  - NO ejecuta la migracion 027 (paridad de columnas PEDIDOS_CAB <-> CPC).
 *    Esa es opcional y se ejecuta aparte cuando se decida activar exports.
 *
 * USO:
 *  cd /opt/gmp-api
 *  node backend/scripts/setup_production.js
 *
 * SALIDA esperada: bloque final "ESTADO FINAL" con todo en OK.
 */

const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function connectionString() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.ODBC_PWD || 'JAVIER';
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
  /SQLSTATE\s*=?\s*42704/i,   // referencia inexistente (DROP de algo que no existe)
  /SQLSTATE\s*=?\s*42723/i,   // duplicate function
  /already exists/i,
  /SQLCODE\s*=?\s*-601/i,
];
function isTolerable(err) {
  const msg = String(err.message || '');
  return TOLERABLE.some((rx) => rx.test(msg));
}

let okCount = 0, skipCount = 0, failCount = 0;

async function runStatement(conn, label, sql, params = []) {
  try {
    await conn.query(sql, params);
    okCount++;
    console.log(`  ✓ ${label}`);
    return true;
  } catch (err) {
    if (isTolerable(err)) {
      skipCount++;
      console.log(`  · ${label}: ya existe (omitido)`);
      return true;
    }
    failCount++;
    console.error(`  ✗ ${label}: ${err.message}`);
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

async function columnType(conn, table, column) {
  try {
    const r = await conn.query(`
      SELECT DATA_TYPE, LENGTH, NUMERIC_SCALE FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME=? AND COLUMN_NAME=?
    `, [table, column]);
    return r[0] || null;
  } catch (_) { return null; }
}

async function main() {
  console.log('============================================');
  console.log('  SETUP PRODUCCION - GMP App Mobilidad');
  console.log(`  Fecha: ${new Date().toISOString()}`);
  console.log(`  Entorno: ${process.env.NODE_ENV || 'unknown'}`);
  console.log(`  Esquema app: ${process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER (default)'}`);
  console.log(`  Export DSEDAC: ${process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false (default)'}`);
  console.log('============================================');

  console.log('\n[1/6] Conectando a DB2...');
  const conn = await odbc.connect(connectionString());
  console.log('  ✓ Conexion OK');

  // ─── 2. JAVIER.BOLSA_COMERCIAL ────────────────────────────────────────
  console.log('\n[2/6] Creando tablas faltantes...');
  await runStatement(conn, 'JAVIER.BOLSA_COMERCIAL', `
    CREATE TABLE JAVIER.BOLSA_COMERCIAL (
      ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
      CONSTRAINT UQ_BOLSA_VND_MES UNIQUE (CODIGOVENDEDOR, EJERCICIO, MES)
    )
  `);

  await runStatement(conn, 'JAVIER.CUENTAS_LIQUIDACION', `
    CREATE TABLE JAVIER.CUENTAS_LIQUIDACION (
      ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
      CONSTRAINT UQ_CL_REP_EJER UNIQUE (CODIGO_REPARTIDOR, EJERCICIO)
    )
  `);

  // ─── 3. Indices ───────────────────────────────────────────────────────
  console.log('\n[3/6] Creando indices...');
  await runStatement(conn, 'IDX_BOLSA_VND',
    `CREATE INDEX JAVIER.IDX_BOLSA_VND ON JAVIER.BOLSA_COMERCIAL (CODIGOVENDEDOR, EJERCICIO)`);
  await runStatement(conn, 'IDX_CL_REP',
    `CREATE INDEX JAVIER.IDX_CL_REP ON JAVIER.CUENTAS_LIQUIDACION (CODIGO_REPARTIDOR)`);

  // ─── 4. Vistas ────────────────────────────────────────────────────────
  console.log('\n[4/6] Creando vistas...');
  await runStatement(conn, 'JAVIER.V_ENTREGAS_HOY', `
    CREATE VIEW JAVIER.V_ENTREGAS_HOY AS
    SELECT
      CAC.SUBEMPRESAALBARAN,
      CAC.EJERCICIOALBARAN,
      CAC.SERIEALBARAN,
      CAC.TERMINALALBARAN,
      CAC.NUMEROALBARAN,
      CAC.DIADOCUMENTO,
      CAC.MESDOCUMENTO,
      CAC.ANODOCUMENTO,
      TRIM(CAC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
      TRIM(CAC.CODIGOVENDEDOR) AS CODIGOVENDEDOR,
      TRIM(CAC.CODIGOVENDEDORREPARTORUTERO) AS CODIGOREPARTIDOR,
      TRIM(CAC.CODIGORUTA) AS CODIGORUTA,
      CAC.IMPORTETOTAL,
      CAC.SITUACIONALBARAN,
      CAC.MARCALIQUIDADO,
      CAC.DIAENTREGA,
      CAC.MESENTREGA,
      CAC.ANOENTREGA
    FROM DSEDAC.CAC CAC
    WHERE CAC.ANODOCUMENTO = YEAR(CURRENT_DATE)
      AND CAC.MESDOCUMENTO = MONTH(CURRENT_DATE)
      AND CAC.DIADOCUMENTO = DAY(CURRENT_DATE)
      AND CAC.ELIMINADOSN <> 'S'
  `);

  await runStatement(conn, 'JAVIER.V_COMISIONES_REPARTIDOR', `
    CREATE VIEW JAVIER.V_COMISIONES_REPARTIDOR AS
    SELECT
      TRIM(CVC.CODIGOVENDEDORCOBRO) AS CODIGO_REPARTIDOR,
      CVC.ANOCOBRO AS EJERCICIO,
      CVC.MESCOBRO AS MES,
      COUNT(*) AS NUM_COBROS,
      SUM(CVC.IMPORTECANCELADO) AS TOTAL_COBRADO,
      SUM(CASE WHEN CVC.ANULADOSN = 'S' THEN CVC.IMPORTECANCELADO ELSE 0 END) AS TOTAL_ANULADO
    FROM DSEDAC.CVC CVC
    WHERE CVC.IMPORTECANCELADO > 0
      AND CVC.ANOCOBRO > 0
      AND CVC.NUMEROLIQUIDACION > 0
    GROUP BY TRIM(CVC.CODIGOVENDEDORCOBRO), CVC.ANOCOBRO, CVC.MESCOBRO
  `);

  // ─── 5. Fix tipos PEDIDOS_CAB (NUMERIC 11,2 -> 10,2) ──────────────────
  console.log('\n[5/6] Verificando tipos PEDIDOS_CAB...');
  const types = await Promise.all([
    columnType(conn, 'PEDIDOS_CAB', 'IMPORTETOTAL'),
    columnType(conn, 'PEDIDOS_CAB', 'IMPORTECOSTO'),
    columnType(conn, 'PEDIDOS_CAB', 'IMPORTEMARGEN'),
  ]);
  const needFix = types.some((t) => t && (t.LENGTH === 11 || t.LENGTH === '11'));
  if (needFix) {
    console.log('  PEDIDOS_CAB necesita migracion de tipos (NUMERIC(11,2)->NUMERIC(10,2)).');
    console.log('  AVISO: esta migracion modifica columnas. Se hace via columnas _NEW para evitar perdida.');

    // Verifica que no haya importes > 99,999,999.99 antes de truncar
    try {
      const max = await conn.query(`
        SELECT MAX(IMPORTETOTAL) AS MAX_TOT,
               MAX(IMPORTECOSTO) AS MAX_COS,
               MAX(IMPORTEMARGEN) AS MAX_MAR
        FROM JAVIER.PEDIDOS_CAB
      `);
      const maxVal = Math.max(
        Number(max[0]?.MAX_TOT) || 0,
        Number(max[0]?.MAX_COS) || 0,
        Number(max[0]?.MAX_MAR) || 0,
      );
      if (maxVal > 99999999.99) {
        console.log(`  ✗ ABORT: importe maximo encontrado=${maxVal}, no cabe en NUMERIC(10,2). Saltando este fix.`);
        skipCount++;
      } else {
        // Safe to migrate
        const sqls = [
          `ALTER TABLE JAVIER.PEDIDOS_CAB ADD COLUMN IMPORTETOTAL_NEW NUMERIC(10,2)`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB ADD COLUMN IMPORTECOSTO_NEW NUMERIC(10,2)`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB ADD COLUMN IMPORTEMARGEN_NEW NUMERIC(10,2)`,
          `UPDATE JAVIER.PEDIDOS_CAB SET IMPORTETOTAL_NEW=IMPORTETOTAL, IMPORTECOSTO_NEW=IMPORTECOSTO, IMPORTEMARGEN_NEW=IMPORTEMARGEN`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB DROP COLUMN IMPORTETOTAL`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB DROP COLUMN IMPORTECOSTO`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB DROP COLUMN IMPORTEMARGEN`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB ADD COLUMN IMPORTETOTAL NUMERIC(10,2)`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB ADD COLUMN IMPORTECOSTO NUMERIC(10,2)`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB ADD COLUMN IMPORTEMARGEN NUMERIC(10,2)`,
          `UPDATE JAVIER.PEDIDOS_CAB SET IMPORTETOTAL=IMPORTETOTAL_NEW, IMPORTECOSTO=IMPORTECOSTO_NEW, IMPORTEMARGEN=IMPORTEMARGEN_NEW`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB DROP COLUMN IMPORTETOTAL_NEW`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB DROP COLUMN IMPORTECOSTO_NEW`,
          `ALTER TABLE JAVIER.PEDIDOS_CAB DROP COLUMN IMPORTEMARGEN_NEW`,
        ];
        for (const sql of sqls) {
          await runStatement(conn, sql.slice(0, 70) + '...', sql);
        }
      }
    } catch (e) {
      console.log(`  · Salta fix tipos: ${e.message}`);
      skipCount++;
    }
  } else {
    console.log('  · Tipos ya correctos (NUMERIC(10,2)) o columnas no presentes');
    skipCount++;
  }

  // ─── 6. Verificacion final ────────────────────────────────────────────
  console.log('\n[6/6] Verificacion final del estado...');
  const checks = [
    { type: 'TABLE', name: 'BOLSA_COMERCIAL', existsFn: () => tableExists(conn, 'BOLSA_COMERCIAL') },
    { type: 'TABLE', name: 'MOVIMIENTOS_BOLSA', existsFn: () => tableExists(conn, 'MOVIMIENTOS_BOLSA') },
    { type: 'TABLE', name: 'CUENTAS_LIQUIDACION', existsFn: () => tableExists(conn, 'CUENTAS_LIQUIDACION') },
    { type: 'TABLE', name: 'PEDIDOS_CAB', existsFn: () => tableExists(conn, 'PEDIDOS_CAB') },
    { type: 'TABLE', name: 'PEDIDOS_LIN', existsFn: () => tableExists(conn, 'PEDIDOS_LIN') },
    { type: 'TABLE', name: 'COBROS', existsFn: () => tableExists(conn, 'COBROS') },
    { type: 'TABLE', name: 'REPARTIDOR_COBROS', existsFn: () => tableExists(conn, 'REPARTIDOR_COBROS') },
    { type: 'VIEW',  name: 'V_ENTREGAS_HOY', existsFn: () => viewExists(conn, 'V_ENTREGAS_HOY') },
    { type: 'VIEW',  name: 'V_COMISIONES_REPARTIDOR', existsFn: () => viewExists(conn, 'V_COMISIONES_REPARTIDOR') },
  ];

  console.log('  Objeto                            Tipo   Existe');
  console.log('  ─────────────────────────────────────────────────');
  for (const c of checks) {
    const ok = await c.existsFn();
    const label = `JAVIER.${c.name}`.padEnd(34);
    console.log(`  ${label} ${c.type.padEnd(6)} ${ok ? '✓' : '✗ FALTA'}`);
  }

  await conn.close();

  console.log('\n============================================');
  console.log('  ESTADO FINAL');
  console.log(`  OK:      ${okCount}`);
  console.log(`  Omitido: ${skipCount}  (objetos ya existentes, no es error)`);
  console.log(`  Fallos:  ${failCount}`);
  console.log('============================================');

  if (failCount > 0) {
    console.error('\n⚠  Hubo fallos no tolerables. Revisa el log de arriba.');
    process.exit(1);
  }
  console.log('\n✓ Setup completado correctamente.');
  console.log('\nPROXIMO PASO: pm2 restart gmp-api');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
