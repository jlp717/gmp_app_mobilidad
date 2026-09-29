'use strict';

jest.mock('../../src/config', () => ({ db: { queryWithParams: jest.fn() } }));
jest.mock('../../services/query-optimizer', () => ({ cachedQuery: jest.fn() }));

const { DashboardRepository } = require('../../src/repositories/dashboard.repository');

describe('DashboardRepository.fetchDailyGrossAudit', () => {
    test('uses the direct parameterized executor and bypasses cachedQuery', async () => {
        const queryWithParams = jest.fn(async () => [{ SALES: 57442.76, DOCUMENTS: 346 }]);
        const cachedQuery = jest.fn();
        const repository = new DashboardRepository({ queryWithParams, cachedQuery });

        await expect(repository.fetchDailyGrossAudit(
            'SELECT SUM(X) FROM T WHERE Y = ?',
            [2026],
        )).resolves.toEqual([{ SALES: 57442.76, DOCUMENTS: 346 }]);
        expect(queryWithParams).toHaveBeenCalledWith('SELECT SUM(X) FROM T WHERE Y = ?', [2026]);
        expect(cachedQuery).not.toHaveBeenCalled();
    });
});
