'use strict';

jest.mock('../config/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('../src/chatbot/chatbot_handler', () => ({
  handleChatMessage: jest.fn(async () => ({
    text: 'ok',
    metadata: { kpis: [] },
  })),
}));

const { getPool } = require('../config/db');
const { handleChatMessage } = require('../src/chatbot/chatbot_handler');
const { processMessage } = require('../src/chatbot/llm-orchestrator');

describe('chatbot orchestrator context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes supervisor scope and history to fallback handler', async () => {
    const conn = { close: jest.fn(async () => {}) };
    getPool.mockReturnValue({ connect: jest.fn(async () => conn) });

    const result = await processMessage({
      message: 'facturas cliente 32258',
      user: {
        code: '01',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
        vendorCodes: ['80', '03'],
      },
      conversationHistory: [
        { role: 'user', content: 'deuda cliente 32258' },
      ],
    });

    expect(result).toEqual({
      success: true,
      response: 'ok',
      metadata: { kpis: [] },
    });
    expect(handleChatMessage).toHaveBeenCalledTimes(1);
    const [, message, vendedorCodes, clientCode, context] =
      handleChatMessage.mock.calls[0];
    expect(message).toBe('facturas cliente 32258');
    expect(clientCode).toBeNull();
    expect(vendedorCodes).toEqual(['ALL']);
    expect(context).toMatchObject({
      userCode: '01',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorScope: ['ALL'],
      richResponses: true,
    });
    expect(context.conversationHistory).toHaveLength(1);
    expect(conn.close).toHaveBeenCalled();
  });
});
