// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-fix | _-scratch gitignored; fix puntual rol corbalan | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
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
        `UPDATE ${table} SET NAME_MATCH = ? WHERE ROLE_KEY = ?`,
        ['!CORBALAN', 'CARLOS_CORBALAN'],
      );
      await queryWithParams(
        `UPDATE ${table} SET NAME_MATCH = ? WHERE ROLE_KEY = ?`,
        ['LACAL', 'JAVIER_LACAL'],
      );
    }
    const rows = await query(
      'SELECT ROLE_KEY, VENDOR_CODE, NAME_MATCH FROM JAVIER.NOTIFICATION_ROLE_TARGETS ORDER BY ROLE_KEY',
    );
    console.log('ROLES', JSON.stringify(rows));

    clearCache();
    console.log('LACAL', (await resolveVendorEmail('A2')) ? 'SET' : 'EMPTY');
    const roles = await resolveRoleEmails(['JAVIER_LACAL', 'CARLOS_CORBALAN', 'OFICINA']);
    console.log(JSON.stringify(roles.map((r) => ({
      role: r.roleKey,
      code: r.vendorCode,
      via: r.resolvedVia,
      nombre: r.nombre,
      email: r.email ? 'SET' : 'EMPTY',
    }))));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
