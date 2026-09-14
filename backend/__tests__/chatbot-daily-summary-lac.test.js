'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/chatbot/chatbot_log', () => ({
  CHATBOT_LOG_EVENTS: {},
  emitChatbotLog: jest.fn(),
}));

const { summaryTools } = require('../src/chatbot/chatbot_tools');

describe('chatbot daily summary uses LAC not OPP', () => {
  test('counts pedidos and clientes from the same DSEDAC.LAC day as sales', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        expect(sql).toMatch(/FROM DSEDAC\.LAC/);
        expect(sql).not.toMatch(/FROM DSEDAC\.OPP/);
        expect(sql).toMatch(/COUNT\(DISTINCT TRIM\(CODIGOCLIENTEALBARAN\)\)/);
        expect(sql).toMatch(/COUNT\(DISTINCT TRIM\(SERIEALBARAN\)/);
        return [{
          TOTAL_SALES: 1250.5,
          TOTAL_CLIENTS: 4,
          TOTAL_ORDERS: 6,
          TOTAL_LINES: 11,
        }];
      }),
    };

    const result = await summaryTools.getDailySummary(
      conn, '80', false, 2026, 9, 14, ['80'],
    );

    expect(result).toMatchObject({
      year: 2026,
      month: 9,
      day: 14,
      totalSales: 1250.5,
      totalOrders: 6,
      totalClients: 4,
      totalOperations: 11,
    });
    expect(conn.query).toHaveBeenCalledTimes(1);
    const params = conn.query.mock.calls[0][1];
    expect(params.slice(0, 3)).toEqual([2026, 9, 14]);
    expect(params).toContain('80');
  });
});
