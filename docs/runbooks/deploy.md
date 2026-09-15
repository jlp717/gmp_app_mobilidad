# Deploy GMP API (PM2)

Whitelist de producción (sin Javier): `git pull origin test` + `pm2 restart gmp-api`.

## Reload rodante (requiere aprobación de Javier)

`pm2 reload gmp-api` **no** está en la whitelist. Solo con OK explícito de Javier.

Si se aprueba:

- Usar `pm2 reload gmp-api` (rodante) en lugar de `restart` para no cortar el cluster de golpe.
- Fuera de 08:00–20:00 salvo hotfix.
- `kill_timeout` del ecosystem es 15 s y `server.js` atiende `process.on('message')` con `shutdown` → `gracefulShutdown('pm2-shutdown')` para cerrar HTTP/ODBC/Redis antes de SIGKILL.

No ejecutar `pm2 reload`, `pm2 save`, `pm2 set` ni `pm2 start` desde este runbook sin esa aprobación.
