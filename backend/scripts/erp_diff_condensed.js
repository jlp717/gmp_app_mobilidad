'use strict';

/**
 * ERP DIFF CONDENSED
 * ==================
 * Variante reducida de erp_cobros_inventory.js. Solo emite:
 *   - Tablas/vistas que NO existen (gaps)
 *   - Para cada par JAVIER<->DSEDAC: columnas solo-en-uno + type mismatches
 *   - NO incluye samples ni definicion de vistas
 *
 * Pensado para que el output entero quepa en un mensaje (<50K chars).
 *
 * USO: node backend/scripts/erp_diff_condensed.js
 * Salida: backend/tmp/db-exploration/erp_diff_condensed.md
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'db-exploration');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'erp_diff_condensed.md');

// Pares JAVIER <-> DSEDAC a comparar
const PAIRS = [
  { javier: 'PEDIDOS_CAB',                dsedac: 'CPC',  feature: 'PEDIDOS - cabecera' },
  { javier: 'PEDIDOS_LIN',                dsedac: 'LPC',  feature: 'PEDIDOS - lineas' },
  { javier: 'COBROS',                     dsedac: 'CRC',  feature: 'COBROS - cabecera recibo PDA' },
  { javier: 'REPARTIDOR_COBROS',          dsedac: 'CRCA', feature: 'COBROS - aplicacion a albaran' },
  { javier: 'REPARTIDOR_LIQUIDACION_OPS', dsedac: 'CLV',  feature: 'LIQUIDACION (CLV = lineas por concepto)' },
  { javier: 'LQD_LIQUIDACIONES',          dsedac: 'CLV',  feature: 'LIQUIDACION (alt)' },
  { javier: 'REPARTIDOR_ENTREGAS',        dsedac: 'CAC',  feature: 'ENTREGAS - cabecera albaran' },
  { javier: 'REPARTIDOR_ENTREGA_LINEAS',  dsedac: 'LAC',  feature: 'ENTREGAS - lineas albaran' },
];

// Tablas individuales para verificar existencia (no necesitan diff porque
// son JAVIER-only o DSEDAC-only por diseno)
const STANDALONE = {
  dsedac: ['PRD', 'PMR', 'STA', 'CVC', 'CVL', 'CNA'],
  javier: [
    'BOLSA_COMERCIAL', 'MOVIMIENTOS_BOLSA',
    'CUENTAS_LIQUIDACION', 'PAYMENT_CONDITIONS',
    'LQD_IDEMPOTENCY', 'LQD_COMMISSION_TIERS',
    'REPARTIDOR_COBROS_AUDIT', 'REPARTIDOR_FIRMAS',
    'CLIENT_SIGNERS', 'DELIVERY_STATUS',
    'RUTERO_CONFIG', 'RUTERO_LOG',
  ],
};

// Vistas a verificar
const VIEWS = [
  'V_DIM_CLIENTE', 'V_DIM_CLIENTE_EXT', 'V_DIM_ARTICULO',
  'V_DIM_VENDEDOR', 'V_DIM_VENDEDOR_EXT', 'V_FACT_VENTAS',
  'V_COBROS_MOROSIDAD', 'V_COBROS_POR_FACTURA',
  'V_ENTREGAS_HOY', 'V_COMISIONES_REPARTIDOR',
  'V_CRUT', 'V_STG_LAC', 'V_STG_LFC_TAX_DOC', 'V_MEDIOS_POWERBI',
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

async function tableExists(conn, schema, table) {
  const r = await safe(conn, `
    SELECT COUNT(*) AS N FROM QSYS2.SYSTABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
  `, [schema, table]);
  return r.ok && r.rows[0] && Number(r.rows[0].N) > 0;
}

async function viewExists(conn, schema, view) {
  const r = await safe(conn, `
    SELECT COUNT(*) AS N FROM QSYS2.SYSVIEWS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
  `, [schema, view]);
  return r.ok && r.rows[0] && Number(r.rows[0].N) > 0;
}

async function getCols(conn, schema, table) {
  const r = await safe(conn, `
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [schema, table]);
  return r.ok ? r.rows : null;
}

async function rowCount(conn, schema, table) {
  const r = await safe(conn, `SELECT COUNT(*) AS N FROM ${schema}.${table}`);
  return r.ok && r.rows[0] ? Number(r.rows[0].N) : null;
}

function fmtType(c) {
  const len = c.LENGTH != null ? c.LENGTH : '';
  const scale = c.NUMERIC_SCALE != null && c.NUMERIC_SCALE !== 0 ? `,${c.NUMERIC_SCALE}` : '';
  return `${c.DATA_TYPE}(${len}${scale})`;
}

function diffPair(jvCols, dsCols) {
  const jvMap = new Map(jvCols.map(c => [c.COLUMN_NAME, c]));
  const dsMap = new Map(dsCols.map(c => [c.COLUMN_NAME, c]));
  const both = [...jvMap.keys()].filter(k => dsMap.has(k));
  const onlyJv = [...jvMap.keys()].filter(k => !dsMap.has(k));
  const onlyDs = [...dsMap.keys()].filter(k => !jvMap.has(k));
  const typeMismatch = both
    .filter(n => {
      const j = jvMap.get(n), d = dsMap.get(n);
      return j.DATA_TYPE !== d.DATA_TYPE
          || (j.LENGTH || 0) !== (d.LENGTH || 0)
          || (j.NUMERIC_SCALE || 0) !== (d.NUMERIC_SCALE || 0);
    })
    .map(n => ({ name: n, javier: fmtType(jvMap.get(n)), dsedac: fmtType(dsMap.get(n)) }));
  return { bothCount: both.length, onlyJv, onlyDs, typeMismatch, jvMap, dsMap };
}

(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const conn = await odbc.connect(connectionString());

  const md = [];
  md.push(`# Diff condensado ERP <-> JAVIER`);
  md.push(``);
  md.push(`Generado: ${new Date().toISOString()}`);
  md.push(``);

  // ---- GAPS: tablas que NO existen ----
  md.push(`## 1. Gaps de existencia`);
  md.push(``);
  md.push(`| Esquema | Objeto | Tipo | Existe? |`);
  md.push(`|---------|--------|------|---------|`);

  for (const t of STANDALONE.dsedac) {
    const ex = await tableExists(conn, 'DSEDAC', t);
    md.push(`| DSEDAC | ${t} | TABLE | ${ex ? 'SI' : '**NO**'} |`);
    process.stdout.write(`  DSEDAC.${t}... ${ex ? 'OK' : 'FALTA'}\n`);
  }
  for (const t of STANDALONE.javier) {
    const ex = await tableExists(conn, 'JAVIER', t);
    md.push(`| JAVIER | ${t} | TABLE | ${ex ? 'SI' : '**NO**'} |`);
    process.stdout.write(`  JAVIER.${t}... ${ex ? 'OK' : 'FALTA'}\n`);
  }
  for (const v of VIEWS) {
    const ex = await viewExists(conn, 'JAVIER', v);
    md.push(`| JAVIER | ${v} | VIEW | ${ex ? 'SI' : '**NO**'} |`);
    process.stdout.write(`  JAVIER.${v}... ${ex ? 'OK' : 'FALTA'}\n`);
  }
  md.push(``);

  // ---- DIFFS por par ----
  md.push(`## 2. Diff por par`);
  md.push(``);

  for (const p of PAIRS) {
    md.push(`### ${p.feature} — JAVIER.${p.javier} <-> DSEDAC.${p.dsedac}`);
    md.push(``);
    process.stdout.write(`  ${p.javier} <-> ${p.dsedac}... `);
    const jv = await getCols(conn, 'JAVIER', p.javier);
    const ds = await getCols(conn, 'DSEDAC', p.dsedac);
    if (!jv || !jv.length) {
      md.push(`> JAVIER.${p.javier} NO existe`);
      md.push(``);
      process.stdout.write(`NO JAVIER\n`);
      continue;
    }
    if (!ds || !ds.length) {
      md.push(`> DSEDAC.${p.dsedac} NO existe`);
      md.push(``);
      process.stdout.write(`NO DSEDAC\n`);
      continue;
    }
    const jvCount = await rowCount(conn, 'JAVIER', p.javier);
    const dsCount = await rowCount(conn, 'DSEDAC', p.dsedac);
    const d = diffPair(jv, ds);

    md.push(`Cols: JAVIER=${jv.length}, DSEDAC=${ds.length}, ambos=${d.bothCount}, solo-JAVIER=${d.onlyJv.length}, solo-DSEDAC=${d.onlyDs.length}, tipo-distinto=${d.typeMismatch.length}`);
    md.push(``);
    md.push(`Filas: JAVIER=${jvCount}, DSEDAC=${dsCount}`);
    md.push(``);

    if (d.onlyDs.length) {
      md.push(`**Solo en DSEDAC (FALTAN en JAVIER para mirror 1:1):**`);
      d.onlyDs.forEach(n => md.push(`- ${n} ${fmtType(d.dsMap.get(n))}`));
      md.push(``);
    }
    if (d.onlyJv.length) {
      md.push(`**Solo en JAVIER (extras locales o nombres distintos):**`);
      d.onlyJv.forEach(n => md.push(`- ${n} ${fmtType(d.jvMap.get(n))}`));
      md.push(``);
    }
    if (d.typeMismatch.length) {
      md.push(`**Tipo distinto:**`);
      md.push(`| Columna | JAVIER | DSEDAC |`);
      md.push(`|---------|--------|--------|`);
      d.typeMismatch.forEach(m => md.push(`| ${m.name} | ${m.javier} | ${m.dsedac} |`));
      md.push(``);
    }
    process.stdout.write(`OK (${d.bothCount} match, ${d.onlyDs.length} faltan)\n`);
  }

  await conn.close();
  await fs.writeFile(OUTPUT_FILE, md.join('\n'), 'utf8');
  console.log(`\nGuardado en: ${OUTPUT_FILE}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
