'use strict';

const fs = require('fs');
const path = require('path');

const ddlPath = path.join(
  __dirname,
  '..',
  'scripts',
  'sql',
  '033_reparto_confirmation_test_tables.sql',
);

describe('isolated reparto confirmation DDL contract', () => {
  const ddl = fs.readFileSync(ddlPath, 'utf8');
  const executableSql = ddl
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  test('is test-only and cannot target the production ERP schema', () => {
    expect(ddl).toContain('NOT EXECUTED by this repository');
    expect(executableSql).not.toMatch(/\bDSEDAC\b/i);
    expect(executableSql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/im);
    expect(ddl).toMatch(/CREATE TABLE JAVIER\.TEST_REPARTO_CONFIRMACIONES\b/);
    expect(ddl).toMatch(/CREATE TABLE JAVIER\.TEST_REPARTO_EVIDENCIAS\b/);
    expect(ddl).toMatch(/DOCUMENTO_XDE\s+INTEGER/);
    expect(ddl).toMatch(/DOCUMENTO_DEX\s+INTEGER/);
    expect(executableSql).not.toMatch(/\bTEST_REPARTO_COBROS\b/);
  });

  test('keeps DB2 evidence capacity aligned with the 4 MiB API limit', () => {
    expect(ddl).toMatch(/CONTENT_BLOB\s+BLOB\(4M\)\s+NOT NULL/);
    expect(ddl).toMatch(/CONTENT_BYTES BETWEEN 1 AND 4194304/);
    expect(ddl).not.toMatch(/BLOB\(5M\)|5242880/);
  });

  test('keeps the persisted receiver name capacity aligned with the 100-character API contract', () => {
    expect(ddl).toMatch(/RECEPTOR_NOMBRE\s+VARCHAR\(100\)/);
    expect(ddl).not.toMatch(/RECEPTOR_NOMBRE\s+VARCHAR\(80\)/);
  });

  test('persists a bounded pending-evidence expiry and clears it when linked', () => {
    expect(ddl).toMatch(/EXPIRES_AT\s+TIMESTAMP/);
    expect(ddl).toMatch(/STATUS = 'PENDIENTE'[\s\S]*EXPIRES_AT IS NOT NULL/);
    expect(ddl).toMatch(/STATUS = 'ENLAZADA'[\s\S]*EXPIRES_AT IS NULL/);
    expect(ddl).toMatch(/IX_TEST_REP_EVIDENCE_EXPIRY[\s\S]*STATUS, EXPIRES_AT, EVIDENCE_ID/);
  });
});
