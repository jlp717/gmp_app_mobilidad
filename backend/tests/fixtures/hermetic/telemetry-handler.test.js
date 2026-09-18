'use strict';

jest.mock('../../../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../middleware/security', () => ({
  createRateLimiter: () => (_req, _res, next) => next(),
}));

const logger = require('../../../middleware/logger');
const telemetry = require('../../../routes/telemetry');
const wireCases = require('./rum-wire-cases.json');

function response() {
  const res = { body: undefined, statusCode: 200 };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

function postRum(body) {
  const res = response();
  telemetry.handleRumPost({ body, user: { id: 'V80' }, requestId: 'rum-fixture' }, res);
  return res;
}

function rumRouteHandlers() {
  const layer = telemetry.stack.find((item) => item.route?.path === '/rum' && item.route.methods.post);
  expect(layer).toBeDefined();
  return layer.route.stack.map((item) => item.handle);
}

describe('telemetry RUM handler under the hermetic guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('is allowlisted for the hermetic lane and composes the real handler without a listener', () => {
    expect(global.__GMP_HERMETIC_GUARD__).toMatchObject({ code: 'TEST_EXTERNAL_IO_BLOCKED' });
    expect(rumRouteHandlers()).toContain(telemetry.handleRumPost);

    const res = postRum({
      events: [{ endpoint: '/offline', method: 'GET', t_req: 1, status: null, bytes: 0 }],
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, n: 1 });
    expect(JSON.parse(logger.info.mock.calls[0][0])).toMatchObject({
      t: 'rum', status: null, bytes: 0,
    });
  });

  test('rejects over-limit and invalid status payloads with the stable code', () => {
    const overLimit = Array.from({ length: 51 }, (_, i) => ({ endpoint: '/x', method: 'GET', t_req: i }));
    const tooMany = postRum({ events: overLimit });
    const invalidStatus = postRum({
      events: [{ endpoint: '/x', method: 'GET', t_req: 1, status: 99 }],
    });

    for (const finalRes of [tooMany, invalidStatus]) {
      expect(finalRes.statusCode).toBe(400);
      expect(finalRes.body).toEqual({ error: 'INVALID_RUM_PAYLOAD', code: 'INVALID_RUM_PAYLOAD' });
    }
  });

  test('never logs synthetic client strings or the caller request id', () => {
    const canary = 'Javier-12345678Z';
    const res = response();
    telemetry.handleRumPost({
      body: { events: [{ endpoint: `/clients/${canary}?rid=${canary}`, method: 'PATCH', t_req: 0, screen: canary, rid: canary }] },
      user: { id: canary }, requestId: canary,
    }, res);

    expect(res.statusCode).toBe(200);
    const line = logger.info.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(line).not.toContain(canary);
    expect(parsed).toMatchObject({ endpoint: '/clients', screen: 'unknown', method: 'PATCH', u: null });
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('matches shared wire cases through the real handler', () => {
    for (const wireCase of wireCases) {
      const res = postRum({ events: [wireCase.input] });
      expect(res.statusCode).toBe(200);
      const line = JSON.parse(logger.info.mock.calls.at(-1)[0]);
      expect(line).toMatchObject(wireCase.expectedWire);
    }
  });
});
