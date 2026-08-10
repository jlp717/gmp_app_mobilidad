'use strict';

const fs = require('fs');
const path = require('path');

const sqlDirectory = path.join(__dirname, '..', 'scripts', 'sql');
const isolated = fs.readFileSync(path.join(sqlDirectory, '034_repartidor_finance_isolated_test_tables.sql'), 'utf8');
const verifier = fs.readFileSync(path.join(sqlDirectory, '035_verify_reparto_isolated_test_schema.sql'), 'utf8');
const production = fs.readFileSync(path.join(sqlDirectory, '037_repartidor_liquidacion_production_additive.sql'), 'utf8');

describe('canonical liquidation DDL contract', () => {
  test('isolated DDL is self-contained and creates explicit app-owned targets', () => {
    [
      'TEST_REPARTIDOR_COBROS', 'TEST_REPARTIDOR_COBROS_AUDIT',
      'TEST_REPARTIDOR_FINANCIAL_BALANCES', 'TEST_REPARTIDOR_LIQUIDACION_OPS',
      'TEST_REPARTIDOR_LIQUIDACION_GASTOS', 'TEST_REPARTIDOR_LIQUIDACION_AJUSTES',
      'TEST_REPARTIDOR_LIQUIDACION_INGRESOS', 'TEST_REPARTIDOR_LIQUIDACION_OUTBOX',
      'TEST_REPARTIDOR_LIQUIDACION_SEQ',
    ].forEach((object) => expect(isolated).toContain(`JAVIER.${object}`));
    expect(isolated).not.toMatch(/LIKE JAVIER\.(?:REPARTIDOR_COBROS|REPARTIDOR_COBROS_AUDIT|REPARTIDOR_FINANCIAL_BALANCES|REPARTIDOR_LIQUIDACION_OPS)/i);
    expect(isolated).toMatch(/CREATE TABLE JAVIER\.TEST_REPARTIDOR_COBROS\s*\(/i);
    expect(isolated).toMatch(/CREATE TABLE JAVIER\.TEST_REPARTIDOR_LIQUIDACION_OPS\s*\([\s\S]*REPLAY_IDENTITY_JSON CLOB\(8K\)[\s\S]*SNAPSHOT_JSON CLOB\(64K\)/i);
    expect(isolated).not.toMatch(/\b(?:DSEDAC|TEST_LQD|LQD)\b/i);
    expect(isolated).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP)\b/i);
    expect(isolated).not.toMatch(/(?:INSERT|UPDATE|MERGE|DELETE)\s+(?:INTO|FROM)?\s*DSEDAC/i);
    expect(isolated).toContain('IDMARCALIQUIDACION');
    expect(isolated).toMatch(
      /CODIGOVENDEDOR\s*,\s*DIALIQUIDACION\s*,\s*MESLIQUIDACION\s*,\s*ANOLIQUIDACION/,
    );
    expect(isolated).toContain('IF NOT EXISTS');
    expect(isolated).toContain('SIGNAL SQLSTATE');
    expect(isolated).toContain('STOP_TEST_TABLE_METADATA_MISMATCH');
    expect(isolated).toContain('STOP_TEST_INDEX_METADATA_MISMATCH');
    expect(isolated).toContain('STOP_TEST_SEQUENCE_METADATA_MISMATCH');
    ['IDEMPOTENCY_TOKEN VARCHAR(128) NOT NULL UNIQUE', 'STATUS VARCHAR(12)',
      'LIQUIDACION_ID BIGINT', 'LIQUIDACION_MARKER CHAR(30)',
      'ACTOR_ID VARCHAR(40)', 'ACTOR_ROLE VARCHAR(30)', 'OBSERVACION VARCHAR(250)']
      .forEach((column) => expect(isolated).toContain(column));
    expect(isolated).not.toMatch(/IDEMPOTENCY_KEY|CREATE OR REPLACE/i);
  });

  test('production DDL is additive, JAVIER-only and defines sequence/outbox/source tables', () => {
    expect(production).toContain('ADD COLUMN REPLAY_IDENTITY_JSON CLOB');
    expect(production).toContain('ADD COLUMN SNAPSHOT_JSON CLOB');
    expect(production).toContain('CREATE SEQUENCE JAVIER.REPARTIDOR_LIQUIDACION_SEQ');
    expect(production).toContain('CREATE UNIQUE INDEX JAVIER.UX_RLO_MARKER');
    expect(production).toContain('CREATE UNIQUE INDEX JAVIER.UX_RLO_REP_DAY');
    expect(production).not.toContain('UX_RLO_TOKEN');
    expect(production).toContain('QSYS2.SYSCOLUMNS2');
    expect(production).toContain('QSYS2.SYSINDEXES');
    expect(production).toContain('QSYS2.SYSSEQUENCES');
    expect(production).toContain('STOP_REPLAY_IDENTITY_JSON_MISMATCH');
    expect(production).toContain('IF NOT EXISTS');
    expect(production).toContain('STOP_PRODUCTION_TABLE_METADATA_MISMATCH');
    expect(production).toContain('STOP_PRODUCTION_INDEX_METADATA_MISMATCH');
    expect(production).toContain('IDEMPOTENCY_TOKEN VARCHAR(128) NOT NULL UNIQUE');
    expect(production).toContain("STATUS IN (''PENDING'', ''LIQUIDATED'')");
    expect(production).not.toMatch(/DSEDAC/i);
    expect(production).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP)\b/i);
  });

  test('read-only verifier compares full metadata, constraints, indexes and sequence', () => {
    [
      'QSYS2.SYSTABLES', 'QSYS2.SYSCOLUMNS2', 'QSYS2.SYSINDEXES',
      'QSYS2.SYSKEYS', 'QSYS2.SYSCST', 'QSYS2.SYSKEYCST', 'QSYS2.SYSSEQUENCES',
      'STOP_TARGET_MISSING', 'STOP_COLUMN_METADATA_DIFFERENT',
      'STOP_CONSTRAINT_SIGNATURE_DIFFERENT', 'STOP_INDEX_SIGNATURE_DIFFERENT',
      'STOP_EXTRA_CONSTRAINT_SIGNATURE', 'STOP_EXTRA_INDEX_SIGNATURE',
      'STOP_SEQUENCE_METADATA_DIFFERENT', 'COLUMN_DEFAULT', 'IS_IDENTITY',
      'STOP_REQUIRED_COLUMN_MISSING', 'STOP_REQUIRED_UNIQUE_INDEX_MISSING',
      'IDENTITY_GENERATION', 'IDENTITY_START', 'IDENTITY_INCREMENT', 'X.IS_UNIQUE',
      'K.ORDERING',
    ].forEach((token) => expect(verifier).toContain(token));
    ['REPARTIDOR_LIQUIDACION_GASTOS', 'REPARTIDOR_LIQUIDACION_AJUSTES',
      'REPARTIDOR_LIQUIDACION_INGRESOS', 'LIQUIDACION_MARKER', 'ACTOR_ROLE']
      .forEach((token) => expect(verifier).toContain(token));
    expect(verifier).not.toMatch(/^\s*(?:CREATE|ALTER|INSERT|UPDATE|DELETE|MERGE|DROP|TRUNCATE)\b/im);
    expect(verifier).not.toMatch(/\('JAVIER', 'REPARTIDOR_(?:COBROS|COBROS_AUDIT|FINANCIAL_BALANCES|LIQUIDACION_OPS|LIQUIDACION_GASTOS|LIQUIDACION_AJUSTES|LIQUIDACION_INGRESOS|LIQUIDACION_OUTBOX)'/);
    expect(verifier).toMatch(/TEST_REPARTIDOR_LIQUIDACION_OPS'\s*,\s*'REPLAY_IDENTITY_JSON'/);
    expect(verifier).toMatch(/TEST_REPARTIDOR_LIQUIDACION_OPS'\s*,\s*'SNAPSHOT_JSON'/);
    expect(verifier).not.toMatch(/\b(?:DSEDAC|TEST_LQD|LQD)\b/i);
  });

  test('existing DDL objects are accepted only by exact catalog shape, never name alone', () => {
    for (const source of [isolated, production]) {
      expect(source).toContain('DATA_TYPE');
      expect(source).toContain('NUMERIC_PRECISION');
      expect(source).toContain('NUMERIC_SCALE');
      expect(source).toContain('IS_NULLABLE');
      expect(source).toContain('HAS_DEFAULT');
      expect(source).toContain('COLUMN_DEFAULT');
      expect(source).toContain('IS_IDENTITY');
      expect(source).toContain('CHECK_CONDITION');
      expect(source).toContain('ORDINAL_POSITION');
      expect(source).toContain('IS_UNIQUE');
    }
    expect(isolated).not.toMatch(/LIKE JAVIER\./i);
    expect(isolated.match(/CREATE UNIQUE INDEX JAVIER\.UX_T_RLO_TOKEN/g)).toHaveLength(1);
  });
});
