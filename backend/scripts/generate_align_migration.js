'use strict';

/**
 * GENERATE ALIGN MIGRATION
 * ========================
 * Lee la estructura real de las tablas DSEDAC en produccion y emite un SQL
 * de migracion para que JAVIER tenga las MISMAS columnas y tipos.
 *
 * Estrategia por tabla:
 *   1. RENAME tabla actual a NombreTabla_OLD20260515
 *   2. CREATE TABLE NombreTabla mirror exacto de DSEDAC + 6 columnas metadata
 *   3. INSERT INTO ... SELECT ... mapeando columnas con nombres equivalentes
 *      (best-effort: las columnas con nombre distinto requieren revision manual)
 *   4. Comentario al final indicando que el _OLD se debe revisar y eliminar
 *
 * Tablas que se procesan (las que se exportan al ERP):
 *   PEDIDOS_CAB <- DSEDAC.CPC
 *   PEDIDOS_LIN <- DSEDAC.LPC
 *   COBROS      <- DSEDAC.CRC
 *   REPARTIDOR_COBROS  <- DSEDAC.CRCA
 *   REPARTIDOR_ENTREGAS <- DSEDAC.CAC
 *   REPARTIDOR_ENTREGA_LINEAS <- DSEDAC.LAC (ya alineada, no se toca)
 *
 * Tablas que NO se procesan (no van al ERP):
 *   REPARTIDOR_LIQUIDACION_OPS (cabecera local; exporta a CLV explotado)
 *   LQD_LIQUIDACIONES (deprecada)
 *   DELIVERY_STATUS, CLIENT_SIGNERS, REPARTIDOR_FIRMAS, etc. (auxiliares)
 *
 * Tablas que se crean si faltan:
 *   JAVIER.BOLSA_COMERCIAL  (DDL fijo, no es mirror)
 *   JAVIER.CUENTAS_LIQUIDACION  (DDL fijo)
 *
 * USO:
 *   node backend/scripts/generate_align_migration.js
 *   Salida: backend/migrations/100_align_javier_to_dsedac.sql
 *
 * El SQL emitido NO se ejecuta automaticamente. Hay que revisarlo y aplicarlo
 * manualmente (primero en dev, luego en prod) con:
 *   node backend/scripts/run_sql.js backend/migrations/100_align_javier_to_dsedac.sql
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const OUTPUT_FILE = path.resolve(__dirname, '..', 'migrations', '100_align_javier_to_dsedac.sql');

// Pares a alinear. La tabla JAVIER se recreara como mirror exacto de la DSEDAC.
const PAIRS = [
  { javier: 'PEDIDOS_CAB',       dsedac: 'CPC',  pkCols: ['SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO'] },
  { javier: 'PEDIDOS_LIN',       dsedac: 'LPC',  pkCols: ['SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO', 'SECUENCIAPEDIDO'] },
  { javier: 'COBROS',            dsedac: 'CRC',  pkCols: ['SUBEMPRESARECIBO', 'EJERCICIORECIBO', 'SERIERECIBO', 'TERMINALRECIBO', 'NUMERORECIBO'] },
  { javier: 'REPARTIDOR_COBROS', dsedac: 'CRCA', pkCols: ['SUBEMPRESAREGISTRO', 'EJERCICIOREGISTRO', 'SERIEREGISTRO', 'TERMINALREGISTRO', 'NUMEROREGISTRO'] },
  { javier: 'REPARTIDOR_ENTREGAS', dsedac: 'CAC', pkCols: ['SUBEMPRESAALBARAN', 'EJERCICIOALBARAN', 'SERIEALBARAN', 'TERMINALALBARAN', 'NUMEROALBARAN'] },
];

// Las 6 columnas estandar de metadata que se anaden a TODAS las tablas mirror.
const METADATA_COLS = [
  { name: 'IDEMPOTENCY_TOKEN', def: 'VARCHAR(128)' },
  { name: 'SYNC_STATUS',       def: "VARCHAR(20) DEFAULT 'PENDING'" },
  { name: 'CREATED_AT',        def: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  { name: 'UPDATED_AT',        def: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  { name: 'OPERADOR',          def: 'VARCHAR(50)' },
  { name: 'PANTALLA_ORIGEN',   def: 'VARCHAR(20)' },
];


function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " environment variable is required");
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

async function safe(conn, sql, params = []) {
  try { return { ok: true, rows: await conn.query(sql, params) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function getColumns(conn, schema, table) {
  const r = await safe(conn, `
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, ORDINAL_POSITION
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [schema, table]);
  return r.ok ? r.rows : [];
}

function ddlTypeFromCol(c) {
  const t = (c.DATA_TYPE || '').toUpperCase();
  const len = c.LENGTH;
  const scale = c.NUMERIC_SCALE;
  const nullSuffix = c.IS_NULLABLE === 'N' ? ' NOT NULL WITH DEFAULT' : '';
  switch (t) {
    case 'CHAR':       return `CHAR(${len})${nullSuffix}`;
    case 'VARCHAR':    return `VARCHAR(${len})${nullSuffix}`;
    case 'NUMERIC':    return `NUMERIC(${len}${scale ? `,${scale}` : ''})${nullSuffix}`;
    case 'DECIMAL':    return `DECIMAL(${len}${scale ? `,${scale}` : ''})${nullSuffix}`;
    case 'INTEGER':    return `INTEGER${nullSuffix}`;
    case 'BIGINT':     return `BIGINT${nullSuffix}`;
    case 'SMALLINT':   return `SMALLINT${nullSuffix}`;
    case 'DATE':       return `DATE${nullSuffix}`;
    case 'TIME':       return `TIME${nullSuffix}`;
    case 'TIMESTMP':
    case 'TIMESTAMP':  return `TIMESTAMP${nullSuffix}`;
    case 'REAL':       return `REAL${nullSuffix}`;
    case 'DOUBLE':     return `DOUBLE${nullSuffix}`;
    default:
      return `${t}(${len || ''})${nullSuffix}`;
  }
}

function nowStamp() {
  const d = new Date();
  return d.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
}

async function generateForPair(conn, pair, stamp) {
  const out = [];
  out.push(`-- ============================================================`);
  out.push(`-- ${pair.javier} <- DSEDAC.${pair.dsedac}`);
  out.push(`-- ============================================================`);

  const dsedacCols = await getColumns(conn, 'DSEDAC', pair.dsedac);
  if (!dsedacCols.length) {
    out.push(`-- ERROR: DSEDAC.${pair.dsedac} no tiene columnas. Abort.`);
    return out.join('\n');
  }

  const javierCols = await getColumns(conn, 'JAVIER', pair.javier);
  const javierExists = javierCols.length > 0;
  const oldName = `${pair.javier}_OLD${stamp}`;

  // 1. Backup actual (rename a _OLD)
  if (javierExists) {
    out.push(``);
    out.push(`-- Paso 1: renombrar tabla actual como backup`);
    out.push(`RENAME TABLE JAVIER.${pair.javier} TO ${oldName};`);
  } else {
    out.push(``);
    out.push(`-- Paso 1: JAVIER.${pair.javier} no existe, skip backup`);
  }

  // 2. CREATE TABLE mirror exacto
  out.push(``);
  out.push(`-- Paso 2: crear nueva tabla mirror exacto de DSEDAC.${pair.dsedac} + metadata`);
  out.push(`CREATE TABLE JAVIER.${pair.javier} (`);
  const colLines = [];
  for (const c of dsedacCols) {
    // Excluimos columnas que ya estan en metadata (no deberian existir en DSEDAC)
    if (METADATA_COLS.some(m => m.name === c.COLUMN_NAME)) continue;
    colLines.push(`  ${c.COLUMN_NAME.padEnd(40, ' ')} ${ddlTypeFromCol(c)}`);
  }
  // Anadir metadata
  for (const m of METADATA_COLS) {
    colLines.push(`  ${m.name.padEnd(40, ' ')} ${m.def}`);
  }
  out.push(colLines.join(',\n'));
  out.push(`);`);

  // PK + indices basicos
  if (pair.pkCols && pair.pkCols.length) {
    const pkName = `PK_${pair.javier}`.slice(0, 30);
    out.push(``);
    out.push(`-- Indice por clave primaria logica del ERP`);
    out.push(`CREATE UNIQUE INDEX JAVIER.${pkName}`);
    out.push(`  ON JAVIER.${pair.javier} (${pair.pkCols.join(', ')});`);
    out.push(`CREATE INDEX JAVIER.IDX_${pair.javier}_TOKEN`);
    out.push(`  ON JAVIER.${pair.javier} (IDEMPOTENCY_TOKEN);`);
    out.push(`CREATE INDEX JAVIER.IDX_${pair.javier}_SYNC`);
    out.push(`  ON JAVIER.${pair.javier} (SYNC_STATUS, CREATED_AT);`);
  }

  // 3. INSERT INTO ... SELECT ... mapeando columnas con nombre identico
  if (javierExists) {
    const javierColNames = new Set(javierCols.map(c => c.COLUMN_NAME));
    const sharedCols = dsedacCols
      .map(c => c.COLUMN_NAME)
      .filter(n => javierColNames.has(n));
    if (sharedCols.length) {
      out.push(``);
      out.push(`-- Paso 3: migrar datos por columnas con nombre identico`);
      out.push(`-- (${sharedCols.length} cols comunes - revisar mapeos manuales si faltan)`);
      out.push(`INSERT INTO JAVIER.${pair.javier} (${sharedCols.join(', ')})`);
      out.push(`SELECT ${sharedCols.join(', ')} FROM JAVIER.${oldName};`);
    } else {
      out.push(``);
      out.push(`-- Paso 3: NO hay columnas con nombre identico - revision manual obligatoria`);
      out.push(`-- Tabla ${oldName} contiene ${javierCols.length} columnas; revisa antes de drop.`);
    }

    out.push(``);
    out.push(`-- Paso 4 (MANUAL): tras verificar datos migrados, ejecutar:`);
    out.push(`--   DROP TABLE JAVIER.${oldName};`);
  }

  out.push(``);
  return out.join('\n');
}

(async () => {
  const conn = await odbc.connect(connectionString());
  const stamp = nowStamp();

  const md = [];
  md.push(`-- ============================================================================`);
  md.push(`-- MIGRACION JAVIER -> DSEDAC MIRROR`);
  md.push(`-- Generado: ${new Date().toISOString()}`);
  md.push(`-- Stamp suffix para tablas backup: _OLD${stamp}`);
  md.push(`-- ============================================================================`);
  md.push(``);
  md.push(`-- IMPORTANTE:`);
  md.push(`-- 1. EJECUTAR PRIMERO EN DEV. Verificar y luego aplicar en PROD.`);
  md.push(`-- 2. Las tablas se renombran a _OLD<stamp>. NO se hace DROP automatico.`);
  md.push(`-- 3. Tras verificar la migracion, eliminar manualmente las _OLD.`);
  md.push(`-- 4. El SQL es idempotente solo si las tablas _OLD<stamp> no existen ya.`);
  md.push(``);
  md.push(`-- Tablas auxiliares que se crean si faltan (no son mirrors):`);
  md.push(``);
  md.push(`-- BOLSA_COMERCIAL (JAVIER por diseno, no replicada al ERP)`);
  md.push(`CREATE TABLE JAVIER.BOLSA_COMERCIAL (`);
  md.push(`  ID                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`);
  md.push(`  CODIGOVENDEDOR      VARCHAR(10) NOT NULL,`);
  md.push(`  EJERCICIO           NUMERIC(4)  NOT NULL,`);
  md.push(`  MES                 NUMERIC(2)  NOT NULL,`);
  md.push(`  LIMITE_PCT          DECIMAL(5,2) DEFAULT 3.00,`);
  md.push(`  LIMITE_IMPORTE      DECIMAL(11,2) DEFAULT 0,`);
  md.push(`  SALDO_DISPONIBLE    DECIMAL(11,2) DEFAULT 0,`);
  md.push(`  CONSUMIDO           DECIMAL(11,2) DEFAULT 0,`);
  md.push(`  ACUMULADO           DECIMAL(11,2) DEFAULT 0,`);
  md.push(`  CREATED_AT          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,`);
  md.push(`  UPDATED_AT          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,`);
  md.push(`  CONSTRAINT UQ_BOLSA_VND_MES UNIQUE (CODIGOVENDEDOR, EJERCICIO, MES)`);
  md.push(`);`);
  md.push(``);
  md.push(`-- CUENTAS_LIQUIDACION`);
  md.push(`CREATE TABLE JAVIER.CUENTAS_LIQUIDACION (`);
  md.push(`  ID                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`);
  md.push(`  CODIGO_REPARTIDOR   VARCHAR(20) NOT NULL,`);
  md.push(`  IBAN                VARCHAR(34),`);
  md.push(`  BANCO               VARCHAR(120),`);
  md.push(`  TITULAR             VARCHAR(120),`);
  md.push(`  ACTIVA              CHAR(1) DEFAULT 'S',`);
  md.push(`  CREATED_AT          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,`);
  md.push(`  UPDATED_AT          TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
  md.push(`);`);
  md.push(`CREATE INDEX JAVIER.IDX_CL_REP ON JAVIER.CUENTAS_LIQUIDACION (CODIGO_REPARTIDOR);`);
  md.push(``);
  md.push(``);

  for (const pair of PAIRS) {
    process.stdout.write(`Generando ${pair.javier} <- DSEDAC.${pair.dsedac}... `);
    md.push(await generateForPair(conn, pair, stamp));
    process.stdout.write('OK\n');
  }

  // Liquidacion: anadir columnas faltantes a REPARTIDOR_LIQUIDACION_OPS
  // sin recrear (mantenemos modelo "una fila por liquidacion" en JAVIER).
  md.push(`-- ============================================================`);
  md.push(`-- REPARTIDOR_LIQUIDACION_OPS: ADD COLUMNS (no es mirror)`);
  md.push(`-- Justificacion: el ERP usa CLV (N filas por liquidacion, una por`);
  md.push(`-- CODIGOCONCEPTO). La app mantiene una fila con todos los totales`);
  md.push(`-- y al exportar transformamos 1 fila -> N filas en CLV.`);
  md.push(`-- Anadimos los campos clave del ERP para que la equivalencia sea`);
  md.push(`-- explicita y se pueda construir la clave de CLV al exportar.`);
  md.push(`-- ============================================================`);
  md.push(``);
  md.push(`-- Las columnas SUBEMPRESALIQUIDACION/EJERCICIO/SERIE/TERMINAL/NUMERO`);
  md.push(`-- ya existen en JAVIER.REPARTIDOR_LIQUIDACION_OPS (verificado).`);
  md.push(`-- No hace falta ALTER aqui.`);
  md.push(``);

  // Vistas que faltan: dejamos placeholder para que el usuario las defina
  md.push(`-- ============================================================`);
  md.push(`-- VISTAS QUE FALTAN`);
  md.push(`-- ============================================================`);
  md.push(`-- V_ENTREGAS_HOY y V_COMISIONES_REPARTIDOR no existen.`);
  md.push(`-- Pendiente: definir SQL de cada vista (depende del modelo final`);
  md.push(`-- de entregas y comisiones).`);
  md.push(``);

  await conn.close();
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, md.join('\n'), 'utf8');
  console.log(`\nGenerado: ${OUTPUT_FILE}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
