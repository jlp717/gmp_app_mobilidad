'use strict';

const {
  refuseErpWrite,
  assertJavierTest,
  commercialCopyJobs,
} = require('../scripts/copy-comercial-erp-to-test');

describe('copy-comercial-erp-to-test', () => {
  test('refuses DSEDAC/DSED writes and non-TEST destinations', () => {
    expect(() => refuseErpWrite('INSERT INTO DSEDAC.CVC SELECT * FROM X')).toThrow(/ERP write/i);
    expect(() => refuseErpWrite('UPDATE DSED.LACLAE SET LCCDCL = 1')).toThrow(/ERP write/i);
    expect(() => refuseErpWrite('ALTER TABLE DSEDAC.LQD ADD COLUMN X INT')).toThrow(/ERP write/i);
    expect(() => assertJavierTest('DSEDAC.CVC')).toThrow(/TEST/);
    expect(() => assertJavierTest('JAVIER.TEST_CVC')).not.toThrow();
  });

  test('copy jobs only INSERT into JAVIER.TEST_* from ERP/JAVIER reads', () => {
    const jobs = commercialCopyJobs('DSED');
    expect(jobs.length).toBeGreaterThan(8);
    for (const job of jobs) {
      expect(job.dest).toMatch(/^JAVIER\.TEST_/);
      expect(job.insertSql).toMatch(/^INSERT INTO JAVIER\.TEST_/);
      expect(job.insertSql).not.toMatch(/INSERT INTO DSEDAC|UPDATE DSEDAC|DELETE FROM DSEDAC|ALTER TABLE DSEDAC/i);
      expect(job.source).toMatch(/^(DSEDAC|DSED|JAVIER)\./);
    }
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_CVC')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_FPG')).toBe(true);
    expect(jobs.some((job) => /PAG|CAC|CODIGOVENDEDOR/.test(job.insertSql))).toBe(true);
  });
});
