## Summary
- BE-11: `trust proxy` = `loopback`. `clientIp()` usa `CF-Connecting-IP` solo si el peer TCP es loopback (túnel); si no, ignora el header.
- Rate-limit, brute-force y audit usan esa IP.
- `/api/metrics` en loopback con `CF-Connecting-IP` exige token (`METRICS_TOKEN` / internos); scrape local sin ese header sigue permitido.

## Test plan
- [x] Fuentes: `trust proxy` loopback; CF desde loopback vs remoto.
- [ ] CI: `npm test -- security prometheus audit` (Jest se cuelga en el ejecutor local).
- [ ] Pre: `curl -H 'CF-Connecting-IP: 1.2.3.4' http://localhost:3002/api/metrics` → 401/403.

## Files
- `backend/app.js`
- `backend/middleware/security.js`
- `backend/middleware/prometheus-metrics.js`
- `backend/middleware/audit.js`
- tests de security / metrics / audit
