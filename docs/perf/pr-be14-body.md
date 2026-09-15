## Summary
- BE-14: quita `helmet()` duplicado (deja CSP/HSTS de `createSecurityHeaders`).
- Elimina `req.log` sin usos y las apps PM2 con scripts inexistentes.
- Poda deps no usadas: groq-sdk, hpp, moment, morgan, xss-clean. OTel sigue no-op.
- `pg` y `csv-parse` se mantienen (KPI). Lockfile no regenerado (disco).

## Test plan
- [x] Fuentes: sin `app.use(helmet())`, sin `req.log`, ecosystem solo `gmp-api`.
- [ ] CI: `npm test`; `npm ls --depth=0`. Regenerar lock en CI si hace falta.

## Files
- `backend/app.js`
- `backend/ecosystem.config.js`
- `backend/package.json`
- `backend/__tests__/backend-hygiene.test.js`
- `backend/__tests__/runtime-performance-config.test.js`
