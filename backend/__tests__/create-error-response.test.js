'use strict';

const { createErrorResponse, handleRouteError } = require('../utils/common');
const { ValidationError } = require('../src/errors/AppError');

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('createErrorResponse opaque 5xx', () => {
  test('never forwards internal SQL on 5xx', () => {
    const body = createErrorResponse(
      new Error('SQL0204N SELECT * FROM DSEDAC.CLI'),
      'Error interno del servidor',
      { statusHint: 500, code: 'PEDIDOS_ERROR' },
    );
    expect(body.error).toBe('Error interno del servidor');
    expect(body.code).toBe('PEDIDOS_ERROR');
    expect(JSON.stringify(body)).not.toMatch(/SELECT \*|SQL0204N|DSEDAC/);
  });

  test('4xx keeps the sanitized business message', () => {
    const body = createErrorResponse(
      new ValidationError('action y screen son obligatorios'),
      'action y screen son obligatorios',
      { statusHint: 400, code: 'VALIDATION_ERROR' },
    );
    expect(body.error).toBe('action y screen son obligatorios');
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

describe('handleRouteError', () => {
  function mockRes() {
    return {
      headersSent: false,
      writableEnded: false,
      locals: {},
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
  }

  test('typed 4xx from AppError wins over the fallback 500', () => {
    const res = mockRes();
    handleRouteError(new ValidationError('limit invalido'), res, 'Error interno', 500, { code: 'FALLBACK' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('limit invalido');
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('unexpected 500 stays generic', () => {
    const res = mockRes();
    handleRouteError(new Error('password=hunter2 SELECT * FROM X'), res, 'Error procesando pedido', 500, {
      code: 'PEDIDOS_ERROR',
    });
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Error procesando pedido');
    expect(res.body.code).toBe('PEDIDOS_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|SELECT \*/);
  });
});
