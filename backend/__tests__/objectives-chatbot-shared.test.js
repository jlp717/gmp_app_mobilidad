'use strict';

const mockEvolution = jest.fn();
jest.mock('../routes/objectives', () => ({ getObjectivesEvolutionCached: (...args) => mockEvolution(...args) }));
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
const { objectivesTools } = require('../src/chatbot/chatbot_tools');

describe('Asistente uses the same monthly objective as the commercial screen', () => {
  beforeEach(() => {
    mockEvolution.mockReset().mockResolvedValue({ kind: 'data', data: {
      yearlyData: { 2026: [{ month: 9, sales: 15200.5, objective: 20000 }] },
    } });
  });
  test('leader 80 keeps personal scope despite team membership', async () => {
    const result = await objectivesTools.getObjectives(null, '80', false, 9, 2026, ['80', '72', '73', '81', '83']);
    expect(mockEvolution).toHaveBeenCalledWith({ effectiveVendorCodes: '80', years: '2026' });
    expect(result).toEqual({ month: 9, year: 2026, target: 20000, achieved: 15200.5, achievementPercent: 76, remaining: 4799.5 });
  });
  test.each([[['ALL'], 'ALL'], [['35', '80'], '35,80']])('jefe retains the authorized scope %j', async (scope, expected) => {
    await objectivesTools.getObjectives(null, '98', true, 9, 2026, scope);
    expect(mockEvolution).toHaveBeenCalledWith({ effectiveVendorCodes: expected, years: '2026' });
  });
  test('cache fill in progress never becomes a fabricated zero objective', async () => {
    mockEvolution.mockResolvedValue({ kind: 'busy' });
    await expect(objectivesTools.getObjectives(null, '80', false, 9, 2026, ['80']))
      .rejects.toMatchObject({ code: 'ROUTE_FILL_BUSY' });
  });
});
