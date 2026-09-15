## Summary
- BE-13: `http-cache` no-store en cobros, repartidor-finanzas, liquidaciones y entregas/pendientes (datos de dinero).
- Invalidación local publica `cache:invalidate`; cada worker limpia su Map vía `onInvalidationPattern`.
- Pedidos/facturas de lectura siguen cacheables. No cambia importes ni reglas de cobro/liquidación.

## Test plan
- [x] Fuentes: no-store money paths; publish + hook.
- [ ] CI `npm test -- http-cache` (Jest se cuelga en el ejecutor local).

## Files
- `backend/middleware/http-cache.js`
- `backend/__tests__/http-cache-middleware.test.js`
