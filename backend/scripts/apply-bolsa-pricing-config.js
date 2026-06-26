'use strict';

/**
 * DDL idempotente para la tabla de coste/margen/minimo de bolsa.
 *
 * Dry-run:
 *   node backend/scripts/apply-bolsa-pricing-config.js
 *
 * Aplicar en JAVIER:
 *   CONFIRM_BOLSA_PRICING_DDL=YES node backend/scripts/apply-bolsa-pricing-config.js --apply
 *
 * No crea tablas de precios especiales de cliente. Esos precios se leen desde
 * tablas ERP DSEDAC.PES/PPU en runtime.
 */

const { initDb, queryWithParams, closePool } = require('../config/db');

const APPLY = process.argv.includes('--apply');
const CONFIRMED = process.env.CONFIRM_BOLSA_PRICING_DDL === 'YES';

const ddl = {
  table: `
CREATE TABLE JAVIER.BOLSA_PRODUCTO_PRECIO (
    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    CODIGOARTICULO CHAR(10) NOT NULL,
    UNIDAD_BASE VARCHAR(12) DEFAULT 'CAJAS',
    FECHA_DESDE DATE NOT NULL,
    FECHA_HASTA DATE,
    COSTE_FABRICACION DECIMAL(11,4) DEFAULT 0,
    MARGEN_OBJETIVO_PCT DECIMAL(7,4) DEFAULT 20,
    PRECIO_MINIMO DECIMAL(11,4) DEFAULT 0,
    ACTIVO CHAR(1) DEFAULT 'S',
    SOURCE VARCHAR(40) DEFAULT 'MANUAL',
    OBSERVACIONES VARCHAR(200) DEFAULT '',
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,
  indexes: [
    {
      name: 'UQ_BPP_ART_UNIT_DATE',
      sql: `CREATE UNIQUE INDEX JAVIER.UQ_BPP_ART_UNIT_DATE
    ON JAVIER.BOLSA_PRODUCTO_PRECIO (CODIGOARTICULO, UNIDAD_BASE, FECHA_DESDE)`,
    },
    {
      name: 'IX_BPP_ACTIVE_LOOKUP',
      sql: `CREATE INDEX JAVIER.IX_BPP_ACTIVE_LOOKUP
    ON JAVIER.BOLSA_PRODUCTO_PRECIO (CODIGOARTICULO, ACTIVO, FECHA_DESDE, FECHA_HASTA)`,
    },
  ],
};

function requireApplyApproval() {
  if (APPLY && !CONFIRMED) {
    throw new Error('DDL bloqueado: usa CONFIRM_BOLSA_PRICING_DDL=YES junto con --apply');
  }
}

async function exists(sql, params) {
  const rows = await queryWithParams(sql, params, false, false);
  return Array.isArray(rows) && rows.length > 0;
}

async function main() {
  requireApplyApproval();
  await initDb();

  const actions = [];
  const tableExists = await exists(
    `SELECT 1 FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    ['JAVIER', 'BOLSA_PRODUCTO_PRECIO']
  );

  if (!tableExists) {
    actions.push({ type: 'CREATE_TABLE', name: 'JAVIER.BOLSA_PRODUCTO_PRECIO' });
    if (APPLY) await queryWithParams(ddl.table, [], false, false);
  }

  const indexResults = [];
  for (const index of ddl.indexes) {
    const indexExists = await exists(
      `SELECT 1 FROM QSYS2.SYSINDEXES WHERE INDEX_SCHEMA = ? AND INDEX_NAME = ?`,
      ['JAVIER', index.name]
    );
    if (!indexExists) {
      actions.push({ type: 'CREATE_INDEX', name: `JAVIER.${index.name}` });
      if (APPLY) await queryWithParams(index.sql, [], false, false);
      indexResults.push({ name: index.name, existed: false });
    } else {
      indexResults.push({ name: index.name, existed: true });
    }
  }

  const out = {
    mode: APPLY ? 'apply' : 'dry-run',
    tableExistedBefore: tableExists,
    indexes: indexResults,
    actions,
  };
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error(`[apply-bolsa-pricing-config] ERROR ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch (_) {
      // ignore close errors
    }
  });
