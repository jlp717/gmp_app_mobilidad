'use strict';

const fs = require('fs');
const path = require('path');

const sqlFiles = [
  '../scripts/sql/040_repartidor_rutero_day_moves.sql',
  '../scripts/sql/041_repartidor_rutero_tracking.sql',
  '../scripts/sql/migrations/2026-08-27_repartidor-rutero-day-moves-forward.sql',
  '../scripts/sql/migrations/2026-08-27_repartidor-rutero-tracking-forward.sql',
];

function sourceOf(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('repartidor production SQL policy', () => {
  test.each(sqlFiles)('%s never creates TEST tables', (relativePath) => {
    expect(sourceOf(relativePath)).not.toMatch(/CREATE\s+TABLE\s+JAVIER\.TEST_/i);
  });

  test.each(sqlFiles)('%s fixes the DB2 qualifier before DDL', (relativePath) => {
    expect(sourceOf(relativePath)).toContain("SET CURRENT SCHEMA = 'JAVIER';");
  });

  test('forward migration creates only the approved production objects', () => {
    const source = sourceOf('../scripts/sql/migrations/2026-08-27_repartidor-rutero-day-moves-forward.sql');
    expect(source).toContain('CREATE TABLE JAVIER.REPARTIDOR_RUTERO_DIA_OVERRIDE');
    expect(source).toContain('CREATE TABLE JAVIER.REPARTIDOR_RUTERO_MOVE_REQUESTS');
    expect(source).toContain('DOCUMENT_IDS VARCHAR(12000)');
    expect(source).not.toMatch(/INSERT\s+INTO|DSEDAC\s*\./i);
  });

  test('tracking migration stores only approved event types', () => {
    const source = sourceOf('../scripts/sql/migrations/2026-08-27_repartidor-rutero-tracking-forward.sql');
    expect(source).toContain('CREATE TABLE JAVIER.REPARTIDOR_RUTERO_TRACKING');
    expect(source).toContain("CHECK (EVENT_TYPE IN ('START', 'POSITION', 'STOP'))");
    expect(source).not.toMatch(/INSERT\s+INTO|DSEDAC\s*\./i);
  });
});
