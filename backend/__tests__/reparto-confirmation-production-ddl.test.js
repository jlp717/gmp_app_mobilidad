'use strict';

const fs = require('fs');
const path = require('path');
const { TABLE_MAPPINGS, resolveRepartoRuntime, validateConfirmationTableMapping } = require('../config/reparto-runtime');

describe('production reparto confirmation contract', () => {
  test('maps only the approved JAVIER production ledger and rejects DSEDAC aliases', () => {
    const runtime = resolveRepartoRuntime({
      NODE_ENV: 'production', REPARTO_ENVIRONMENT: 'production', REPARTO_TABLE_SET: 'production',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24', ODBC_DSN: 'GMP', REPARTO_WRITES_ENABLED: 'false',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER', REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    });
    expect(runtime.valid).toBe(true);
    expect(runtime.tables.confirmation).toEqual(TABLE_MAPPINGS.production.confirmation);
    expect(Object.values(runtime.tables.confirmation).every((value) => value.startsWith('JAVIER.REPARTO_'))).toBe(true);
    expect(validateConfirmationTableMapping({ ...runtime, tables: { ...runtime.tables, confirmation: { ...runtime.tables.confirmation, evidences: 'DSEDAC.REPARTO_EVIDENCIAS' } } }).valid).toBe(false);
  });

  test('contains additive, non-executed production DDL without DSEDAC targets', () => {
    const ddl = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sql', '036_reparto_confirmation_production_tables.sql'), 'utf8');
    expect(ddl).toContain('NOT EXECUTED');
    expect(ddl.replace(/^--.*$/gm, '')).not.toContain('DSEDAC.');
    for (const table of ['REPARTO_CONFIRMACIONES', 'REPARTO_LINEAS', 'REPARTO_EVIDENCIAS', 'REPARTO_CONFIRM_EVIDENCIAS']) {
      expect(ddl).toContain(`JAVIER.${table}`);
    }
    for (const invariant of ['IDEMPOTENCY_KEY', 'PAYLOAD_FINGERPRINT', 'DOCUMENTO_XDE', 'DOCUMENTO_DEX', 'EXPIRES_AT', 'IX_REP_EVIDENCE_EXPIRY', 'CK_REP_LINEAS_TOTAL', 'FK_REP_CONFIRM_SIGNATURE']) {
      expect(ddl).toContain(invariant);
    }
  });

  test('keeps production and isolated-test receiver-name capacity at the same 100-character contract limit', () => {
    const productionDdl = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sql', '036_reparto_confirmation_production_tables.sql'), 'utf8');
    const testDdl = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sql', '033_reparto_confirmation_test_tables.sql'), 'utf8');
    const receiverName = /RECEPTOR_NOMBRE\s+VARCHAR\((\d+)\)/;

    expect(productionDdl.match(receiverName)?.[1]).toBe('100');
    expect(testDdl.match(receiverName)?.[1]).toBe('100');
  });
});
