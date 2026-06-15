/**
 * NEXUS AI chatbot route contracts.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../config/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('../src/chatbot/llm-orchestrator', () => ({
  processMessage: jest.fn(),
}));

const { getPool } = require('../config/db');
const { processMessage } = require('../src/chatbot/llm-orchestrator');
const chatbotRouter = require('../routes/chatbot');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chatbot', chatbotRouter);
  return app;
}

describe('chatbot route auth contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/chatbot/health is public and does not require auth', async () => {
    const res = await request(makeApp()).get('/api/chatbot/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(res.body).toHaveProperty('llm');
    expect(res.body).toHaveProperty('model');
    expect(res.body).toHaveProperty('timestamp');
    expect(getPool).not.toHaveBeenCalled();
    expect(processMessage).not.toHaveBeenCalled();
  });

  test('POST /api/chatbot/message without token is rejected before DB/LLM', async () => {
    const res = await request(makeApp())
      .post('/api/chatbot/message')
      .send({ message: 'Dame la deuda del cliente C001' });

    expect([401, 403]).toContain(res.status);
    expect(getPool).not.toHaveBeenCalled();
    expect(processMessage).not.toHaveBeenCalled();
  });
});
