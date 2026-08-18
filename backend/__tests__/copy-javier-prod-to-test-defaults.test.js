'use strict';

const {
  buildReconciliationPlan,
  compareTableMetadata,
  normalizeColumnDefault,
  safeDefaultExpression,
} = require('../scripts/copy-javier-prod-to-test');

function column(overrides = {}) {
  return {
    name: 'UPDATED_BY', dataType: 'VARCHAR', length: '100',
    numericPrecision: '', numericScale: '', isNullable: 'NO',
    hasDefault: false, columnDefault: '', identity: false,
    identityGeneration: '', identityStart: '', identityIncrement: '',
    ...overrides,
  };
}

const pair = {
  group: 'finance', key: 'balances', objectType: 'TABLE',
  src: 'JAVIER.REPARTIDOR_FINANCIAL_BALANCES',
  dst: 'JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES',
};

describe('DB2 COLUMN_DEFAULT exact isomorphism', () => {
  test.each([
    ['  current   timestamp ', 'CURRENT TIMESTAMP'],
    ["  'system user'  ", "'system user'"],
    ["'it''s safe'", "'it''s safe'"],
    [null, ''],
  ])('normalizes %p to %p without changing literal case', (input, expected) => {
    expect(normalizeColumnDefault(input)).toBe(expected);
  });

  test('fails closed for an unterminated literal or unsafe expression', () => {
    expect(() => normalizeColumnDefault("'system")).toThrow('unterminated literal');
    expect(() => safeDefaultExpression('CURRENT TIMESTAMP; DELETE FROM X'))
      .toThrow('Unsupported DB2 catalog COLUMN_DEFAULT expression');
    expect(safeDefaultExpression("'semi;--inside'"))
      .toBe("'semi;--inside'");
  });

  test('reports the live explicit default mismatch exactly', () => {
    const source = [column({ hasDefault: true, columnDefault: "'system'" })];
    const destination = [column({ hasDefault: true, columnDefault: "''" })];
    expect(compareTableMetadata(source, destination)).toMatchObject({
      ok: false,
      defaultDeltas: [{
        name: 'UPDATED_BY', source: "YES|'system'", destination: "YES|''",
      }],
    });
  });

  test('sets and drops defaults only on the TEST destination', () => {
    const setPlan = buildReconciliationPlan(
      pair,
      [column({ hasDefault: true, columnDefault: "'system'" })],
      [column({ hasDefault: true, columnDefault: "''" })],
    );
    expect(setPlan).toEqual([{
      kind: 'SET_DEFAULT', column: 'UPDATED_BY',
      sql: "ALTER TABLE JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES ALTER COLUMN UPDATED_BY SET DEFAULT 'system'",
    }]);

    const dropPlan = buildReconciliationPlan(
      pair,
      [column({ hasDefault: false, columnDefault: '' })],
      [column({ hasDefault: true, columnDefault: "'legacy'" })],
    );
    expect(dropPlan).toEqual([{
      kind: 'DROP_DEFAULT', column: 'UPDATED_BY',
      sql: 'ALTER TABLE JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES ALTER COLUMN UPDATED_BY DROP DEFAULT',
    }]);
    for (const operation of [...setPlan, ...dropPlan]) {
      expect(operation.sql).toMatch(/^ALTER TABLE JAVIER\.TEST_/);
      expect(operation.sql).not.toContain('DSEDAC');
      expect(operation.sql).not.toContain(`ALTER TABLE ${pair.src}`);
    }
  });

  test('requires a backed rebuild for an implicit source default', () => {
    expect(() => buildReconciliationPlan(
      pair,
      [column({ hasDefault: true, columnDefault: '' })],
      [column({ hasDefault: false, columnDefault: '' })],
    )).toThrow('TEST-only exact schema requires backed rebuild');
  });

  test('preserves an explicit default when adding a missing column', () => {
    const plan = buildReconciliationPlan(
      pair,
      [column({ name: 'ID', dataType: 'INTEGER', length: '4', numericPrecision: '10', numericScale: '0' }),
        column({ name: 'UPDATED_BY', hasDefault: true, columnDefault: "'system'" })],
      [column({ name: 'ID', dataType: 'INTEGER', length: '4', numericPrecision: '10', numericScale: '0' })],
      { destinationRowCount: 2 },
    );
    expect(plan).toContainEqual(expect.objectContaining({
      kind: 'ADD_COLUMN', column: 'UPDATED_BY',
      sql: expect.stringContaining("NOT NULL DEFAULT 'system'"),
    }));
  });
});
