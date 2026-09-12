'use strict';

/**
 * Read-only evidence for perfil REPARTIDOR overlay/mail.
 * Writes nothing to DSEDAC. Prints no emails or tokens.
 */
const path = require('path');
const { loadEnv } = require('../config/load-env');
loadEnv(path.join(__dirname, '..'));

const { initDb, closePool, queryWithParams } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const {
  PRODUCT_DELIVERY_CC_ROLES,
  parseNameMatch,
  resolveVendorByNameMatch,
  resolveVendorProfile,
} = require('../services/staff-email-directory-service');

function cell(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}

function text(value) {
  return String(value ?? '').trim();
}

async function main() {
  await initDb();
  const runtime = resolveRepartoRuntime({
    ...process.env,
    REPARTO_TABLE_SET: process.env.REPARTO_TABLE_SET || 'isolated_test',
    REPARTO_ENVIRONMENT: process.env.REPARTO_ENVIRONMENT || 'test',
  });
  const confirmations = runtime.tables?.confirmation?.confirmations
    || 'JAVIER.TEST_REPARTO_CONFIRMACIONES';
  const lines = runtime.tables?.confirmation?.lines
    || 'JAVIER.TEST_REPARTO_LINEAS';
  if (!confirmations.startsWith('JAVIER.TEST_') || !lines.startsWith('JAVIER.TEST_')) {
    throw new Error('live verify refused a non-TEST confirmation mapping');
  }
  const evidence = {
    tableSet: runtime.tableSet || 'isolated_test',
    runtimeValid: runtime.valid === true,
    writesEnabled: runtime.writesEnabled,
    productionWritesEnabled: runtime.productionWritesEnabled,
    overlayByDocument: true,
    ccRoles: PRODUCT_DELIVERY_CC_ROLES,
  };

  const recent = await queryWithParams(
    `SELECT TRIM(C.DOCUMENT_ID) AS DOCUMENT_ID,
            TRIM(C.STATUS) AS STATUS,
            C.ID,
            C.CONFIRMED_AT,
            (SELECT COALESCE(SUM(L.CANTIDAD_ENTREGADA * COALESCE(L.PRECIO_UNITARIO, 0)), 0)
               FROM ${lines} L WHERE L.CONFIRMACION_ID = C.ID) AS IMPORTE_ENTREGADO
       FROM ${confirmations} C
      ORDER BY C.CONFIRMED_AT DESC
      FETCH FIRST 8 ROWS ONLY`,
    [],
  );

  evidence.recentConfirmations = (recent || []).map((row) => ({
    id: Number(cell(row, 'ID')) || null,
    status: text(cell(row, 'STATUS')),
    importeEntregado: Number(cell(row, 'IMPORTE_ENTREGADO')),
    hasDocumentId: Boolean(text(cell(row, 'DOCUMENT_ID'))),
  }));

  const firstId = text(cell((recent || [])[0], 'DOCUMENT_ID'));
  if (firstId) {
    const overlay = await queryWithParams(
      `SELECT TRIM(C.DOCUMENT_ID) AS DOCUMENT_ID,
              TRIM(C.STATUS) AS STATUS,
              (SELECT COALESCE(SUM(L.CANTIDAD_ENTREGADA * COALESCE(L.PRECIO_UNITARIO, 0)), 0)
                 FROM ${lines} L WHERE L.CONFIRMACION_ID = C.ID) AS IMPORTE_ENTREGADO
         FROM ${confirmations} C
        WHERE TRIM(C.DOCUMENT_ID) = ?
        FETCH FIRST 2 ROWS ONLY`,
      [firstId],
    );
    evidence.getAfterPost = {
      found: (overlay || []).length >= 1,
      status: text(cell((overlay || [])[0], 'STATUS')),
      importeEntregado: Number(cell((overlay || [])[0], 'IMPORTE_ENTREGADO')),
      stillDelivered: ['ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO']
        .includes(text(cell((overlay || [])[0], 'STATUS'))),
    };
  }

  try {
    const roleRows = await queryWithParams(
      `SELECT TRIM(ROLE_KEY) AS ROLE_KEY,
              TRIM(VENDOR_CODE) AS VENDOR_CODE,
              TRIM(NAME_MATCH) AS NAME_MATCH
         FROM JAVIER.TEST_NOTIFICATION_ROLE_TARGETS
        WHERE ACTIVE = 'S'
          AND TRIM(ROLE_KEY) IN (?, ?)`,
      ['CARLOS_CORBALAN', 'JAVIER_LACAL'],
    );
    evidence.staffRoles = [];
    for (const row of roleRows || []) {
      const roleKey = text(cell(row, 'ROLE_KEY')).toUpperCase();
      const vendorCode = text(cell(row, 'VENDOR_CODE'));
      const nameMatch = text(cell(row, 'NAME_MATCH'));
      const parsed = parseNameMatch(nameMatch);
      const coerced = roleKey === 'CARLOS_CORBALAN'
        && parsed.token === 'CARLOS'
        && !parsed.requireName
        ? 'CORBALAN'
        : parsed.token;
      let resolvedVia = null;
      let profile = null;
      if (coerced) {
        profile = await resolveVendorByNameMatch(coerced, { query: queryWithParams });
        if (profile) resolvedVia = 'NAME_MATCH';
      }
      if (!profile && vendorCode) {
        profile = await resolveVendorProfile(vendorCode, { query: queryWithParams });
        resolvedVia = 'VENDOR_CODE';
      }
      evidence.staffRoles.push({
        roleKey,
        present: Boolean(profile?.email),
        resolvedVia,
        nameMatch: nameMatch || null,
      });
    }
  } catch (error) {
    evidence.staffRolesError = error.message;
  }

  try {
    const talonCols = await queryWithParams(
      `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'TEST_REPARTIDOR_COBROS'
          AND COLUMN_NAME IN ('NUMEROTALON','CODIGOENTIDADBANCARIA','NOMBREENTIDADBANCARIA','DIAVENCIMIENTO','MESVENCIMIENTO','ANOVENCIMIENTO')
        ORDER BY COLUMN_NAME`,
      [],
    );
    evidence.talonColumns = (talonCols || []).map((row) => text(cell(row, 'COLUMN_NAME')));
  } catch (error) {
    evidence.talonColumnsError = error.message;
  }

  try {
    const outbox = await queryWithParams(
      `SELECT STATUS, PAYLOAD_JSON
         FROM JAVIER.TEST_REPARTO_VARIANCE_OUTBOX
        ORDER BY CREATED_AT DESC
        FETCH FIRST 3 ROWS ONLY`,
      [],
    );
    evidence.outbox = (outbox || []).map((row) => {
      let payload = {};
      try {
        payload = JSON.parse(text(cell(row, 'PAYLOAD_JSON')) || '{}');
      } catch (_) {
        payload = {};
      }
      const recipients = payload.recipients || {};
      return {
        status: text(cell(row, 'STATUS')),
        toRoles: (recipients.to || []).map((item) => item.role).filter(Boolean),
        ccRoles: (recipients.cc || []).map((item) => item.role).filter(Boolean),
      };
    });
  } catch (error) {
    evidence.outboxError = error.message;
  }

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
