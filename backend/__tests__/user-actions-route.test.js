'use strict';

const request = require('supertest');
const express = require('express');

const mockAppendFile = jest.fn().mockResolvedValue();
const mockReadFile = jest.fn().mockResolvedValue('');

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  promises: {
    appendFile: (...args) => mockAppendFile(...args),
    readFile: (...args) => mockReadFile(...args),
  },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const userActionsRouter = require('../routes/user-actions');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', userActionsRouter);
  return app;
}

describe('user-actions route', () => {
  beforeEach(() => {
    mockAppendFile.mockReset().mockResolvedValue();
    mockReadFile.mockReset().mockResolvedValue('');
  });

  test('rejects missing action/screen with typed 400', async () => {
    const res = await request(makeApp()).post('/user-action').send({ userId: '15' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_USER_ACTION',
    });
    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  test('500 does not leak the filesystem message', async () => {
    mockAppendFile.mockRejectedValueOnce(new Error('EACCES /secret/path'));
    const res = await request(makeApp()).post('/user-action').send({
      action: 'open',
      screen: 'rutero',
    });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('USER_ACTION_LOG_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/EACCES|secret/);
  });
});
