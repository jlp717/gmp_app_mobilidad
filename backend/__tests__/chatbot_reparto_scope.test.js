'use strict';

jest.mock('../config/db', () => ({
  getPool: jest.fn(),
}));
jest.mock('../src/chatbot/chatbot_handler', () => ({
  handleChatMessage: jest.fn(async () => 'ok'),
}));
jest.mock('../middleware/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../middleware/logger');
const { getPool } = require('../config/db');
const { handleChatMessage } = require('../src/chatbot/chatbot_handler');
const {
  authorizeChatbotRepartoScope,
  resolveChatbotClientOwner,
} = require('../src/chatbot/chatbot_authorization');
const { processMessage } = require('../src/chatbot/llm-orchestrator');
const { repartidorTools } = require('../src/chatbot/chatbot_tools');

describe('chatbot reparto scope authorization', () => {
  test('REPARTIDOR can only select its own canonical driver code', () => {
    expect(authorizeChatbotRepartoScope({
      code: '03',
      role: 'REPARTIDOR',
      activeMode: 'REPARTIDOR',
      codigoConductor: '03',
      repartidorCodes: ['03'],
    }, '3')).toEqual({
      allowed: true,
      code: 'REPARTO_SCOPE_SELF',
      driverCodes: ['03'],
    });
    expect(authorizeChatbotRepartoScope({
      code: '03',
      role: 'REPARTIDOR',
      activeMode: 'REPARTIDOR',
      codigoConductor: '03',
      repartidorCodes: ['03'],
    }, '04')).toMatchObject({ allowed: false, code: 'REPARTO_SCOPE_FORBIDDEN' });
  });

  test('BOLA and literal ALL are rejected as exact invalid or foreign codes', () => {
    const jefe = {
      code: '01',
      role: 'JEFE_VENTAS',
      activeMode: 'REPARTIDOR',
      repartidorCodes: ['03', '04'],
    };
    expect(authorizeChatbotRepartoScope(jefe, 'BOLA')).toMatchObject({
      allowed: false,
      code: 'REPARTO_SCOPE_FORBIDDEN',
    });
    expect(authorizeChatbotRepartoScope(jefe, 'ALL')).toMatchObject({
      allowed: false,
      code: 'REPARTO_SCOPE_INVALID',
    });
  });

  test('JEFE_VENTAS in reparto mode can select one or an authorized fleet CSV', () => {
    const jefe = {
      code: '01',
      role: 'JEFE_VENTAS',
      activeMode: 'REPARTIDOR',
      repartidorCodes: ['03', '04', '05'],
    };
    expect(authorizeChatbotRepartoScope(jefe, '04')).toEqual({
      allowed: true,
      code: 'REPARTO_SCOPE_SELECTED',
      driverCodes: ['04'],
    });
    expect(authorizeChatbotRepartoScope(jefe, '03,05')).toEqual({
      allowed: true,
      code: 'REPARTO_SCOPE_FLEET',
      driverCodes: ['03', '05'],
    });
    expect(authorizeChatbotRepartoScope(jefe, '03,99')).toMatchObject({
      allowed: false,
      code: 'REPARTO_SCOPE_FORBIDDEN',
    });
  });

  test('reparto profiles require an explicit selector', () => {
    expect(authorizeChatbotRepartoScope({ code: '08', role: 'REPARTIDOR' }, null))
      .toMatchObject({ allowed: false, code: 'REPARTO_SCOPE_REQUIRED' });
    expect(authorizeChatbotRepartoScope({ code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' }, null))
      .toMatchObject({ allowed: false, code: 'REPARTO_SCOPE_REQUIRED' });
  });

  test('canonicalizes selected codes to the visible code', () => {
    expect(authorizeChatbotRepartoScope({
      code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['08'],
    }, '8')).toMatchObject({ allowed: true, driverCodes: ['08'] });
  });

  test('scope request requires the actual JEFE reparto mode', () => {
    expect(authorizeChatbotRepartoScope({
      code: '01',
      role: 'JEFE_VENTAS',
      activeMode: 'COMERCIAL',
      repartidorCodes: ['03'],
    }, '03')).toMatchObject({ allowed: false, code: 'REPARTO_SCOPE_FORBIDDEN' });
  });
});

describe('chatbot reparto scope propagation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validated fleet restricts both reparto and vendor scope', async () => {
    const conn = { close: jest.fn(async () => {}) };
    getPool.mockReturnValue({ connect: jest.fn(async () => conn) });

    const result = await processMessage({
      message: 'entregas de hoy',
      repartidorId: '03,05',
      user: {
        code: '01',
        role: 'JEFE_VENTAS',
        activeMode: 'REPARTIDOR',
        isJefeVentas: true,
        repartidorCodes: ['03', '04', '05'],
      },
    });

    expect(result).toMatchObject({ success: true, response: 'ok' });
    const context = handleChatMessage.mock.calls[0][4];
    expect(context.vendorScope).toEqual(['03', '05']);
    expect(context.repartidorScope).toEqual(['03', '05']);
    expect(context.isJefeVentas).toBe(false);
    expect(conn.close).toHaveBeenCalled();
  });

  test.each([
    [{ code: '08', role: 'REPARTIDOR' }],
    [{ code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['08'] }],
  ])('missing reparto selector is denied before a connection opens', async (user) => {
    const result = await processMessage({ message: 'entregas de hoy', user });
    expect(result).toMatchObject({ success: false, statusCode: 422, error: 'REPARTO_SCOPE_REQUIRED' });
    expect(getPool).not.toHaveBeenCalled();
    expect(handleChatMessage).not.toHaveBeenCalled();
  });

  test('foreign BOLA scope is denied before a connection is opened', async () => {
    const result = await processMessage({
      message: 'entregas de hoy',
      repartidorId: 'BOLA',
      user: {
        code: '01',
        role: 'JEFE_VENTAS',
        activeMode: 'REPARTIDOR',
        isJefeVentas: true,
        repartidorCodes: ['03', '04'],
      },
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 403,
      error: 'REPARTO_SCOPE_FORBIDDEN',
    });
    expect(getPool).not.toHaveBeenCalled();
    expect(handleChatMessage).not.toHaveBeenCalled();
  });
});

describe('chatbot reparto SQL contract', () => {
  test('fleet collections use bound placeholders and aggregate returned rows', async () => {
    const conn = {
      query: jest.fn(async () => [{
        CLIENTE: 'C1',
        NOMBRE_CLIENTE: 'Cliente',
        TOTAL_COBRABLE: 100,
        TOTAL_COBRADO: 50,
        NUM_DOCUMENTOS: 2,
      }]),
    };

    const result = await repartidorTools.getRepartidorCollections(
      conn, ['03', '05'], 8, 2026,
    );

    const [sql, params] = conn.query.mock.calls[0];
    expect(sql).toMatch(/TRIM\(OPP\.CODIGOREPARTIDOR\) IN \(\?,\?\)/);
    expect(sql).not.toMatch(/IN \(\s*\)/);
    expect(params).toEqual([8, 2026, '03', '05']);
    expect(result.summary).toMatchObject({
      totalCollectable: 100,
      totalCollected: 50,
      overallPercentage: 50,
    });
  });

  test('empty reparto scope fails before SQL construction', async () => {
    const conn = { query: jest.fn() };
    await expect(repartidorTools.getRepartidorDeliveries(
      conn, [], 2026, 8, 18,
    )).rejects.toThrow('REPARTO_SCOPE_REQUIRED');
    expect(conn.query).not.toHaveBeenCalled();
  });
});

describe('chatbot diagnostics are redacted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ownership lookup logs only an allowlisted event', async () => {
    const diagnostic = 'SQL0204 DSEDAC.CLI C:\\private\\query.sql params=[BOLA]';
    const conn = { query: jest.fn(async () => { throw new Error(diagnostic); }) };

    const result = await resolveChatbotClientOwner(conn, 'C1');

    expect(result).toMatchObject({ verified: false });
    const logged = JSON.stringify(logger.mock?.calls || {
      warn: logger.warn.mock.calls,
      error: logger.error.mock.calls,
    });
    expect(logged).not.toContain(diagnostic);
    expect(logger.warn).toHaveBeenCalledWith(
      'CHATBOT_AUTHORIZATION_LOOKUP_FAILED',
    );
  });

  test('tool query failures expose neither DB error nor SQL text', async () => {
    const diagnostic = 'SQLSTATE 42704 DSEDAC.OPP C:\\private\\driver.sql params=03';
    const conn = { query: jest.fn(async () => { throw new Error(diagnostic); }) };

    const result = await repartidorTools.getRepartidorDeliveries(
      conn, ['03'], 2026, 8, 18,
    );

    expect(result.totalDeliveries).toBe(0);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(diagnostic);
    expect(logger.error).toHaveBeenCalledWith('CHATBOT_DATABASE_QUERY_FAILED');
  });
});
