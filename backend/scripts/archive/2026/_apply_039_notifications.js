// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-apply-039 | _-scratch gitignored; aplicacion puntual migracion 039 notificaciones | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDb, closePool, query, queryWithParams } = require('../config/db');

async function exec(sql, label) {
  try {
    await query(sql);
    console.log('OK', label);
    return true;
  } catch (error) {
    const msg = (error.odbcErrors && error.odbcErrors[0]?.message) || error.message;
    if (/SQL0601|already exists|ya existe/i.test(msg)) {
      console.log('SKIP exists', label);
      return false;
    }
    console.error('FAIL', label, msg);
    throw error;
  }
}

async function main() {
  await initDb();
  try {
    await exec(
      `CREATE TABLE JAVIER.TEST_NOTIFICATION_ROLE_TARGETS (
        ROLE_KEY VARCHAR(40) NOT NULL,
        VENDOR_CODE CHAR(2) NOT NULL,
        NAME_MATCH VARCHAR(80),
        ACTIVE CHAR(1) NOT NULL DEFAULT 'S',
        NOTES VARCHAR(200),
        UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
        PRIMARY KEY (ROLE_KEY)
      )`,
      'TEST_NOTIFICATION_ROLE_TARGETS'
    );
    await exec(
      `CREATE TABLE JAVIER.NOTIFICATION_ROLE_TARGETS (
        ROLE_KEY VARCHAR(40) NOT NULL,
        VENDOR_CODE CHAR(2) NOT NULL,
        NAME_MATCH VARCHAR(80),
        ACTIVE CHAR(1) NOT NULL DEFAULT 'S',
        NOTES VARCHAR(200),
        UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
        PRIMARY KEY (ROLE_KEY)
      )`,
      'NOTIFICATION_ROLE_TARGETS'
    );
    await exec(
      `CREATE TABLE JAVIER.TEST_REPARTO_VARIANCE_OUTBOX (
        ID BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1),
        CONFIRMATION_ID BIGINT NOT NULL,
        DOCUMENT_ID VARCHAR(80) NOT NULL,
        REPARTIDOR_ID VARCHAR(10) NOT NULL,
        COMERCIAL_CODE CHAR(2),
        PAYLOAD_JSON CLOB(32K) NOT NULL,
        STATUS VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
        SENT_AT TIMESTAMP,
        ERROR VARCHAR(500),
        DIGEST_INCLUDED CHAR(1) NOT NULL DEFAULT 'N',
        PRIMARY KEY (ID)
      )`,
      'TEST_REPARTO_VARIANCE_OUTBOX'
    );
    await exec(
      `CREATE TABLE JAVIER.REPARTO_VARIANCE_OUTBOX (
        ID BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1),
        CONFIRMATION_ID BIGINT NOT NULL,
        DOCUMENT_ID VARCHAR(80) NOT NULL,
        REPARTIDOR_ID VARCHAR(10) NOT NULL,
        COMERCIAL_CODE CHAR(2),
        PAYLOAD_JSON CLOB(32K) NOT NULL,
        STATUS VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT TIMESTAMP,
        SENT_AT TIMESTAMP,
        ERROR VARCHAR(500),
        DIGEST_INCLUDED CHAR(1) NOT NULL DEFAULT 'N',
        PRIMARY KEY (ID)
      )`,
      'REPARTO_VARIANCE_OUTBOX'
    );

    for (const [label, sql] of [
      ['IX_TEST_VAR_STATUS', 'CREATE INDEX JAVIER.IX_TEST_VAR_OUTBOX_STATUS ON JAVIER.TEST_REPARTO_VARIANCE_OUTBOX (STATUS, CREATED_AT)'],
      ['IX_TEST_VAR_DIGEST', 'CREATE INDEX JAVIER.IX_TEST_VAR_OUTBOX_DIGEST ON JAVIER.TEST_REPARTO_VARIANCE_OUTBOX (DIGEST_INCLUDED, CREATED_AT)'],
      ['IX_VAR_STATUS', 'CREATE INDEX JAVIER.IX_VAR_OUTBOX_STATUS ON JAVIER.REPARTO_VARIANCE_OUTBOX (STATUS, CREATED_AT)'],
      ['IX_VAR_DIGEST', 'CREATE INDEX JAVIER.IX_VAR_OUTBOX_DIGEST ON JAVIER.REPARTO_VARIANCE_OUTBOX (DIGEST_INCLUDED, CREATED_AT)'],
    ]) {
      await exec(sql, label);
    }

    const seeds = [
      ['JAVIER_LACAL', 'A2', 'LACAL', 'Javier Lacal'],
      ['CARLOS_CORBALAN', '30', 'CARLOS', 'Carlos (oficina/comercial)'],
      ['OFICINA', '32', 'PEDIDOS', 'Oficina pedidos'],
    ];

    for (const table of [
      'JAVIER.NOTIFICATION_ROLE_TARGETS',
      'JAVIER.TEST_NOTIFICATION_ROLE_TARGETS',
    ]) {
      for (const [role, code, match, notes] of seeds) {
        const existing = await queryWithParams(
          `SELECT ROLE_KEY FROM ${table} WHERE ROLE_KEY = ?`,
          [role]
        );
        if (existing.length) {
          await queryWithParams(
            `UPDATE ${table}
             SET VENDOR_CODE = ?, NAME_MATCH = ?, ACTIVE = 'S', NOTES = ?
             WHERE ROLE_KEY = ?`,
            [code, match, notes, role]
          );
          console.log('SEED UPDATE', table, role);
        } else {
          await queryWithParams(
            `INSERT INTO ${table} (ROLE_KEY, VENDOR_CODE, NAME_MATCH, ACTIVE, NOTES)
             VALUES (?, ?, ?, 'S', ?)`,
            [role, code, match, notes]
          );
          console.log('SEED INSERT', table, role);
        }
      }
    }

    const roles = await query(
      `SELECT ROLE_KEY, VENDOR_CODE, ACTIVE FROM JAVIER.NOTIFICATION_ROLE_TARGETS ORDER BY ROLE_KEY`
    );
    console.log('ROLES', JSON.stringify(roles));

    const status = await query(`
      SELECT T.ROLE_KEY, TRIM(T.VENDOR_CODE) AS VENDOR_CODE,
             CASE WHEN NULLIF(TRIM(X.CORREOELECTRONICO),'') IS NULL THEN 'EMPTY' ELSE 'SET' END AS EMAIL
      FROM JAVIER.NOTIFICATION_ROLE_TARGETS T
      LEFT JOIN DSEDAC.VDDX X ON TRIM(T.VENDOR_CODE) = TRIM(X.CODIGOVENDEDOR)
      ORDER BY T.ROLE_KEY
    `);
    console.log('EMAIL_STATUS', JSON.stringify(status));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
