// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual probe diego98 | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Live E2E: Diego 98 claims + TEST vs production column contract.
 * Never prints PIN, SMTP password, or full email addresses.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, queryWithParams } = require('../config/db');
const { Db2AuthRepository } = require('../src/modules/auth');
const { createAuthClaimsResolver } = require('../src/modules/auth/application/auth-claims-resolver');
const { TABLE_MAPPINGS, resolveRepartoRuntime } = require('../config/reparto-runtime');
const {
  resolveDeliveryVarianceRecipients,
  resolveLiquidacionRecipients,
  VARIANCE_ROLE_KEYS,
  LIQUIDACION_ROLE_KEYS,
} = require('../services/staff-email-directory-service');

function maskEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const at = email.indexOf('@');
  if (at < 1) return email ? 'set' : null;
  return `${email[0]}***@${email.slice(at + 1)}`;
}

function flattenTables(mapping) {
  const out = [];
  for (const group of Object.values(mapping)) {
    for (const [key, qualified] of Object.entries(group)) {
      if (key.toLowerCase().includes('sequence') || String(qualified).endsWith('_SEQ')) continue;
      out.push(qualified);
    }
  }
  return out;
}

async function columns(schema, table) {
  const rows = await queryWithParams(
    `SELECT TRIM(COLUMN_NAME) AS C, TRIM(DATA_TYPE) AS T, LENGTH AS L, NUMERIC_SCALE AS S, TRIM(IS_NULLABLE) AS N
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return rows.map((row) => ({
    c: String(row.C || row.c || '').toUpperCase(),
    t: String(row.T || row.t || '').toUpperCase(),
    l: Number(row.L || row.l || 0),
    s: row.S == null && row.s == null ? null : Number(row.S ?? row.s),
    n: String(row.N || row.n || ''),
  }));
}

function colKey(col) {
  return `${col.c}|${col.t}|${col.l}|${col.s}|${col.n}`;
}

async function main() {
  await initDb();
  const report = { ok: true, claims: null, flags: null, schema: [], recipients: {}, runtime: null };

  try {
    const flags = await queryWithParams(
      `SELECT TRIM(CODIGOVENDEDOR) AS C,
              TRIM(JEFEVENTASSN) AS JEFE,
              TRIM(PERMITEREPARTOSN) AS REPARTO,
              TRIM(PERMITEPREVENTASN) AS PREVENTA
         FROM DSEDAC.VDDX
        WHERE TRIM(CODIGOVENDEDOR) = ?`,
      ['98'],
    );
    report.flags = flags[0] || null;

    const repo = new Db2AuthRepository();
    const resolver = createAuthClaimsResolver({ authRepository: repo });
    const claims = await resolver.resolve({ code: '98', selectedRole: 'REPARTIDOR' });
    report.claims = {
      name: claims.name,
      role: claims.role,
      activeMode: claims.activeMode,
      isJefeVentas: claims.isJefeVentas,
      isRepartidor: claims.isRepartidor,
      codigoConductor: claims.codigoConductor,
      availableRoles: claims.availableRoles,
      availableModes: claims.availableModes,
      vendorCount: claims.vendorCodes.length,
      hasOwnCode: claims.vendorCodes.includes('98'),
    };
    if (claims.role !== 'JEFE_VENTAS' || claims.activeMode !== 'REPARTIDOR' || claims.isRepartidor) {
      report.ok = false;
      report.claimsError = 'Diego 98 is not jefe supervision in Perfil Reparto';
    }

    const runtime = resolveRepartoRuntime(process.env);
    report.runtime = {
      valid: runtime.valid,
      environment: runtime.environment,
      tableSet: runtime.tableSet,
      writesEnabled: runtime.writesEnabled,
      errors: runtime.errors || [],
    };
    if (process.env.REPARTO_TABLE_SET
        && (!runtime.valid || runtime.tableSet !== 'isolated_test')) {
      report.ok = false;
    }

    const testTables = flattenTables(TABLE_MAPPINGS.isolated_test);
    const prodTables = flattenTables(TABLE_MAPPINGS.production);
    for (let i = 0; i < testTables.length; i += 1) {
      const testQ = testTables[i];
      const prodQ = prodTables[i];
      const [ts, tt] = testQ.split('.');
      const [ps, pt] = prodQ.split('.');
      let testCols = [];
      let prodCols = [];
      let error = null;
      try {
        testCols = await columns(ts, tt);
        prodCols = await columns(ps, pt);
      } catch (err) {
        error = String(err.message || err).slice(0, 180);
        report.ok = false;
      }
      const prodByName = new Map(prodCols.map((col) => [col.c, col]));
      const missingInProd = [];
      const typeMismatch = [];
      for (const col of testCols) {
        const prod = prodByName.get(col.c);
        if (!prod) {
          missingInProd.push(col.c);
          continue;
        }
        if (prod.t !== col.t || prod.l !== col.l || Number(prod.s) !== Number(col.s)) {
          const numericPair = new Set(['DECIMAL', 'NUMERIC']);
          const compatibleNumeric = numericPair.has(prod.t) && numericPair.has(col.t)
            && prod.l === col.l && Number(prod.s) === Number(col.s);
          if (!compatibleNumeric) {
            typeMismatch.push(`${col.c} test=${col.t}(${col.l},${col.s}) prod=${prod.t}(${prod.l},${prod.s})`);
          }
        }
      }
      const extraInProd = prodCols.filter((col) => !testCols.some((item) => item.c === col.c)).length;
      const row = {
        test: testQ,
        prod: prodQ,
        testCount: testCols.length,
        prodCount: prodCols.length,
        extraInProd,
        missingInProd,
        typeMismatch,
        error,
      };
      const dualSchema = tt === 'TEST_DELIVERY_STATUS';
      if (dualSchema) {
        row.note = 'production DELIVERY_STATUS is CPC-shaped; TEST is overlay; code detects old/new schema';
      }
      if (!dualSchema && (missingInProd.length || typeMismatch.length || error)) report.ok = false;
      report.schema.push(row);
    }

    const isolatedEnv = {
      ...process.env,
      NODE_ENV: 'test',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: process.env.REPARTO_EVIDENCE_PENDING_TTL_HOURS || '24',
      REPARTO_WRITES_ENABLED: 'false',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
      REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
      ODBC_DSN: process.env.ODBC_DSN || 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    };
    try {
      const variance = await resolveDeliveryVarianceRecipients(
        { repartidorId: '08', comercialCode: '15' },
        { env: isolatedEnv },
      );
      const liquidacion = await resolveLiquidacionRecipients(
        { repartidorId: '08', comercialCodes: ['15'] },
        { env: isolatedEnv },
      );
      report.recipients = {
        varianceRoles: [...VARIANCE_ROLE_KEYS],
        liquidacionRoles: [...LIQUIDACION_ROLE_KEYS],
        varianceEmails: variance.emails.map(maskEmail),
        varianceLabels: variance.details.map((d) => ({
          label: d.label,
          vendorCode: d.vendorCode,
          email: maskEmail(d.email),
        })),
        liquidacionEmails: liquidacion.emails.map(maskEmail),
        liquidacionLabels: liquidacion.details.map((d) => ({
          label: d.label,
          vendorCode: d.vendorCode,
          email: maskEmail(d.email),
        })),
      };
      if (variance.emails.length === 0) report.ok = false;
    } catch (err) {
      report.ok = false;
      report.recipientsError = String(err.message || err).slice(0, 200);
    }

    const targets = await queryWithParams(
      `SELECT TRIM(ROLE_KEY) AS ROLE_KEY, TRIM(VENDOR_CODE) AS VENDOR_CODE,
              TRIM(NAME_MATCH) AS NAME_MATCH, TRIM(ACTIVE) AS ACTIVE
         FROM JAVIER.TEST_NOTIFICATION_ROLE_TARGETS
        ORDER BY ROLE_KEY`,
      [],
    );
    report.roleTargets = (targets || []).map((row) => ({
      roleKey: row.ROLE_KEY || row.role_key,
      vendorCode: row.VENDOR_CODE || row.vendor_code,
      nameMatch: row.NAME_MATCH || row.name_match,
      active: row.ACTIVE || row.active,
    }));
  } catch (err) {
    report.ok = false;
    report.fatal = String(err && err.message || err).slice(0, 240);
  } finally {
    try { await closePool(); } catch (_) { /* ignore */ }
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(2);
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(1);
});
