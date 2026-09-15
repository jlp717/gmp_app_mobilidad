## Summary
- BE-08: Redis reconecta de forma indefinida (nunca `return false`).
- `isConnected` solo en evento `ready`; backoff `Math.min(30000, 200 * 2 ** min(retries, 7))`.
- Watchdog 30s (`unref`) llama `init()` si Redis sigue caído; `init()` es idempotente.

## Test plan
- [x] `node backend/scripts/_tmp-be08-accept.js` exit 0 (Jest se cuelga en esta máquina; patrón mínimo de la tarea).
- [ ] `cd backend && npm test -- redis-reconnect` exit 0 en CI.
- [ ] Tras merge: si Redis cae y vuelve, `isConnected` recupera sin `pm2 restart`.

## Files
- `backend/services/redis-cache.js`
- `backend/__tests__/redis-reconnect.test.js`
