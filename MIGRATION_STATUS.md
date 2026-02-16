# GMP App - Migration Status (JS → TypeScript)

> Last updated: 2025-07-16

## Overview

The GMP App backend is being migrated from legacy JavaScript (`routes/*.js`) to TypeScript (`src/routes/*.routes.ts` → `src/services/*.service.ts`).

The migration uses a **feature toggle** (`USE_TS_ROUTES`) in `server.js` to switch between legacy and compiled TS routes without downtime.

## Migration Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1. TS Codebase | ✅ Complete | All 14 route modules rewritten in TS with Joi validation |
| 2. Unit Tests | ✅ Complete | 311 Jest tests passing, coverage >38% on TS code |
| 3. Security Patch | ✅ Complete | SQL injection sanitization in `buildVendedorFilter` |
| 4. Feature Toggle | ✅ Complete | `USE_TS_ROUTES` env var in `server.js` |
| 5. Swagger Docs | ✅ Complete | OpenAPI 3.0 spec at `/api-docs` (non-prod) |
| 6. E2E Tests | ✅ Complete | Integration, security, performance, resilience |
| 7. CI Pipeline | ✅ Complete | GitHub Actions: test → security → build → Flutter |
| 8. DB Indices | ✅ Script Ready | `scripts/db-indices.sql` - needs DBA execution |
| 9. Production Toggle | ⏳ Pending | Switch `USE_TS_ROUTES=true` in production |
| 10. Legacy Removal | ⏳ Pending | Remove `routes/*.js` after validation |

## Route Migration Matrix

| Route | Legacy JS | TS Route | TS Service | Tests | Status |
|-------|-----------|----------|------------|-------|--------|
| Auth | `routes/auth.js` | `src/routes/auth.routes.ts` | `src/controllers/auth.controller.ts` | ✅ | ✅ Migrated |
| Dashboard | `routes/dashboard.js` | `src/routes/dashboard.routes.ts` | `src/services/dashboard.service.ts` | ✅ | ✅ Migrated |
| Commissions | `routes/commissions.js` | `src/routes/commissions.routes.ts` | `src/services/commissions.service.ts` | ✅ | ✅ Migrated |
| Objectives | `routes/objectives.js` | `src/routes/objectives.routes.ts` | `src/services/objectives.service.ts` | ✅ | ✅ Migrated |
| Entregas | `routes/entregas.js` | `src/routes/entregas.routes.ts` | `src/services/entregas.service.ts` | ✅ | ✅ Migrated |
| Repartidor | `routes/repartidor.js` | `src/routes/repartidor.routes.ts` | `src/services/repartidor.service.ts` | ✅ | ✅ Migrated |
| Clients | `routes/clients.js` | `src/routes/clientes.routes.ts` | `src/services/clientes.service.ts` | ⬜ | ✅ Migrated |
| Products | `routes/master.js` | `src/routes/products.routes.ts` | `src/services/products.service.ts` | ⬜ | ✅ Migrated |
| Ventas | N/A (new) | `src/routes/ventas.routes.ts` | `src/services/ventas.service.ts` | ⬜ | ✅ New |
| Cobros | N/A (new) | `src/routes/cobros.routes.ts` | `src/services/cobros.service.ts` | ✅ | ✅ New |
| Promociones | N/A (new) | `src/routes/promociones.routes.ts` | `src/services/promociones.service.ts` | ⬜ | ✅ New |
| Rutero | `routes/planner.js` | `src/routes/rutero.routes.ts` | `src/services/rutero.service.ts` | ⬜ | ✅ Migrated |
| Pedidos | N/A (new) | `src/routes/pedidos.routes.ts` | `src/services/pedidos.service.ts` | ⬜ | ✅ New |
| Facturas | `routes/facturas.js` | `src/routes/facturas.routes.ts` | `src/services/facturas.service.ts` | ⬜ | ✅ Migrated |

## Security Improvements

### SQL Injection Patches Applied
- `buildVendedorFilter()` in `utils/common.js` — alphanumeric-only sanitization
- `buildVendedorFilterLACLAE()` in `utils/common.js` — same sanitization
- Added `sanitizeForSQL()` and `sanitizeCodeList()` utility functions
- TS layer uses parameterized queries via `odbcPool.query(sql, params)` — inherently safe

### Legacy Routes Still Vulnerable (When `USE_TS_ROUTES=false`)
The following legacy JS routes still have direct SQL interpolation sites beyond `buildVendedorFilter`:
- `routes/objectives.js` — `vendorCode` and `clientList` interpolation
- `routes/repartidor.js` — `repartidorCode` in INSERT/UPDATE
- `routes/planner.js` — various filter params
- `routes/commissions.js` — vendor code checks

**Mitigation**: These are sanitized at the filter level now, and the TS routes eliminate them entirely.

## How to Enable TS Routes

### Development
```bash
cd backend
npm run build:ts
npm run start:ts
# Visit http://localhost:3334/api-docs for Swagger docs
```

### Production (PM2)
```bash
cd backend
npm run build:ts
pm2 start ecosystem.config.js --env ts
# or
USE_TS_ROUTES=true pm2 restart gmp-api --update-env
```

### Rollback
```bash
cd backend
npm run rollback
# or manually:
USE_TS_ROUTES=false pm2 restart gmp-api --update-env
```

## Test Suites

| Suite | Location | Count | Status |
|-------|----------|-------|--------|
| Unit Tests | `src/__tests__/*.test.ts` | 311 | ✅ Pass |
| E2E Integration | `src/__tests__/integration/` | ~30 | ✅ New |
| Security (SQLi) | `src/__tests__/security/` | ~180+ | ✅ New |
| Performance | `src/__tests__/performance/` | ~10 | ✅ New |
| Resilience | `src/__tests__/resilience/` | ~10 | ✅ New |

## Files Created/Modified in Migration

### New Files
- `backend/tsconfig.json` — TS compilation config (src/ → dist/)
- `backend/scripts/build.sh` — Build script
- `backend/scripts/rollback.sh` — Rollback to legacy
- `backend/scripts/db-indices.sql` — DB2 performance indices
- `backend/src/config/swagger.ts` — Swagger/OpenAPI setup
- `backend/src/__tests__/integration/endpoints.test.ts`
- `backend/src/__tests__/security/sql-injection.test.ts`
- `backend/src/__tests__/performance/latency.test.ts`
- `backend/src/__tests__/resilience/degradation.test.ts`
- `.github/workflows/test.yml` — CI pipeline

### Modified Files
- `backend/server.js` — Feature toggle (`USE_TS_ROUTES`)
- `backend/ecosystem.config.js` — Added `env_ts` config
- `backend/package.json` — Added `build:ts`, `start:ts`, `rollback` scripts
- `backend/utils/common.js` — SQL injection sanitization
- `backend/src/index.ts` — Swagger documentation mount
