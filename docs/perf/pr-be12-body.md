## Summary
- BE-12: Winston ya no escribe `server.log`/`error.log` (PM2 captura stdout).
- `[AUDIT]` de 2xx pasa a `debug`; immutable log rota a 10 MB.
- `logQuery=false` en el pool DDD y en `filters.js`. `db.js` no se toca (default sigue true; `DB_QUERY_LOG_ALL` no hace falta).

## Test plan
- [x] Fuentes: sin File transports; audit 2xx debug; pool `query(..., false, true)`.
- [ ] CI `npm test` (Jest se cuelga en el ejecutor local).

## Files
- `backend/middleware/logger.js`
- `backend/middleware/audit.js`
- `backend/src/core/infrastructure/database/db2-connection-pool.js`
- `backend/routes/filters.js`
