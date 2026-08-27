'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../scripts/sql/042_repartidor_rutero_isolated_test.sql'),
  'utf8',
);

describe('isolated reparto rutero SQL policy', () => {
  test('creates only the three JAVIER.TEST routing objects', () => {
    expect(source).toContain('SET CURRENT SCHEMA = \'JAVIER\';');
    expect(source).toContain('CREATE TABLE JAVIER.TEST_REPARTIDOR_RUTERO_DIA_OVERRIDE');
    expect(source).toContain('CREATE TABLE JAVIER.TEST_REPARTIDOR_RUTERO_MOVE_REQUESTS');
    expect(source).toContain('CREATE TABLE JAVIER.TEST_REPARTIDOR_RUTERO_TRACKING');
    expect(source).not.toMatch(/(?:FROM|INTO|UPDATE|TABLE)\s+DSEDAC\s*\./i);
    expect(source).not.toMatch(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  });

  test('keeps test routing constraints aligned with repository limits', () => {
    expect(source).toContain('TARGET_POSITION BETWEEN 0 AND 499');
    expect(source).toContain('DOCUMENT_IDS VARCHAR(12000)');
    expect(source).toContain("EVENT_TYPE IN ('START', 'POSITION', 'STOP')");
  });
});
