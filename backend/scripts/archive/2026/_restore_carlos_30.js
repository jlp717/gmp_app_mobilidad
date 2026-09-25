// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-restore | _-scratch gitignored; restauracion puntual caso carlos 30 | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { initDb, closePool, query, queryWithParams } = require('../config/db');
const { clearCache, resolveVendorEmail, resolveRoleEmails } = require('../services/staff-email-directory-service');

async function main() {
  await initDb();
  try {
    for (const table of [
      'JAVIER.NOTIFICATION_ROLE_TARGETS',
      'JAVIER.TEST_NOTIFICATION_ROLE_TARGETS',
    ]) {
      await queryWithParams(
        `UPDATE ${table}
            SET VENDOR_CODE = ?, NAME_MATCH = ?, NOTES = ?
          WHERE ROLE_KEY = ?`,
        ['30', 'CARLOS', 'Carlos Corbalan vendor 30', 'CARLOS_CORBALAN'],
      );
    }
    clearCache();
    const email = await resolveVendorEmail('30');
    console.log('CARLOS_30', email ? 'SET' : 'EMPTY');
    // Force env for isolated_test table names if needed
    process.env.REPARTO_ENVIRONMENT = process.env.REPARTO_ENVIRONMENT || 'staging';
    process.env.REPARTO_TABLE_SET = process.env.REPARTO_TABLE_SET || 'isolated_test';
    process.env.ODBC_DSN = process.env.ODBC_DSN || 'GMP';
    process.env.REPARTIDOR_FINANCE_READ_SCHEMA = 'JAVIER';
    process.env.REPARTIDOR_FINANCE_APP_SCHEMA = 'JAVIER';
    process.env.REPARTIDOR_FINANCE_ERP_SCHEMA = 'JAVIER';
    process.env.REPARTO_WRITES_ENABLED = 'false';
    process.env.REPARTO_PRODUCTION_WRITES_APPROVED = 'false';
    process.env.REPARTO_PRODUCTION_ERP_WRITES_APPROVED = 'false';
    process.env.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED = 'false';
    process.env.REPARTO_PRODUCTION_CONFIRMATION_APPROVED = 'false';
    process.env.REPARTO_FINANCE_DB2_CAPABILITY_APPROVED = 'false';
    process.env.REPARTO_EVIDENCE_PENDING_TTL_HOURS = '24';
    clearCache();
    const roles = await resolveRoleEmails(['CARLOS_CORBALAN', 'JAVIER_LACAL', 'OFICINA']);
    console.log(JSON.stringify(roles.map((r) => ({
      role: r.roleKey,
      code: r.vendorCode,
      via: r.resolvedVia,
      email: r.email ? 'SET' : 'EMPTY',
      nombre: r.nombre,
    }))));
    const rows = await query(
      `SELECT ROLE_KEY, VENDOR_CODE, NAME_MATCH FROM JAVIER.NOTIFICATION_ROLE_TARGETS ORDER BY ROLE_KEY`,
    );
    console.log('DB', JSON.stringify(rows));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
