'use strict';

function resolve(env) {
  jest.resetModules();
  return require('../config/reparto-runtime').resolveRepartoRouteMode(env);
}

describe('deterministic reparto route mode', () => {
  test('uses DDD routes when both flags are omitted', () => {
    expect(resolve({})).toEqual(expect.objectContaining({
      valid: true,
      mode: 'ddd',
      useTsRoutes: false,
      useDddRoutes: true,
    }));
  });

  test('uses DDD routes only for explicit false/true', () => {
    expect(resolve({ USE_TS_ROUTES: 'false', USE_DDD_ROUTES: 'true' }))
      .toEqual(expect.objectContaining({
        valid: true,
        mode: 'ddd',
        useTsRoutes: false,
        useDddRoutes: true,
      }));
  });

  test('uses legacy routes only for explicit false/false', () => {
    expect(resolve({ USE_TS_ROUTES: 'false', USE_DDD_ROUTES: 'false' }))
      .toEqual(expect.objectContaining({
        valid: true,
        mode: 'legacy',
        useTsRoutes: false,
        useDddRoutes: false,
      }));
  });

  test('rejects the retired TypeScript route family even when DDD is disabled', () => {
    expect(resolve({ USE_TS_ROUTES: 'true', USE_DDD_ROUTES: 'false' }))
      .toEqual(expect.objectContaining({
        valid: false,
        mode: 'invalid',
        useTsRoutes: false,
        useDddRoutes: false,
        errors: expect.arrayContaining(['USE_TS_ROUTES is retired; only false is supported']),
      }));
  });

  test.each([
    [{ USE_TS_ROUTES: 'true', USE_DDD_ROUTES: 'true' }, 'contradictory enabled route families'],
    [{ USE_TS_ROUTES: 'yes', USE_DDD_ROUTES: 'false' }, 'invalid TS boolean'],
    [{ USE_TS_ROUTES: 'false', USE_DDD_ROUTES: 'legacy' }, 'invalid DDD boolean'],
  ])('rejects %s instead of silently selecting a family (%s)', (env) => {
    const result = resolve(env);

    expect(result.valid).toBe(false);
    expect(result.mode).toBe('invalid');
    expect(result.useTsRoutes).toBe(false);
    expect(result.useDddRoutes).toBe(false);
    expect(result.errors).toEqual(expect.any(Array));
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
