'use strict';

const {
  refuseErpWrite,
  assertJavierTest,
  commercialCopyJobs,
} = require('../scripts/tools/copy-comercial-erp-to-test');

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
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_CLI')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_CLP')).toBe(true);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_CLP').fullSql).toMatch(/SELECT \* FROM DSEDAC\.CLP/);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_LINDTO')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_CDVI')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_ART')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_LAC')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_CFC')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_OPP')).toBe(true);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_CFC').fullSql).toMatch(/SELECT \* FROM DSEDAC\.CFC/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_OPP').fullSql).toMatch(/SELECT \* FROM DSEDAC\.OPP/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_LPC').appendSql).toMatch(/EJERCICIOPEDIDO/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_LPC').appendSql).not.toMatch(/EJERCICIOALBARAN/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_LPC').fullSql).toMatch(/SELECT \* FROM DSEDAC\.LPC/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_CVC').fullSql).toMatch(/SELECT \* FROM DSEDAC\.CVC/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_LAC').fullSql).toMatch(/SELECT \* FROM DSEDAC\.LAC/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_LQD').fullSql).toMatch(/SELECT \* FROM DSEDAC\.LQD/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_CLC').fullSql).toMatch(/SELECT \* FROM DSEDAC\.CLC/);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_CLX').fullSql).toMatch(/SELECT \* FROM DSEDAC\.CLX/);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_ALM')).toBe(true);
    expect(jobs.some((job) => job.dest === 'JAVIER.TEST_ARO')).toBe(true);
    expect(jobs.some((job) => /PAG|CAC|CODIGOVENDEDOR/.test(job.insertSql))).toBe(true);
    expect(jobs.find((job) => job.dest === 'JAVIER.TEST_CVC').appendSql).toMatch(/NOT EXISTS/);
    expect(require('../scripts/tools/copy-comercial-erp-to-test').HIT_VENDORS).toEqual(
      expect.arrayContaining(['80', '35', '98']),
    );
  });

  test('intersect columns keeps only shared identifiers', () => {
    const { intersectColumnNames, buildInsertSelectSql } = require('../scripts/tools/copy-comercial-erp-to-test');
    expect(intersectColumnNames(['A', 'B'], ['B', 'C'])).toEqual(['B']);
    const sql = buildInsertSelectSql('JAVIER.TEST_LPC', 'DSEDAC.LPC', ['EJERCICIOPEDIDO', 'NUMEROPEDIDO']);
    expect(sql).toBe(
      'INSERT INTO JAVIER.TEST_LPC (EJERCICIOPEDIDO, NUMEROPEDIDO) SELECT EJERCICIOPEDIDO, NUMEROPEDIDO FROM DSEDAC.LPC',
    );
    expect(() => buildInsertSelectSql('DSEDAC.LPC', 'DSEDAC.LPC', ['ID'])).toThrow(/TEST/);
  });
});
