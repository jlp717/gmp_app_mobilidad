'use strict';

/**
 * Opt-in DB2 integration. CI has no AS400 route, so GMP_TEST_DB2=1 enables it locally.
 * Tests are read-only: TEST_P8_ is always a bound lookup value; teardown only closes pool.
 */
const HAS_DB2 = process.env.GMP_TEST_DB2 === '1';
describe.skipIf ||= (condition) => (condition ? describe.skip : describe);
const db = HAS_DB2 ? require('../../config/db') : null;
const financeRepository = HAS_DB2
  ? require('../../repositories/reparto-finance-db2-repository').getRepartoFinanceDb2Repository()
  : null;
let marker;

describe.skipIf(!HAS_DB2)('JAVIER DB2 repository integration', () => {
  beforeAll(() => {
    marker = 'TEST_P8_' + Date.now();
  });

  afterAll(async () => {
    marker = null;
    await db.closePool();
  });

  test('uses existing pool and bound parameters against JAVIER catalog only', async () => {
    const sql =
      'SELECT CAST(? AS VARCHAR(64)) AS TEST_MARKER, TABLE_SCHEMA, TABLE_NAME ' +
      'FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME FETCH FIRST 1 ROW ONLY';
    const rows = await db.queryWithParams(sql, [marker, 'JAVIER'], false, false);

    expect(sql).not.toContain('DSEDAC');
    expect(rows[0]).toMatchObject({ TEST_MARKER: marker, TABLE_SCHEMA: 'JAVIER' });
    expect(String(rows[0].TABLE_NAME || '')).not.toBe('');
  });

  test('executes a parameterized read through the real JAVIER finance repository', async () => {
    expect(financeRepository.tables.balances).toMatch(/^JAVIER\./);

    const rows = await financeRepository.selectBalanceByVendedor(marker);

    expect(Array.isArray(rows)).toBe(true);
  });
});
