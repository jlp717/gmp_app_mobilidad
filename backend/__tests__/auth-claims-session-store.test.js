'use strict';

const {
  AuthSessionStoreError,
  createAuthClaimsSessionStore,
} = require('../src/modules/auth/application/auth-claims-session-store');

const REFRESH_TTL_MS = 60_000;

function refreshToken({ sid = 'sid-1', sub = 'V050', jti = 'refresh-1' } = {}) {
  return JSON.stringify({ sid, sub, jti, type: 'refresh' });
}

function verifyRefreshToken(token) {
  try {
    const parsed = JSON.parse(token);
    return parsed.type === 'refresh' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function createMemoryStore() {
  return createAuthClaimsSessionStore({
    mode: 'memory',
    production: false,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
  });
}

function sessionInput(overrides = {}) {
  const sid = overrides.sid || 'sid-1';
  const userId = overrides.userId || 'V050';
  const refreshJti = overrides.refreshJti || 'refresh-1';
  return {
    sid,
    userId,
    refreshToken: refreshToken({ sid, sub: userId, jti: refreshJti }),
    accessJti: 'access-1',
    refreshJti,
    userAgent: 'jest',
    ip: '127.0.0.1',
    ...overrides,
  };
}

function createRedisDouble() {
  const values = new Map();
  const sets = new Map();
  const ttlSeconds = new Map();
  return {
    values,
    sets,
    ttlSeconds,
    ping: jest.fn(async () => 'PONG'),
    get: jest.fn(async (key) => values.get(key) ?? null),
    setEx: jest.fn(async (key, ttl, value) => {
      values.set(key, value);
      ttlSeconds.set(key, Number(ttl));
      return 'OK';
    }),
    set: jest.fn(async (key, value) => { values.set(key, value); return 'OK'; }),
    del: jest.fn(async (keys) => {
      for (const key of (Array.isArray(keys) ? keys : [keys])) {
        values.delete(key);
        sets.delete(key);
        ttlSeconds.delete(key);
      }
      return 1;
    }),
    sAdd: jest.fn(async (key, value) => {
      const entries = sets.get(key) || new Set();
      entries.add(value);
      sets.set(key, entries);
      return 1;
    }),
    sRem: jest.fn(async (key, value) => { sets.get(key)?.delete(value); return 1; }),
    sMembers: jest.fn(async (key) => [...(sets.get(key) || [])]),
    expire: jest.fn(async (key, ttl) => { ttlSeconds.set(key, Number(ttl)); return 1; }),
    eval: jest.fn(async (script, { keys, arguments: args }) => {
      if (script.includes('AUTH_REGISTER_V2') || script.includes('AUTH_REGISTER_V3')) {
        const entries = sets.get(keys[1]) || new Set();
        for (const sid of [...entries]) {
          if (!values.has(`${args[4]}${sid}`)) entries.delete(sid);
        }
        if (entries.size > Number(args[5])) return -1;
        if (!entries.has(args[0]) && script.includes('AUTH_REGISTER_V3')) {
          const limit = Number(args[3]);
          while (entries.size >= limit) {
            let oldestSid = null;
            let oldestCreated = null;
            for (const sid of [...entries]) {
              const raw = values.get(`${args[4]}${sid}`);
              if (!raw) {
                entries.delete(sid);
                continue;
              }
              let created = 0;
              try {
                const parsed = JSON.parse(raw);
                created = Number(parsed.createdAt) || 0;
              } catch (_error) {
                created = 0;
              }
              if (oldestCreated === null || created < oldestCreated) {
                oldestCreated = created;
                oldestSid = sid;
              }
            }
            if (!oldestSid) break;
            const oldKey = `${args[4]}${oldestSid}`;
            const ttl = ttlSeconds.get(oldKey) || Number(args[2]);
            values.set(`${args[6]}${oldestSid}`, '1');
            ttlSeconds.set(`${args[6]}${oldestSid}`, Number(ttl));
            values.delete(oldKey);
            entries.delete(oldestSid);
          }
        } else if (!entries.has(args[0]) && entries.size >= Number(args[3])) {
          return 0;
        }
        values.set(keys[0], args[1]);
        ttlSeconds.set(keys[0], Number(args[2]));
        entries.add(args[0]);
        sets.set(keys[1], entries);
        ttlSeconds.set(keys[1], Number(args[2]));
        return 1;
      }
      if (script.includes('AUTH_ROTATE_V2')) {
        const currentRaw = values.get(keys[0]);
        if (!currentRaw) return 0;
        const current = JSON.parse(currentRaw);
        if (String(current[args[0]]) !== String(args[1])) return 0;
        if (String(current.userId) !== String(args[5])) return 0;
        values.set(keys[0], args[2]);
        ttlSeconds.set(keys[0], Number(args[3]));
        const entries = sets.get(keys[1]) || new Set();
        entries.add(args[4]);
        sets.set(keys[1], entries);
        ttlSeconds.set(keys[1], Number(args[3]));
        return 1;
      }
      if (script.includes('AUTH_PRIVILEGE_TRANSITION_V1')) {
        const currentRaw = values.get(keys[0]);
        if (!currentRaw) return 0;
        if (values.has(keys[1])) return -1;
        const current = JSON.parse(currentRaw);
        if (String(current.accessJti) !== String(args[0])) return 0;
        if (String(current.userId) !== String(args[1])) return 0;
        const oldTtl = ttlSeconds.get(keys[0]) || Number(args[4]);
        values.set(keys[3], '1');
        ttlSeconds.set(keys[3], oldTtl);
        values.delete(keys[0]);
        ttlSeconds.delete(keys[0]);
        const entries = sets.get(keys[2]) || new Set();
        entries.delete(args[2]);
        values.set(keys[1], args[3]);
        ttlSeconds.set(keys[1], Number(args[4]));
        entries.add(args[5]);
        sets.set(keys[2], entries);
        ttlSeconds.set(keys[2], Number(args[4]));
        return 1;
      }
      if (script.includes('AUTH_INVALIDATE_USER_V2')) {
        const ids = [...(sets.get(keys[0]) || [])];
        for (const sid of ids) {
          const sessionKey = `${args[0]}${sid}`;
          const revokedKey = `${args[1]}${sid}`;
          values.delete(sessionKey);
          ttlSeconds.delete(sessionKey);
          values.set(revokedKey, '1');
          ttlSeconds.set(revokedKey, Number(args[2]));
        }
        sets.delete(keys[0]);
        ttlSeconds.delete(keys[0]);
        return ids.length;
      }
      throw new Error('unexpected Redis script');
    }),
  };
}

test('memory store registers canonical sid/jti state and revokes it immediately', async () => {
  const store = createMemoryStore();
  await store.register(sessionInput());

  await expect(store.isActive('sid-1', 'V050', 'access-1')).resolves.toBe(true);
  await expect(store.isActive('sid-1', 'V050', 'wrong-access')).resolves.toBe(false);
  await store.revoke('sid-1', { userId: 'V050' });
  await expect(store.isActive('sid-1', 'V050', 'access-1')).resolves.toBe(false);
});

test.each([undefined, '', '   '])(
  'isActive rejects omitted or blank accessJti: %p',
  async (accessJti) => {
    const store = createMemoryStore();
    await store.register(sessionInput());

    await expect(store.isActive('sid-1', 'V050', accessJti)).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID', status: 401,
    });
  },
);

test('memory compare-and-rotate accepts exactly one concurrent refresh', async () => {
  const store = createMemoryStore();
  const current = sessionInput({ refreshJti: 'refresh-old' });
  await store.register(current);

  const outcomes = await Promise.all(['one', 'two'].map((suffix) => store.rotate({
    ...current,
    currentRefreshToken: current.refreshToken,
    newRefreshToken: refreshToken({ sid: 'sid-1', sub: 'V050', jti: `refresh-${suffix}` }),
    accessJti: `access-${suffix}`,
    refreshJti: `refresh-${suffix}`,
  })));

  expect(outcomes.sort()).toEqual([false, true]);
});

test.each(['memory', 'redis'])('%s privilege transition revokes old SID and activates only new SID', async (mode) => {
  const client = mode === 'redis' ? createRedisDouble() : null;
  const store = createAuthClaimsSessionStore({
    mode,
    production: mode === 'redis',
    getRedisClient: () => client,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
  });
  await store.register(sessionInput({ sid: 'sid-old' }));

  const transitioned = await store.transitionForAccess({
    currentSid: 'sid-old',
    currentAccessJti: 'access-1',
    sid: 'sid-new',
    userId: 'V050',
    newRefreshToken: refreshToken({ sid: 'sid-new', sub: 'V050', jti: 'refresh-new' }),
    accessJti: 'access-new',
    refreshJti: 'refresh-new',
  });

  expect(transitioned).toBe(true);
  await expect(store.isActive('sid-old', 'V050', 'access-1')).resolves.toBe(false);
  await expect(store.isActive('sid-new', 'V050', 'access-new')).resolves.toBe(true);
  await expect(store.transitionForAccess({
    currentSid: 'sid-old',
    currentAccessJti: 'access-1',
    sid: 'sid-other',
    userId: 'V050',
    newRefreshToken: refreshToken({ sid: 'sid-other', sub: 'V050', jti: 'refresh-other' }),
    accessJti: 'access-other',
    refreshJti: 'refresh-other',
  })).resolves.toBe(false);
});

test('rejects a refresh token whose subject or jti does not match the session', async () => {
  const store = createMemoryStore();
  await expect(store.register(sessionInput({
    refreshToken: refreshToken({ sid: 'sid-1', sub: 'V999', jti: 'refresh-1' }),
  }))).rejects.toEqual(expect.objectContaining({
    status: 401,
    code: 'AUTH_SESSION_INVALID',
  }));
});

test('production mode requires Redis and never falls back to the local map', async () => {
  const store = createAuthClaimsSessionStore({
    mode: 'memory',
    production: true,
    getRedisClient: () => null,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
  });

  await expect(store.readiness()).resolves.toEqual({
    ready: false,
    required: true,
    mode: 'redis',
    shared: true,
    code: 'AUTH_SESSION_STORE_UNAVAILABLE',
  });
  await expect(store.register(sessionInput())).rejects.toBeInstanceOf(AuthSessionStoreError);
  expect(store.sessions.size).toBe(0);
});

test('two simulated workers share Redis state and preserve atomic rotation', async () => {
  const client = createRedisDouble();
  const options = {
    mode: 'redis',
    production: true,
    getRedisClient: () => client,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
  };
  const workerA = createAuthClaimsSessionStore(options);
  const workerB = createAuthClaimsSessionStore(options);
  const current = sessionInput({ sid: 'sid-shared', refreshJti: 'refresh-old' });
  await workerA.register(current);

  await expect(workerB.isActive('sid-shared', 'V050', 'access-1')).resolves.toBe(true);
  const outcomes = await Promise.all(['one', 'two'].map((suffix) => workerB.rotate({
    ...current,
    currentRefreshToken: current.refreshToken,
    newRefreshToken: refreshToken({ sid: 'sid-shared', sub: 'V050', jti: `refresh-${suffix}` }),
    accessJti: `access-${suffix}`,
    refreshJti: `refresh-${suffix}`,
  })));

  expect(outcomes.sort()).toEqual([false, true]);
});

test('Redis sixth session evicts the oldest live session instead of blocking login', async () => {
  const client = createRedisDouble();
  let clock = 1_800_000_000_000;
  const store = createAuthClaimsSessionStore({
    mode: 'redis',
    production: true,
    getRedisClient: () => client,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
    maxSessionsPerUser: 5,
    now: () => clock,
  });

  for (let index = 1; index <= 5; index += 1) {
    clock += 1000;
    await store.register(sessionInput({
      sid: `sid-${index}`,
      userId: 'V050',
      accessJti: `access-${index}`,
      refreshJti: `refresh-${index}`,
    }));
  }

  clock += 1000;
  const sixth = sessionInput({ sid: 'sid-6', accessJti: 'access-6', refreshJti: 'refresh-6' });
  await expect(store.register(sixth)).resolves.toEqual({ ok: true, sid: 'sid-6' });
  expect(client.values.has('gmp:auth:session:sid-6')).toBe(true);
  expect(client.values.has('gmp:auth:session:sid-1')).toBe(false);
  expect(client.sets.get('gmp:auth:user:V050')).toEqual(new Set([
    'sid-2', 'sid-3', 'sid-4', 'sid-5', 'sid-6',
  ]));
  await expect(store.isActive('sid-1', 'V050', 'access-1')).resolves.toBe(false);
  await expect(store.isActive('sid-6', 'V050', 'access-6')).resolves.toBe(true);
});

test('concurrent Redis registrations both succeed by evicting older sessions under the cap', async () => {
  const client = createRedisDouble();
  let clock = 1_800_000_000_000;
  const store = createAuthClaimsSessionStore({
    mode: 'redis',
    production: true,
    getRedisClient: () => client,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
    maxSessionsPerUser: 5,
    now: () => clock,
  });

  for (let index = 1; index <= 4; index += 1) {
    clock += 1000;
    await store.register(sessionInput({ sid: `race-${index}`, accessJti: `race-access-${index}`, refreshJti: `race-refresh-${index}` }));
  }

  clock += 1000;
  const contenders = [
    sessionInput({ sid: 'race-5', accessJti: 'race-access-5', refreshJti: 'race-refresh-5' }),
    sessionInput({ sid: 'race-6', accessJti: 'race-access-6', refreshJti: 'race-refresh-6' }),
  ];
  const outcomes = await Promise.allSettled(contenders.map((input) => {
    clock += 1000;
    return store.register(input);
  }));
  expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
  expect(client.sets.get('gmp:auth:user:V050')?.size).toBe(5);

  const active = await Promise.all([
    store.isActive('race-5', 'V050', 'race-access-5'),
    store.isActive('race-6', 'V050', 'race-access-6'),
  ]);
  expect(active.filter(Boolean)).toHaveLength(2);
});

test('Redis invalidateUser revokes every indexed sid even above the configured limit', async () => {
  const client = createRedisDouble();
  const ids = [];
  const currentTime = 1_800_000_000_000;
  for (let index = 1; index <= 7; index += 1) {
    const sid = `legacy-sid-${index}`;
    ids.push(sid);
    client.values.set(`gmp:auth:session:${sid}`, JSON.stringify({
      sid,
      userId: 'V050',
      accessJti: `legacy-access-${index}`,
      refreshJti: `legacy-refresh-${index}`,
      createdAt: currentTime,
      expiresAt: currentTime + REFRESH_TTL_MS,
    }));
  }
  client.sets.set('gmp:auth:user:V050', new Set(ids));

  const store = createAuthClaimsSessionStore({
    mode: 'redis',
    production: true,
    getRedisClient: () => client,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
    maxSessionsPerUser: 5,
    now: () => currentTime,
  });

  await expect(store.invalidateUser('V050')).resolves.toEqual({ ok: true, count: 7 });

  expect(client.sets.has('gmp:auth:user:V050')).toBe(false);
  for (const sid of ids) {
    expect(client.values.has(`gmp:auth:session:${sid}`)).toBe(false);
    expect(client.values.get(`gmp:auth:revoked-sid:${sid}`)).toBe('1');
  }
});

test('Redis command failure is mapped to the sanitized typed 503 error', async () => {
  const client = createRedisDouble();
  client.eval.mockRejectedValue(new Error('sensitive endpoint detail'));
  const store = createAuthClaimsSessionStore({
    mode: 'redis',
    production: true,
    getRedisClient: () => client,
    verifyRefreshToken,
    refreshTtlMs: REFRESH_TTL_MS,
  });

  await expect(store.register(sessionInput())).rejects.toEqual(expect.objectContaining({
    name: 'AuthSessionStoreError',
    status: 503,
    code: 'AUTH_SESSION_STORE_UNAVAILABLE',
    message: 'Authentication session store unavailable',
  }));
});

test('Redis readiness requires a real successful ping', async () => {
  const failingClient = createRedisDouble();
  failingClient.ping.mockRejectedValue(new Error('private redis detail'));
  const failingStore = createAuthClaimsSessionStore({
    mode: 'redis', production: true, getRedisClient: () => failingClient,
    verifyRefreshToken, refreshTtlMs: REFRESH_TTL_MS,
  });
  const noPingStore = createAuthClaimsSessionStore({
    mode: 'redis', production: true, getRedisClient: () => ({}),
    verifyRefreshToken, refreshTtlMs: REFRESH_TTL_MS,
  });

  await expect(failingStore.readiness()).resolves.toMatchObject({
    ready: false, code: 'AUTH_SESSION_STORE_UNAVAILABLE',
  });
  await expect(noPingStore.readiness()).resolves.toMatchObject({
    ready: false, code: 'AUTH_SESSION_STORE_UNAVAILABLE',
  });
});

test('Redis rotation restores index membership and TTL before atomic invalidation', async () => {
  const client = createRedisDouble();
  const store = createAuthClaimsSessionStore({
    mode: 'redis', production: true, getRedisClient: () => client,
    verifyRefreshToken, refreshTtlMs: REFRESH_TTL_MS,
  });
  const current = sessionInput({ sid: 'sid-expired-index', refreshJti: 'refresh-old' });
  await store.register(current);
  client.sets.delete('gmp:auth:user:V050');
  client.ttlSeconds.delete('gmp:auth:user:V050');

  await expect(store.rotate({
    ...current,
    currentRefreshToken: current.refreshToken,
    newRefreshToken: refreshToken({ sid: current.sid, sub: current.userId, jti: 'refresh-new' }),
    accessJti: 'access-new',
    refreshJti: 'refresh-new',
  })).resolves.toBe(true);
  expect(client.sets.get('gmp:auth:user:V050')).toEqual(new Set(['sid-expired-index']));
  expect(client.ttlSeconds.get('gmp:auth:user:V050')).toBeGreaterThan(0);
  client.sets.delete('gmp:auth:user:V050');
  client.ttlSeconds.delete('gmp:auth:user:V050');
  await expect(store.rotateForAccess({
    ...current,
    currentAccessJti: 'access-new',
    newRefreshToken: refreshToken({ sid: current.sid, sub: current.userId, jti: 'refresh-newer' }),
    accessJti: 'access-newer',
    refreshJti: 'refresh-newer',
  })).resolves.toBe(true);
  expect(client.sets.get('gmp:auth:user:V050')).toEqual(new Set(['sid-expired-index']));
  expect(client.ttlSeconds.get('gmp:auth:user:V050')).toBeGreaterThan(0);


  client.sMembers.mockClear();
  client.sRem.mockClear();
  client.del.mockClear();
  await expect(store.invalidateUser('V050')).resolves.toEqual({ ok: true, count: 1 });
  await expect(store.isActive('sid-expired-index', 'V050', 'access-newer')).resolves.toBe(false);
  expect(client.sets.has('gmp:auth:user:V050')).toBe(false);
  expect(client.values.get('gmp:auth:revoked-sid:sid-expired-index')).toBe('1');
  expect(client.sMembers).not.toHaveBeenCalled();
  expect(client.sRem).not.toHaveBeenCalled();
  expect(client.del).not.toHaveBeenCalled();
});

test.each(['register-first', 'invalidate-first'])(
  'register concurrent with invalidate is linear and never leaves an active unindexed sid: %s',
  async (order) => {
    const client = createRedisDouble();
    const store = createAuthClaimsSessionStore({
      mode: 'redis', production: true, getRedisClient: () => client,
      verifyRefreshToken, refreshTtlMs: REFRESH_TTL_MS,
    });
    const input = sessionInput({ sid: `sid-${order}`, accessJti: `access-${order}` });
    const register = () => store.register(input);
    const invalidate = () => store.invalidateUser('V050');
    const work = order === 'register-first'
      ? [register(), invalidate()]
      : [invalidate(), register()];

    await Promise.all(work);
    const active = await store.isActive(input.sid, input.userId, input.accessJti);
    const indexed = client.sets.get('gmp:auth:user:V050')?.has(input.sid) || false;
    expect(indexed).toBe(active);
    expect(active).toBe(order === 'invalidate-first');
  },
);

test('Redis register removes five stale indexed sids before enforcing the cap', async () => {
  const client = createRedisDouble();
  client.sets.set('gmp:auth:user:V050', new Set([
    'stale-1', 'stale-2', 'stale-3', 'stale-4', 'stale-5',
  ]));
  const store = createAuthClaimsSessionStore({
    mode: 'redis', production: true, getRedisClient: () => client,
    verifyRefreshToken, refreshTtlMs: REFRESH_TTL_MS, maxSessionsPerUser: 5,
  });

  await expect(store.register(sessionInput({
    sid: 'fresh', accessJti: 'fresh-access', refreshJti: 'fresh-refresh',
  }))).resolves.toEqual({ ok: true, sid: 'fresh' });
  expect(client.sets.get('gmp:auth:user:V050')).toEqual(new Set(['fresh']));
  await expect(store.isActive('fresh', 'V050', 'fresh-access')).resolves.toBe(true);
});
