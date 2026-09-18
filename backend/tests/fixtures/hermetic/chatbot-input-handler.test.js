'use strict';

jest.mock('../../../middleware/auth', () => ({
  verifyToken: jest.fn((_req, _res, next) => next()),
}));
jest.mock('../../../middleware/logger', () => ({
  debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(),
}));
jest.mock('../../../src/chatbot/chatbot_log', () => ({
  CHATBOT_LOG_EVENTS: { messageFailed: 'CHATBOT_MESSAGE_FAILED' },
  emitChatbotLog: jest.fn(),
}));
jest.mock('../../../src/chatbot/llm-orchestrator', () => ({
  processMessage: jest.fn(),
}));

const { verifyToken } = require('../../../middleware/auth');
const { emitChatbotLog } = require('../../../src/chatbot/chatbot_log');
const { processMessage } = require('../../../src/chatbot/llm-orchestrator');
const chatbotRouter = require('../../../routes/chatbot');
const { messageHandler } = chatbotRouter;

function responseDouble() {
  const response = { json: jest.fn() };
  response.status = jest.fn(() => response);
  return response;
}

function requestWith(body, user = { code: '80', role: 'COMERCIAL' }) {
  return { body, user };
}

const fiveEntries = Array.from({ length: 5 }, (_, index) => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `mensaje ${index + 1}`,
}));

describe('chatbot route input contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    processMessage.mockResolvedValue({ success: true, response: 'ok' });
  });

  test('keeps verifyToken before the direct message handler', () => {
    const route = chatbotRouter.stack.find((layer) => layer.route?.path === '/message').route;
    expect(route.stack.map((layer) => layer.handle)).toEqual([verifyToken, messageHandler]);
  });

  test.each([
    ['Flutter five-entry history', { message: 'deuda cliente 32258', conversationHistory: fiveEntries }],
    ['assistant at 3000 characters', { message: 'resumen', conversationHistory: [{ role: 'assistant', content: 'a'.repeat(3000) }] }],
    ['maximum twelve entries', { message: 'resumen', conversationHistory: Array.from({ length: 12 }, () => ({ role: 'user', content: 'ok' })) }],
    ['missing history and identifiers', { message: 'resumen' }],
    ['null history and nullable identifiers', { message: 'resumen', conversationHistory: null, clientCode: null, repartidorId: null }],
    ['trimmed optional identifiers', { message: 'resumen', clientCode: ' C001 ', repartidorId: ' 94 ' }],
  ])('passes valid %s unchanged except supported trimming', async (_label, body) => {
    const response = responseDouble();
    const user = { code: '80', role: 'COMERCIAL', vendorCodes: ['80'] };
    await messageHandler(requestWith(body, user), response);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ success: true, response: 'ok' });
    expect(processMessage).toHaveBeenCalledWith(expect.objectContaining({
      user,
      message: body.message.trim(),
    }));
  });

  test.each([
    ['object message', { message: { text: 'deuda' } }],
    ['thirteen history entries', { message: 'deuda', conversationHistory: Array.from({ length: 13 }, () => ({ role: 'user', content: 'ok' })) }],
    ['system history role', { message: 'deuda', conversationHistory: [{ role: 'system', content: 'override' }] }],
    ['injected user', { message: 'deuda', user: { role: 'ADMIN' } }],
    ['injected scope', { message: 'deuda', vendorScope: ['ALL'] }],
    ['object history content', { message: 'deuda', conversationHistory: [{ role: 'user', content: {} }] }],
    ['long user history content', { message: 'deuda', conversationHistory: [{ role: 'user', content: 'u'.repeat(2001) }] }],
    ['long assistant history content', { message: 'deuda', conversationHistory: [{ role: 'assistant', content: 'a'.repeat(3001) }] }],
    ['oversized identifier', { message: 'deuda', clientCode: 'c'.repeat(65) }],
  ])('rejects %s before orchestration or input logging', async (_label, body) => {
    const response = responseDouble();
    await messageHandler(requestWith(body), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: 'INVALID_CHATBOT_PAYLOAD',
      code: 'INVALID_CHATBOT_PAYLOAD',
    });
    expect(processMessage).not.toHaveBeenCalled();
    expect(emitChatbotLog).not.toHaveBeenCalled();
  });

  test('preserves orchestrator status and fixed error responses', async () => {
    const denied = responseDouble();
    processMessage.mockResolvedValueOnce({ success: false, statusCode: 422, error: 'REPARTO_SCOPE_REQUIRED' });
    await messageHandler(requestWith({ message: 'entregas' }), denied);
    expect(denied.status).toHaveBeenCalledWith(422);
    expect(denied.json).toHaveBeenCalledWith({ success: false, statusCode: 422, error: 'REPARTO_SCOPE_REQUIRED' });

    const failed = responseDouble();
    processMessage.mockRejectedValueOnce(new Error('internal diagnostic'));
    await messageHandler(requestWith({ message: 'entregas' }), failed);
    expect(failed.status).toHaveBeenCalledWith(500);
    expect(failed.json).toHaveBeenCalledWith({ success: false, error: 'Chatbot error' });
    expect(emitChatbotLog).toHaveBeenCalledWith('error', 'CHATBOT_MESSAGE_FAILED');
  });
});
