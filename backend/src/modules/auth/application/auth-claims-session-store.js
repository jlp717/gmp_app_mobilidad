'use strict';

const crypto = require('crypto');

const SESSION_PREFIX = 'gmp:auth:session:';
const USER_PREFIX = 'gmp:auth:user:';
const REVOKED_PREFIX = 'gmp:auth:revoked-sid:';

class AuthSessionStoreError extends Error {
  constructor() {
    super('Authentication session store unavailable');
    this.name = 'AuthSessionStoreError';
    this.code = 'AUTH_SESSION_STORE_UNAVAILABLE';
    this.status = 503;
  }
}

function unavailable() {
  return new AuthSessionStoreError();
}

function invalidSession(message) {
  const error = new Error(message);
  error.code = 'AUTH_SESSION_INVALID';
  error.status = 401;
  return error;
}

function sessionLimitReached() {
  const error = new Error('Maximum active sessions reached');
  error.code = 'AUTH_SESSION_LIMIT_REACHED';
  error.status = 409;
  return error;
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createAuthClaimsSessionStore({
  mode = 'memory',
  production = false,
  getRedisClient = () => null,
  verifyRefreshToken,
  refreshTtlMs,
  redisTimeoutMs = 1000,
  maxSessionsPerUser = 5,
  now = () => Date.now(),
} = {}) {
  if (typeof verifyRefreshToken !== 'function' || !Number.isFinite(refreshTtlMs)) {
    throw new TypeError('verifyRefreshToken and refreshTtlMs are required');
  }
  const selectedMode = production ? 'redis' : String(mode || 'memory').trim().toLowerCase();
  if (!['memory', 'redis'].includes(selectedMode)) {
    throw new TypeError('session store mode must be memory or redis');
  }
  const requiresRedis = production || selectedMode === 'redis';
  const sessionLimit = Math.max(1, Number.parseInt(maxSessionsPerUser, 10) || 5);
  const redisIndexHardLimit = Math.max(20, sessionLimit * 4);
  const sessions = new Map();
  const userSessions = new Map();
  const revokedSids = new Map();

  function secondsUntil(expiresAt) {
    return Math.max(1, Math.ceil((expiresAt - now()) / 1000));
  }

  async function withTimeout(promise) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(unavailable()), redisTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function requireClient() {
    const client = getRedisClient();
    if (!client) throw unavailable();
    return client;
  }

  async function redisSetEx(client, key, ttl, value) {
    if (typeof client.setEx === 'function') return withTimeout(client.setEx(key, ttl, value));
    if (typeof client.setex === 'function') return withTimeout(client.setex(key, ttl, value));
    return withTimeout(client.set(key, value, { EX: ttl }));
  }

  async function redisGet(client, key) {
    return withTimeout(client.get(key));
  }

  async function redisDel(client, key) {
    return withTimeout(client.del(key));
  }

  async function redisSRem(client, key, value) {
    if (typeof client.sRem === 'function') return withTimeout(client.sRem(key, value));
    return withTimeout(client.srem(key, value));
  }


  async function redisRegisterSession(client, sessionKey, userKey, session) {
    if (typeof client.eval !== 'function') throw unavailable();
    // AUTH_REGISTER_V3: prune ghosts first, then drop oldest live sessions
    // until under the soft limit so a new mobile login is never blocked by
    // abandoned refresh tokens (common after cert probes / app kills).
    const script = `
      -- AUTH_REGISTER_V3
      local members = redis.call('SMEMBERS', KEYS[2])
      for _, sid in ipairs(members) do
        if redis.call('EXISTS', ARGV[5] .. sid) == 0 then
          redis.call('SREM', KEYS[2], sid)
        end
      end
      members = redis.call('SMEMBERS', KEYS[2])
      if #members > tonumber(ARGV[6]) then
        return -1
      end
      local is_member = redis.call('SISMEMBER', KEYS[2], ARGV[1])
      if is_member == 0 then
        local limit = tonumber(ARGV[4])
        while redis.call('SCARD', KEYS[2]) >= limit do
          local oldest_sid = nil
          local oldest_created = nil
          for _, sid in ipairs(redis.call('SMEMBERS', KEYS[2])) do
            local raw = redis.call('GET', ARGV[5] .. sid)
            if not raw then
              redis.call('SREM', KEYS[2], sid)
            else
              local ok, parsed = pcall(cjson.decode, raw)
              local created = 0
              if ok and type(parsed) == 'table' and parsed.createdAt then
                created = tonumber(parsed.createdAt) or 0
              end
              if oldest_created == nil or created < oldest_created then
                oldest_created = created
                oldest_sid = sid
              end
            end
          end
          if not oldest_sid then
            break
          end
          local old_key = ARGV[5] .. oldest_sid
          local ttl = redis.call('TTL', old_key)
          if ttl < 1 then ttl = tonumber(ARGV[3]) end
          redis.call('SET', ARGV[7] .. oldest_sid, '1', 'EX', ttl)
          redis.call('DEL', old_key)
          redis.call('SREM', KEYS[2], oldest_sid)
        end
      end
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
      redis.call('SADD', KEYS[2], ARGV[1])
      redis.call('EXPIRE', KEYS[2], ARGV[3])
      return 1
    `;
    const ttl = secondsUntil(session.expiresAt);
    const result = await withTimeout(client.eval(script, {
      keys: [sessionKey, userKey],
      arguments: [
        session.sid,
        JSON.stringify(session),
        String(ttl),
        String(sessionLimit),
        SESSION_PREFIX,
        String(redisIndexHardLimit),
        REVOKED_PREFIX,
      ],
    }));
    const numericResult = Number(result);
    if (numericResult === -1) throw unavailable();
    return numericResult === 1;
  }

  async function redisCompareAndSet(
    client, sessionKey, userKey, expectedField, expectedValue, nextSession,
  ) {
    if (typeof client.eval !== 'function') throw unavailable();
    const script = `
      -- AUTH_ROTATE_V2
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local current = cjson.decode(raw)
      if tostring(current[ARGV[1]]) ~= tostring(ARGV[2]) then return 0 end
      if tostring(current.userId) ~= tostring(ARGV[6]) then return 0 end
      redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
      redis.call('SADD', KEYS[2], ARGV[5])
      redis.call('EXPIRE', KEYS[2], ARGV[4])
      return 1
    `;
    const result = await withTimeout(client.eval(script, {
      keys: [sessionKey, userKey],
      arguments: [
        expectedField,
        String(expectedValue),
        JSON.stringify(nextSession),
        String(secondsUntil(nextSession.expiresAt)),
        nextSession.sid,
        nextSession.userId,
      ],
    }));
    return Number(result) === 1;
  }

  async function redisTransitionForAccess(
    client, currentSessionKey, nextSessionKey, userKey, revokedKey,
    currentSid, currentAccessJti, nextSession,
  ) {
    if (typeof client.eval !== 'function') throw unavailable();
    const script = `
      -- AUTH_PRIVILEGE_TRANSITION_V1
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
      local current = cjson.decode(raw)
      if tostring(current.accessJti) ~= tostring(ARGV[1]) then return 0 end
      if tostring(current.userId) ~= tostring(ARGV[2]) then return 0 end
      local old_ttl = redis.call('TTL', KEYS[1])
      if old_ttl < 1 then old_ttl = tonumber(ARGV[5]) end
      redis.call('SET', KEYS[4], '1', 'EX', old_ttl)
      redis.call('DEL', KEYS[1])
      redis.call('SREM', KEYS[3], ARGV[3])
      redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5])
      redis.call('SADD', KEYS[3], ARGV[6])
      redis.call('EXPIRE', KEYS[3], ARGV[5])
      return 1
    `;
    const result = await withTimeout(client.eval(script, {
      keys: [currentSessionKey, nextSessionKey, userKey, revokedKey],
      arguments: [
        currentAccessJti,
        nextSession.userId,
        currentSid,
        JSON.stringify(nextSession),
        String(secondsUntil(nextSession.expiresAt)),
        nextSession.sid,
      ],
    }));
    if (Number(result) === -1) throw invalidSession('Next session id already exists');
    return Number(result) === 1;
  }


  async function redisInvalidateUser(client, userKey) {
    if (typeof client.eval !== 'function') throw unavailable();
    const script = `
      -- AUTH_INVALIDATE_USER_V2
      local members = redis.call('SMEMBERS', KEYS[1])
      for _, sid in ipairs(members) do
        local session_key = ARGV[1] .. sid
        local revoked_key = ARGV[2] .. sid
        local ttl = redis.call('TTL', session_key)
        if ttl < 1 then ttl = tonumber(ARGV[3]) end
        redis.call('SET', revoked_key, '1', 'EX', ttl)
        redis.call('DEL', session_key)
      end
      redis.call('DEL', KEYS[1])
      return #members
    `;
    const result = await withTimeout(client.eval(script, {
      keys: [userKey],
      arguments: [
        SESSION_PREFIX,
        REVOKED_PREFIX,
        String(Math.max(1, Math.ceil(refreshTtlMs / 1000))),
      ],
    }));
    return Number(result) || 0;
  }
  function buildSession(input, { requireCurrentRefresh = false } = {}) {
    const sid = String(input?.sid || '').trim();
    const userId = String(input?.userId || '').trim();
    const refreshToken = String(input?.newRefreshToken || input?.refreshToken || '').trim();
    const accessJti = String(input?.accessJti || '').trim();
    const refreshJti = String(input?.refreshJti || '').trim();
    if (!sid || !userId || !refreshToken || !accessJti || !refreshJti) {
      const error = new Error('Canonical session identifiers are required');
      error.code = 'AUTH_SESSION_INVALID';
      error.status = 401;
      throw error;
    }
    if (requireCurrentRefresh && !String(input?.currentRefreshToken || '').trim()) {
      const error = new Error('Current refresh token is required');
      error.code = 'AUTH_SESSION_INVALID';
      error.status = 401;
      throw error;
    }
    const refreshPayload = verifyRefreshToken(refreshToken);
    if (!refreshPayload
      || refreshPayload.sid !== sid
      || refreshPayload.sub !== userId
      || refreshPayload.jti !== refreshJti) {
      const error = new Error('Refresh token does not match the canonical session');
      error.code = 'AUTH_SESSION_INVALID';
      error.status = 401;
      throw error;
    }
    const createdAt = now();
    return Object.freeze({
      sid,
      userId,
      refreshHash: hashRefreshToken(refreshToken),
      accessJti,
      refreshJti,
      userAgent: String(input?.userAgent || 'unknown').slice(0, 200),
      ip: String(input?.ip || 'unknown').slice(0, 100),
      createdAt,
      expiresAt: createdAt + refreshTtlMs,
    });
  }

  function rememberLocal(session) {
    const owned = userSessions.get(session.userId) || new Set();
    if (!owned.has(session.sid) && owned.size >= sessionLimit) {
      const oldest = [...owned]
        .map((sid) => sessions.get(sid))
        .filter(Boolean)
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (oldest) {
        sessions.delete(oldest.sid);
        revokedSids.set(oldest.sid, oldest.expiresAt);
        owned.delete(oldest.sid);
      }
    }
    owned.add(session.sid);
    userSessions.set(session.userId, owned);
    revokedSids.delete(session.sid);
    sessions.set(session.sid, session);
  }

  function removeLocal(sid, userId, expiresAt = now() + refreshTtlMs) {
    revokedSids.set(sid, expiresAt);
    sessions.delete(sid);
    const owned = userSessions.get(userId);
    owned?.delete(sid);
    if (owned?.size === 0) userSessions.delete(userId);
  }

  async function readiness() {
    if (!requiresRedis) {
      return Object.freeze({ ready: true, required: false, mode: 'memory', shared: false });
    }
    try {
      const client = requireClient();
      if (typeof client.ping !== 'function') throw unavailable();
      const pong = await withTimeout(client.ping());
      if (String(pong).trim().toUpperCase() !== 'PONG') throw unavailable();
      return Object.freeze({ ready: true, required: true, mode: 'redis', shared: true });
    } catch (_error) {
      return Object.freeze({
        ready: false,
        required: true,
        mode: 'redis',
        shared: true,
        code: 'AUTH_SESSION_STORE_UNAVAILABLE',
      });
    }
  }

  async function register(input) {
    const session = buildSession(input);
    if (!requiresRedis) {
      rememberLocal(session);
      return Object.freeze({ ok: true, sid: session.sid });
    }
    const client = requireClient();
    const sessionKey = `${SESSION_PREFIX}${session.sid}`;
    const userKey = `${USER_PREFIX}${session.userId}`;
    try {
      const registered = await redisRegisterSession(client, sessionKey, userKey, session);
      if (!registered) throw sessionLimitReached();
      return Object.freeze({ ok: true, sid: session.sid });
    } catch (error) {
      if (error?.code === 'AUTH_SESSION_LIMIT_REACHED') throw error;
      if (error instanceof AuthSessionStoreError) throw error;
      throw unavailable();
    }
  }

  async function getSession(sid) {
    if (!requiresRedis) return sessions.get(sid) || null;
    try {
      const raw = await redisGet(requireClient(), `${SESSION_PREFIX}${sid}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      throw unavailable();
    }
  }

  async function isRevoked(sid) {
    if (!requiresRedis) {
      const expiresAt = revokedSids.get(sid);
      return Boolean(expiresAt && expiresAt > now());
    }
    try {
      return (await redisGet(requireClient(), `${REVOKED_PREFIX}${sid}`)) === '1';
    } catch (_error) {
      throw unavailable();
    }
  }

  async function isActive(sid, userId, accessJti) {
    const normalizedSid = String(sid || '').trim();
    const normalizedUser = String(userId || '').trim();
    const normalizedAccessJti = String(accessJti || '').trim();
    if (!normalizedAccessJti) throw invalidSession('Access token jti is required');
    if (!normalizedSid || !normalizedUser || await isRevoked(normalizedSid)) return false;
    const session = await getSession(normalizedSid);
    if (!session || session.userId !== normalizedUser || session.expiresAt <= now()) return false;
    return session.accessJti === normalizedAccessJti;
  }

  async function rotate(input) {
    const next = buildSession(input, { requireCurrentRefresh: true });
    const expectedHash = hashRefreshToken(input.currentRefreshToken);
    if (!requiresRedis) {
      const current = sessions.get(next.sid);
      if (!current || current.userId !== next.userId || current.expiresAt <= now()) return false;
      if (current.refreshHash !== expectedHash) return false;
      sessions.set(next.sid, next);
      return true;
    }
    try {
      return await redisCompareAndSet(
        requireClient(), `${SESSION_PREFIX}${next.sid}`, `${USER_PREFIX}${next.userId}`,
        'refreshHash', expectedHash, next,
      );
    } catch (error) {
      if (error instanceof AuthSessionStoreError) throw error;
      throw unavailable();
    }
  }

  async function rotateForAccess(input) {
    const next = buildSession(input);
    const currentAccessJti = String(input?.currentAccessJti || '').trim();
    if (!currentAccessJti) return false;
    if (!requiresRedis) {
      const current = sessions.get(next.sid);
      if (!current || current.userId !== next.userId || current.expiresAt <= now()) return false;
      if (current.accessJti !== currentAccessJti) return false;
      sessions.set(next.sid, next);
      return true;
    }
    try {
      return await redisCompareAndSet(
        requireClient(), `${SESSION_PREFIX}${next.sid}`, `${USER_PREFIX}${next.userId}`,
        'accessJti', currentAccessJti, next,
      );
    } catch (error) {
      if (error instanceof AuthSessionStoreError) throw error;
      throw unavailable();
    }
  }

  // A role/mode switch crosses an authorization boundary. Replace the old
  // session atomically so every token carrying the previous SID is revoked.
  async function transitionForAccess(input) {
    const currentSid = String(input?.currentSid || '').trim();
    const currentAccessJti = String(input?.currentAccessJti || '').trim();
    const next = buildSession(input);
    if (!currentSid || !currentAccessJti || currentSid === next.sid) return false;

    if (!requiresRedis) {
      const current = sessions.get(currentSid);
      if (!current || current.userId !== next.userId || current.expiresAt <= now()) return false;
      if (current.accessJti !== currentAccessJti || sessions.has(next.sid)) return false;
      removeLocal(currentSid, next.userId, current.expiresAt);
      rememberLocal(next);
      return true;
    }

    try {
      return await redisTransitionForAccess(
        requireClient(),
        `${SESSION_PREFIX}${currentSid}`,
        `${SESSION_PREFIX}${next.sid}`,
        `${USER_PREFIX}${next.userId}`,
        `${REVOKED_PREFIX}${currentSid}`,
        currentSid,
        currentAccessJti,
        next,
      );
    } catch (error) {
      if (error?.code === 'AUTH_SESSION_INVALID') throw error;
      if (error instanceof AuthSessionStoreError) throw error;
      throw unavailable();
    }
  }

  async function revoke(sid, { userId } = {}) {
    const normalizedSid = String(sid || '').trim();
    if (!normalizedSid) {
      const error = new Error('Session id required');
      error.code = 'AUTH_SESSION_INVALID';
      error.status = 401;
      throw error;
    }
    if (!requiresRedis) {
      const current = sessions.get(normalizedSid);
      removeLocal(normalizedSid, String(userId || current?.userId || ''), current?.expiresAt);
      return Object.freeze({ ok: true });
    }
    try {
      const client = requireClient();
      const current = await getSession(normalizedSid);
      const resolvedUser = String(userId || current?.userId || '').trim();
      const expiresAt = current?.expiresAt || now() + refreshTtlMs;
      await redisSetEx(client, `${REVOKED_PREFIX}${normalizedSid}`, secondsUntil(expiresAt), '1');
      await redisDel(client, `${SESSION_PREFIX}${normalizedSid}`);
      if (resolvedUser) await redisSRem(client, `${USER_PREFIX}${resolvedUser}`, normalizedSid);
      return Object.freeze({ ok: true });
    } catch (_error) {
      throw unavailable();
    }
  }

  async function invalidateUser(userId) {
    const normalizedUser = String(userId || '').trim();
    if (!normalizedUser) return Object.freeze({ ok: true, count: 0 });
    if (!requiresRedis) {
      const ids = [...(userSessions.get(normalizedUser) || [])];
      for (const sid of ids) removeLocal(sid, normalizedUser, sessions.get(sid)?.expiresAt);
      return Object.freeze({ ok: true, count: ids.length });
    }
    try {
      const count = await redisInvalidateUser(requireClient(), `${USER_PREFIX}${normalizedUser}`);
      return Object.freeze({ ok: true, count });
    } catch (_error) {
      throw unavailable();
    }
  }

  function reset() {
    sessions.clear();
    userSessions.clear();
    revokedSids.clear();
  }

  return Object.freeze({
    mode: selectedMode,
    sessions,
    revokedSids,
    readiness,
    register,
    isActive,
    rotate,
    rotateForAccess,
    transitionForAccess,
    revoke,
    invalidateUser,
    reset,
  });
}

module.exports = {
  AuthSessionStoreError,
  createAuthClaimsSessionStore,
};
