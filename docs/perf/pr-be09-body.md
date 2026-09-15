## Summary
- BE-09: PM2 `shutdown_with_message` ahora tiene `process.on('message')` → `gracefulShutdown('pm2-shutdown')`.
- `kill_timeout` 15 s para dar tiempo a `closePool()` / Redis.
- Warmup pesado solo en `INSTANCE_ID === '0'` (sigue el lock Redis SET NX en el líder).
- Runbook: `pm2 reload` recomendado fuera de horario, **solo con aprobación de Javier**.

## Test plan
- [x] Comprobación de fuentes: `kill_timeout=15000`, handler `shutdown`, skip followers.
- [ ] `cd backend && npm test -- runtime-performance-config` en CI (Jest se cuelga en el ejecutor local).
- [ ] En pre (Javier): `pm2 restart gmp-api-pre` y log "Graceful shutdown" sin SIGKILL.

## Files
- `backend/server.js`
- `backend/ecosystem.config.js`
- `backend/services/cache-preloader.js`
- `backend/__tests__/runtime-performance-config.test.js`
- `docs/runbooks/deploy.md`
