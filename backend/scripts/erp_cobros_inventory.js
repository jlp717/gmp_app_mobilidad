'use strict';

/**
 * ERP <-> JAVIER INVENTORY (PEDIDOS + COBROS + LIQUIDACION + ENTREGAS)
 * ====================================================================
 * Objetivo: que JAVIER sea una copia 1:1 (misma estructura) de las tablas de
 * produccion DSEDAC para que los datos generados por la app fluyan despues
 * al ERP sin transformaciones, EXCEPTO bolsa comercial (JAVIER por diseno).
 *
 * Este script:
 *   1. Introspecciona TODAS las tablas DSEDAC y JAVIER usadas en los flujos
 *      de pedidos, cobros y liquidacion diaria de repartidor.
 *   2. Para cada tabla: columnas (nombre, tipo, longitud, escala, null, texto),
 *      n. de filas y 3 filas ejemplo si hay datos.
 *   3. Para cada PAR conocido JAVIER<->DSEDAC: diff automatico de columnas
 *      (presentes en uno y no en el otro, mismo nombre con tipo distinto).
 *   4. Tambien dumpea definicion (TEXT) de las vistas JAVIER del scope.
 *
 * Salida: backend/tmp/db-exploration/erp_inventory_full.md
 *
 * USO: node backend/scripts/erp_cobros_inventory.js
 */

const fs = require('fs/promises');
const path = require('path');
const odbc = require('odbc');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const OUTPUT_DIR = path.resolve(__dirname, '..', 'tmp', 'db-exploration');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'erp_inventory_full.md');

// ---------------------------------------------------------------------------
// Scope: cada grupo es una "feature" con tablas DSEDAC (producibles) y
// tablas/vistas JAVIER (mirror local). El objetivo es que sean equivalentes.
// ---------------------------------------------------------------------------
const SCOPE = [
  {
    feature: 'PEDIDOS (comercial - confirmar pedido)',
    dsedac: [
      { name: 'CPC',     desc: 'Cab.pedidos cliente' },
      { name: 'LPC',     desc: 'Lin.pedidos cliente' },
      { name: 'OCPC',    desc: 'Observaciones cab.pedidos cliente' },
      { name: 'CDVI',    desc: 'Dias visita cliente (reparto)' },
      { name: 'CRUT',    desc: 'Configuracion rutero' },
      { name: 'OPP',     desc: 'Operaciones de pedido' },
      { name: 'VEH',     desc: 'Vehiculos' },
      { name: 'VDD',     desc: 'Vendedores' },
      { name: 'ART',     desc: 'Articulos' },
      { name: 'ARTX',    desc: 'Articulos extendido' },
      { name: 'ARO',     desc: 'Articulos por almacen (stock)' },
      { name: 'ARA',     desc: 'Articulos / Tarifas (precio)' },
      { name: 'ALM',     desc: 'Almacenes' },
      { name: 'TRF',     desc: 'Tarifas' },
      { name: 'FAM',     desc: 'Familias' },
      { name: 'PRD',     desc: 'Promociones / descuentos' },
      { name: 'STA',     desc: 'Stock por articulo' },
      { name: 'LINDTO',  desc: 'Lineas vendidas (analytics)' },
    ],
    javier: [
      { name: 'PEDIDOS_CAB',           desc: 'Cabecera pedido (mirror de CPC)' },
      { name: 'PEDIDOS_LIN',           desc: 'Linea pedido (mirror de LPC)' },
      { name: 'PEDIDOS_SEQ',           desc: 'Secuencia numero pedido' },
      { name: 'PEDIDOS_STOCK_RESERVE', desc: 'Reserva de stock pedidos' },
    ],
    pairs: [
      { javier: 'PEDIDOS_CAB', dsedac: 'CPC' },
      { javier: 'PEDIDOS_LIN', dsedac: 'LPC' },
    ],
  },

  {
    feature: 'COBROS (comercial + repartidor - cobro en rutero)',
    dsedac: [
      { name: 'CRC',  desc: 'Cab.recibos PDA (destino final cobro)' },
      { name: 'CRCA', desc: 'Cab.registro cobro albaranes (aplicacion a albaran)' },
      { name: 'CVC',  desc: 'Cab.vencimientos cobros (deuda viva)' },
      { name: 'CVL',  desc: 'Cartera vencimientos - Lineas' },
      { name: 'CNA',  desc: 'Canales de cobros y pagos' },
      { name: 'CFC',  desc: 'Cab.facturas cliente' },
      { name: 'LFC',  desc: 'Lin.facturas cliente' },
      { name: 'CLI',  desc: 'Clientes' },
      { name: 'CLC',  desc: 'Cliente: tarifas / pago' },
      { name: 'CLP',  desc: 'Cliente: riesgo / vendedor cobro' },
      { name: 'CLX',  desc: 'Cliente: extendido' },
    ],
    javier: [
      { name: 'COBROS',                desc: 'Cobro comercial (mirror de CRC)' },
      { name: 'REPARTIDOR_COBROS',     desc: 'Cobro repartidor (mirror de CRCA)' },
      { name: 'REPARTIDOR_COBROS_AUDIT', desc: 'Audit log eventos cobro' },
      { name: 'PAYMENT_CONDITIONS',    desc: 'Condiciones de pago' },
    ],
    pairs: [
      { javier: 'COBROS',            dsedac: 'CRC' },
      { javier: 'REPARTIDOR_COBROS', dsedac: 'CRCA' },
    ],
  },

  {
    feature: 'LIQUIDACION DIARIA (repartidor cierra caja del dia)',
    dsedac: [
      { name: 'CLV', desc: 'Cuenta Liquidacion Vendedor (destino final liquidacion)' },
    ],
    javier: [
      { name: 'LQD',                          desc: 'Liquidacion legacy' },
      { name: 'LQD_LIQUIDACIONES',            desc: 'Liquidaciones agregadas' },
      { name: 'LQD_IDEMPOTENCY',              desc: 'Tokens idempotencia liquidacion' },
      { name: 'LQD_COMMISSION_TIERS',         desc: 'Tramos de comision' },
      { name: 'REPARTIDOR_LIQUIDACION_OPS',   desc: 'Operaciones liquidacion (mirror de CLV)' },
      { name: 'REPARTIDOR_LIQUIDACION_EMAILS', desc: 'Emails enviados de liquidacion' },
      { name: 'REPARTIDOR_FINANCIAL_BALANCES', desc: 'Balance financiero repartidor' },
      { name: 'CUENTAS_LIQUIDACION',          desc: 'Cuentas contables liquidacion' },
    ],
    pairs: [
      { javier: 'REPARTIDOR_LIQUIDACION_OPS', dsedac: 'CLV' },
      { javier: 'LQD_LIQUIDACIONES',          dsedac: 'CLV' },
    ],
  },

  {
    feature: 'ENTREGAS / RUTERO (repartidor entrega y firma)',
    dsedac: [
      { name: 'CAC', desc: 'Cab.albaranes cliente' },
      { name: 'LAC', desc: 'Lin.albaranes cliente' },
    ],
    javier: [
      { name: 'DELIVERY_STATUS',            desc: 'Estado entrega + firma' },
      { name: 'CLIENT_SIGNERS',             desc: 'Firmantes autorizados cliente' },
      { name: 'REPARTIDOR_ENTREGAS',        desc: 'Entrega registrada' },
      { name: 'REPARTIDOR_ENTREGA_LINEAS',  desc: 'Lineas de la entrega' },
      { name: 'REPARTIDOR_FIRMAS',          desc: 'Firmas digitalizadas' },
      { name: 'RUTERO_CONFIG',              desc: 'Asignacion de clientes a rutas' },
      { name: 'RUTERO_LOG',                 desc: 'Log de cambios rutero' },
    ],
    pairs: [
      { javier: 'REPARTIDOR_ENTREGAS',        dsedac: 'CAC' },
      { javier: 'REPARTIDOR_ENTREGA_LINEAS',  dsedac: 'LAC' },
    ],
  },

  {
    feature: 'BOLSA COMERCIAL (JAVIER por diseno - NO necesita mirror DSEDAC)',
    dsedac: [],
    javier: [
      { name: 'BOLSA_COMERCIAL',   desc: 'Saldo mensual por vendedor (JAVIER only)' },
      { name: 'MOVIMIENTOS_BOLSA', desc: 'Movimientos de la bolsa' },
    ],
    pairs: [],
  },
];

// Vistas JAVIER del scope (definicion textual util para auditoria)
const JAVIER_VIEWS = [
  'V_DIM_CLIENTE',
  'V_DIM_CLIENTE_EXT',
  'V_DIM_ARTICULO',
  'V_DIM_VENDEDOR',
  'V_DIM_VENDEDOR_EXT',
  'V_FACT_VENTAS',
  'V_COBROS_MOROSIDAD',
  'V_COBROS_POR_FACTURA',
  'V_ENTREGAS_HOY',
  'V_COMISIONES_REPARTIDOR',
  'V_CRUT',
  'V_STG_LAC',
  'V_STG_LFC_TAX_DOC',
  'V_MEDIOS_POWERBI',
];

// ---------------------------------------------------------------------------
function connectionString() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || 'JAVIER';
  const pwd = process.env.ODBC_PWD || 'JAVIER';
  return [
    `DSN=${dsn}`,
    `UID=${uid}`,
    `PWD=${pwd}`,
    'NAM=1',
    'CCSID=1208',
    'CMPTDM=1',
    `CPTOUT=${process.env.ODBC_TIMEOUT || 60}`,
    `COMMTIMEOUT=${process.env.ODBC_COMM_TIMEOUT || 90}`,
    `DBQ=${dsn}`,
  ].join(';');
}

async function safeQuery(conn, sql, params = []) {
  try {
    const rows = await conn.query(sql, params);
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function fetchColumns(conn, schema, table) {
  return safeQuery(conn, `
    SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [schema, table]);
}

async function fetchCount(conn, schema, table) {
  return safeQuery(conn, `SELECT COUNT(*) AS N FROM ${schema}.${table} FETCH FIRST 1 ROW ONLY`);
}

async function fetchSample(conn, schema, table) {
  return safeQuery(conn, `SELECT * FROM ${schema}.${table} FETCH FIRST 3 ROWS ONLY`);
}

async function fetchViewText(conn, schema, view) {
  return safeQuery(conn, `
    SELECT VIEW_DEFINITION
    FROM QSYS2.SYSVIEWS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
  `, [schema, view]);
}

async function describeTable(conn, schema, table, desc) {
  const out = [`#### ${schema}.${table} - ${desc || ''}`, ''];

  const cols = await fetchColumns(conn, schema, table);
  if (!cols.ok) {
    out.push(`> ERROR consultando columnas: ${cols.error}`, '');
    return { md: out.join('\n'), exists: false, columns: null };
  }
  if (!cols.rows.length) {
    out.push(`> Tabla **NO EXISTE** en ${schema} (o sin permisos)`, '');
    return { md: out.join('\n'), exists: false, columns: null };
  }

  out.push('| # | Columna | Tipo | Long | Esc | Null | Texto |');
  out.push('|---|---------|------|------|-----|------|-------|');
  cols.rows.forEach((c, i) => {
    const len = c.LENGTH != null ? c.LENGTH : '';
    const scale = c.NUMERIC_SCALE != null ? c.NUMERIC_SCALE : '';
    const text = (c.COLUMN_TEXT || '').toString().trim().replace(/\|/g, '/');
    out.push(`| ${i + 1} | ${c.COLUMN_NAME} | ${c.DATA_TYPE} | ${len} | ${scale} | ${c.IS_NULLABLE} | ${text} |`);
  });
  out.push('');

  const count = await fetchCount(conn, schema, table);
  if (count.ok && count.rows.length) {
    out.push(`**Filas:** ${count.rows[0].N}`, '');
  }

  const sample = await fetchSample(conn, schema, table);
  if (sample.ok && sample.rows.length) {
    const json = JSON.stringify(sample.rows, null, 2).slice(0, 4000);
    out.push('<details><summary>Sample (3 filas)</summary>', '', '```json', json, '```', '', '</details>', '');
  }

  return { md: out.join('\n'), exists: true, columns: cols.rows };
}

function buildColumnDiff(label, javierCols, dsedacCols) {
  const out = [`#### Diff ${label}`, ''];
  if (!javierCols || !dsedacCols) {
    out.push('> No se puede comparar (alguna tabla no existe)', '');
    return out.join('\n');
  }

  const jvMap = new Map(javierCols.map(c => [c.COLUMN_NAME, c]));
  const dsMap = new Map(dsedacCols.map(c => [c.COLUMN_NAME, c]));

  const onlyJavier = [...jvMap.keys()].filter(k => !dsMap.has(k));
  const onlyDsedac = [...dsMap.keys()].filter(k => !jvMap.has(k));
  const both = [...jvMap.keys()].filter(k => dsMap.has(k));

  out.push(`- Columnas en AMBOS: ${both.length}`);
  out.push(`- Solo en JAVIER: ${onlyJavier.length}`);
  out.push(`- Solo en DSEDAC: ${onlyDsedac.length}`);
  out.push('');

  if (onlyJavier.length) {
    out.push('**Solo JAVIER (sobran o son metadata local: SYNC_STATUS, CREATED_AT, etc.):**');
    onlyJavier.forEach(n => out.push(`  - ${n} (${jvMap.get(n).DATA_TYPE})`));
    out.push('');
  }
  if (onlyDsedac.length) {
    out.push('**Solo DSEDAC (FALTAN en JAVIER - hay que anadirlas para mirror 1:1):**');
    onlyDsedac.forEach(n => out.push(`  - ${n} (${dsMap.get(n).DATA_TYPE} len=${dsMap.get(n).LENGTH})`));
    out.push('');
  }

  const typeMismatches = both.filter(n => {
    const j = jvMap.get(n);
    const d = dsMap.get(n);
    return j.DATA_TYPE !== d.DATA_TYPE
        || (j.LENGTH || 0) !== (d.LENGTH || 0)
        || (j.NUMERIC_SCALE || 0) !== (d.NUMERIC_SCALE || 0);
  });
  if (typeMismatches.length) {
    out.push('**Tipo distinto (revisar - puede romper INSERT):**');
    out.push('| Columna | JAVIER | DSEDAC |');
    out.push('|---------|--------|--------|');
    typeMismatches.forEach(n => {
      const j = jvMap.get(n);
      const d = dsMap.get(n);
      out.push(`| ${n} | ${j.DATA_TYPE}(${j.LENGTH || ''},${j.NUMERIC_SCALE || ''}) | ${d.DATA_TYPE}(${d.LENGTH || ''},${d.NUMERIC_SCALE || ''}) |`);
    });
    out.push('');
  }
  return out.join('\n');
}

(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const conn = await odbc.connect(connectionString());

  const md = [];
  md.push('# ERP <-> JAVIER - Inventario completo (Pedidos + Cobros + Liquidacion + Entregas)');
  md.push('');
  md.push(`Generado: ${new Date().toISOString()}`);
  md.push('');
  md.push('Objetivo: que JAVIER sea mirror 1:1 de DSEDAC para que los datos generados por la app fluyan al ERP sin transformaciones. **EXCEPTO** Bolsa Comercial (JAVIER por diseno).');
  md.push('');
  md.push('---');
  md.push('');

  for (const group of SCOPE) {
    md.push(`## ${group.feature}`);
    md.push('');

    // Cache de columnas para diff posterior
    const colsCache = new Map();

    if (group.dsedac.length) {
      md.push('### Tablas DSEDAC (produccion - destino final)');
      md.push('');
      for (const t of group.dsedac) {
        process.stdout.write(`  DSEDAC.${t.name}... `);
        const r = await describeTable(conn, 'DSEDAC', t.name, t.desc);
        md.push(r.md);
        colsCache.set(`DSEDAC.${t.name}`, r.columns);
        process.stdout.write(r.exists ? 'OK\n' : 'NO EXISTE\n');
      }
    }

    if (group.javier.length) {
      md.push('### Tablas JAVIER (mirror local)');
      md.push('');
      for (const t of group.javier) {
        process.stdout.write(`  JAVIER.${t.name}... `);
        const r = await describeTable(conn, 'JAVIER', t.name, t.desc);
        md.push(r.md);
        colsCache.set(`JAVIER.${t.name}`, r.columns);
        process.stdout.write(r.exists ? 'OK\n' : 'NO EXISTE\n');
      }
    }

    if (group.pairs.length) {
      md.push('### Diffs JAVIER <-> DSEDAC (alineacion necesaria)');
      md.push('');
      for (const p of group.pairs) {
        const jv = colsCache.get(`JAVIER.${p.javier}`);
        const ds = colsCache.get(`DSEDAC.${p.dsedac}`);
        md.push(buildColumnDiff(`JAVIER.${p.javier} <-> DSEDAC.${p.dsedac}`, jv, ds));
      }
    }

    md.push('---');
    md.push('');
  }

  md.push('## Vistas JAVIER (definicion textual)');
  md.push('');
  for (const v of JAVIER_VIEWS) {
    process.stdout.write(`  VIEW JAVIER.${v}... `);
    const r = await fetchViewText(conn, 'JAVIER', v);
    md.push(`### JAVIER.${v}`, '');
    if (!r.ok) {
      md.push(`> ERROR: ${r.error}`, '');
      process.stdout.write('FAIL\n');
      continue;
    }
    if (!r.rows.length) {
      md.push(`> Vista no existe en JAVIER`, '');
      process.stdout.write('NO EXISTE\n');
      continue;
    }
    const def = (r.rows[0].VIEW_DEFINITION || '').toString().slice(0, 4000);
    md.push('```sql', def, '```', '');
    process.stdout.write('OK\n');
  }

  await conn.close();
  await fs.writeFile(OUTPUT_FILE, md.join('\n'), 'utf8');
  console.log(`\nInforme guardado en: ${OUTPUT_FILE}`);
})().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
