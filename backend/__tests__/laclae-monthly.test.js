'use strict';

const {
  monthlyTable,
  isMonthlyFlagOn,
  isLaclaeMonthlyReady,
  resetLaclaeMonthlyReadyMemo,
} = require('../services/laclae-monthly');

describe('laclae-monthly helper', () => {
  afterEach(() => {
    resetLaclaeMonthlyReadyMemo();
    delete process.env.LACLAE_MONTHLY_ENABLED;
  });

  test('flag defaults on and can be disabled', () => {
    expect(isMonthlyFlagOn({})).toBe(true);
    expect(isMonthlyFlagOn({ LACLAE_MONTHLY_ENABLED: 'false' })).toBe(false);
    expect(monthlyTable()).toBe('JAVIER.LACLAE_MONTHLY');
  });

  test('ready is false when QSYS2 has no table', async () => {
    const queryWithParams = jest.fn().mockResolvedValue([]);
    await expect(isLaclaeMonthlyReady(queryWithParams)).resolves.toBe(false);
    expect(queryWithParams).toHaveBeenCalledWith(
      expect.stringMatching(/QSYS2\.SYSTABLES/),
      ['JAVIER', 'LACLAE_MONTHLY'],
    );
  });

  test('ready is true after probe row', async () => {
    const queryWithParams = jest.fn()
      .mockResolvedValueOnce([{ OK: 1 }])
      .mockResolvedValueOnce([{ ANO: 2026 }]);
    await expect(isLaclaeMonthlyReady(queryWithParams)).resolves.toBe(true);
  });
});
