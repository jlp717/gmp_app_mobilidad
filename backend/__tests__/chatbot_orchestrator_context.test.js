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

  test('normalizes ADMIN as supervisor and trims conversation history', async () => {
    const conn = { close: jest.fn(async () => {}) };
    getPool.mockReturnValue({ connect: jest.fn(async () => conn) });
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `mensaje ${index + 1}`,
    }));

    await processMessage({
      message: 'objetivo acumulado enero a marzo',
      user: {
        code: '99',
        role: 'ADMIN',
        isJefeVentas: false,
        vendorCodes: ['80'],
      },
      conversationHistory: history,
    });

    const [, , vendedorCodes, , context] = handleChatMessage.mock.calls[0];
    expect(vendedorCodes).toEqual(['ALL']);
    expect(context).toMatchObject({
      userCode: '99',
      role: 'ADMIN',
      isJefeVentas: true,
      vendorScope: ['ALL'],
      richResponses: true,
    });
    expect(context.conversationHistory).toHaveLength(12);
    expect(context.conversationHistory[0].content).toBe('mensaje 9');
    expect(conn.close).toHaveBeenCalled();
  });

  test('keeps COMERCIAL scoped to own vendors and provided client code', async () => {
    const conn = { close: jest.fn(async () => {}) };
    getPool.mockReturnValue({ connect: jest.fn(async () => conn) });

    await processMessage({
      message: 'deuda de este cliente',
      clientCode: '32258',
      user: {
        code: '80',
        role: 'COMERCIAL',
        isJefeVentas: false,
        vendorCodes: ['80', '81'],
      },
      conversationHistory: [],
    });

    const [, , vendedorCodes, clientCode, context] =
      handleChatMessage.mock.calls[0];
    expect(vendedorCodes).toEqual(['80', '81']);
    expect(clientCode).toBe('32258');
    expect(context).toMatchObject({
      userCode: '80',
      role: 'COMERCIAL',
      isJefeVentas: false,
      vendorScope: ['80', '81'],
      richResponses: true,
    });
    expect(conn.close).toHaveBeenCalled();
  });

  test('blocks unsafe input before opening a database connection', async () => {
    const result = await processMessage({
      message: "'; DROP TABLE DSEDAC.CLI",
      user: {
        code: '80',
        role: 'COMERCIAL',
        isJefeVentas: false,
        vendorCodes: ['80'],
      },
    });

    expect(result).toMatchObject({
      success: true,
      metadata: {
        moderation: {
          blocked: true,
          reason: 'injection',
        },
      },
    });
    expect(result.response).toMatch(/motivos de seguridad/i);
    expect(getPool).not.toHaveBeenCalled();
    expect(handleChatMessage).not.toHaveBeenCalled();
  });

  test('rejects unsupported authenticated roles before DB access', async () => {
    const result = await processMessage({
      message: 'precio producto 120',
      user: {
        code: 'ALM1',
        role: 'AUDITOR_EXTERNO',
        isJefeVentas: false,
      },
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 403,
      error: 'chatbot role not allowed',
    });
    expect(getPool).not.toHaveBeenCalled();
    expect(handleChatMessage).not.toHaveBeenCalled();
  });

  test('sanitizes unsafe handler output before returning it', async () => {
    const conn = { close: jest.fn(async () => {}) };
    getPool.mockReturnValue({ connect: jest.fn(async () => conn) });
    handleChatMessage.mockResolvedValueOnce({
      text: 'Error DB2 SQL0204N DSEDAC.CLI SELECT * FROM DSEDAC.CLI',
      metadata: { kpis: [] },
    });

    const result = await processMessage({
      message: 'deuda cliente 32258',
      user: {
        code: '80',
        role: 'COMERCIAL',
        isJefeVentas: false,
        vendorCodes: ['80'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.response).toMatch(/contenido no permitido|consulta de forma segura/i);
    expect(result.response).not.toMatch(/DSEDAC|SELECT/i);
    expect(conn.close).toHaveBeenCalled();
  });
});
