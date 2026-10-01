'use strict';

const fs = require('fs');
const path = require('path');
const {
  APPLY_STATEMENTS,
  assertIsolatedTest,
  assertSqlTargetsTestOnly,
} = require('../migrations/048_javier_test_evidence_capture_and_precio_competitivo');
const { assertSeedAllowed } = require('../scripts/seed-precio-competitivo-test');

test('apply statements stay on JAVIER.TEST_ and refuse production', () => {
  expect(APPLY_STATEMENTS.join('\n')).toContain('JAVIER.TEST_PRECIO_COMPETITIVO');
  expect(APPLY_STATEMENTS.join('\n')).toContain('JAVIER.TEST_REPARTO_EVIDENCIAS');
  expect(APPLY_STATEMENTS.join('\n')).toContain('MARGEN_PCT >= 0 AND MARGEN_PCT <= 100');
  assertSqlTargetsTestOnly(APPLY_STATEMENTS);
  expect(() => assertIsolatedTest({
    REPARTO_TABLE_SET: 'production',
    REPARTO_ENVIRONMENT: 'production',
  })).toThrow(/isolated_test/);
  expect(() => assertSeedAllowed({
    REPARTO_TABLE_SET: 'production',
    REPARTO_ENVIRONMENT: 'production',
  })).toThrow(/isolated_test/);
});

test('production promotion script is present and marked not to run', () => {
  const promote = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '048_promote_production.sql'),
    'utf8',
  );
  const rollback = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '048_rollback.sql'),
    'utf8',
  );
  expect(promote).toMatch(/NO EJECUTAR/);
  expect(promote).toContain('JAVIER.PRECIO_COMPETITIVO');
  expect(rollback).toContain('DROP TABLE JAVIER.TEST_PRECIO_COMPETITIVO');
  expect(promote.startsWith('--')).toBe(true);
});
