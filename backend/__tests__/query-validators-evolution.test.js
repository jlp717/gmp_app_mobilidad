'use strict';

const {
  parseEvolutionQuery,
  resolveEvolutionYears,
} = require('../src/validators/query.validators');

describe('sales-evolution year bridge', () => {
  test('maps Flutter `year` into `years` so the service does not scan 3 ejercicios', () => {
    expect(resolveEvolutionYears({ year: '2026', months: '12' })).toBe('2026');
    expect(parseEvolutionQuery({ year: '2026', months: '12' })).toEqual({
      granularity: 'month',
      upToToday: 'false',
      months: '12',
      years: '2026',
    });
  });

  test('keeps explicit `years` over `year`', () => {
    expect(resolveEvolutionYears({ year: '2026', years: '2025,2026' })).toBe('2025,2026');
  });

  test('leaves years undefined when neither param is sent', () => {
    expect(resolveEvolutionYears({})).toBeUndefined();
    expect(parseEvolutionQuery({}).years).toBeUndefined();
  });
});
