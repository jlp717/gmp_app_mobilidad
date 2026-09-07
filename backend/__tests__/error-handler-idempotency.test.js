'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { respondError } = require('../src/middlewares/errorHandler');
const { ConflictError } = require('../src/errors/AppError');

function mockRes() {
  const json = jest.fn();
  return {
    headersSent: false,
    writableEnded: false,
    locals: {},
    status: jest.fn(function status() { return this; }),
    json,
  };
}

describe('errorHandler idempotency 409', () => {
  test('ConflictError IDEMPOTENCY_CONFLICT serializes as HTTP 409', () => {
    const res = mockRes();
    respondError(res, new ConflictError(
      'Token de idempotencia reutilizado con otro payload',
      { code: 'IDEMPOTENCY_CONFLICT' },
    ));

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'IDEMPOTENCY_CONFLICT',
      error: 'Token de idempotencia reutilizado con otro payload',
    }));
  });

  test('finanzas style keeps 409 and never upgrades conflict to 500', () => {
    const res = mockRes();
    respondError(res, new ConflictError(
      'Token de idempotencia reutilizado con otro payload',
      { code: 'IDEMPOTENCY_CONFLICT' },
    ), { style: 'finanzas', action: 'registerCobro' });

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'IDEMPOTENCY_CONFLICT',
      error: 'Token de idempotencia reutilizado con otro payload',
    });
  });
});
