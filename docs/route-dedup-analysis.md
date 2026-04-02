# Route Deduplication Analysis

**Date:** 2026-04-02
**Author:** Agent #10 (Integration Specialist)
**Scope:** Legacy routes vs DDD adapter routes in `backend/src/shared/routes/ddd-adapters.js`

---

## Executive Summary

The DDD adapter layer (`ddd-adapters.js`) is a **skeleton implementation** — it provides route scaffolding for 5 modules but lacks the vast majority of endpoints that the legacy routes expose. The DDD routes are **not production-ready replacements** for the legacy routes. The feature toggle (`USE_DDD_ROUTES`) works correctly, but enabling it would break the mobile app due to massive API surface gaps.

---

## 1. PEDIDOS Module

### Legacy Endpoints (`backend/routes/pedidos.js`) — 28 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List orders with filters |
| GET | `/products` | Product catalog search |
| GET | `/products/:code` | Product detail |
| GET | `/products/:code/stock` | Real-time stock |
| GET | `/client-prices/:clientCode` | Client tariff/pricing |
| GET | `/families` | Product families |
| GET | `/brands` | Product brands |
| GET | `/client-balance/:clientCode` | Client balance |
| GET | `/analytics` | Order analytics |
| GET | `/orders/stats` | Order statistics |
| GET | `/promotions` | Active promotions |
| GET | `/recommendations/:clientCode` | Product recommendations |
| GET | `/product-history/:productCode/:clientCode` | Monthly purchase breakdown |
| GET | `/similar-products/:code` | Stock alternatives |
| GET | `/search-products` | Search products with stock |
| GET | `/:id` | Order detail |
| GET | `/:id/albaran` | Linked albaranes |
| GET | `/:id/clone` | Clone order |
| GET | `/:id/pdf` | Order PDF data |
| POST | `/create` | Create order |
| POST | `/complementary` | Complementary products |
| PUT | `/:id/lines` | Add order line |
| PUT | `/:id/lines/:lineId` | Update order line |
| DELETE | `/:id/lines/:lineId` | Delete order line |
| PUT | `/:id/confirm` | Confirm draft order |
| DELETE | `/:id` | Cancel order |
| PUT | `/:id/status` | Update order status |
| PUT | `/:id/lines/:lineId/delete` | Delete line (PUT alias) |
| PUT | `/:id/cancel` | Cancel order (PUT alias) |
| GET | `/debug/estados` | Debug: state docs |
| POST | `/debug/set-estado` | Debug: set state |
| GET | `/debug/list-estados` | Debug: list states |

### DDD Endpoints (`createPedidosRoutes()`) — 7 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/products` | Product catalog search |
| GET | `/products/:code` | Product detail |
| GET | `/promotions` | Active promotions |
| GET | `/history` | Order history (auth-required) |
| GET | `/stats` | Order stats (auth-required) |
| POST | `/cart/add` | Add to cart |
| POST | `/confirm` | Confirm order |

### Feature Parity Analysis

| Legacy Endpoint | DDD Equivalent | Parity |
|----------------|---------------|--------|
| `GET /products` | `GET /products` | ✅ Same signature |
| `GET /products/:code` | `GET /products/:code` | ✅ Same signature |
| `GET /products/:code/stock` | ❌ Missing | 🔴 **MISSING** |
| `GET /client-prices/:clientCode` | ❌ Missing | 🔴 **MISSING** |
| `GET /families` | ❌ Missing | 🔴 **MISSING** |
| `GET /brands` | ❌ Missing | 🔴 **MISSING** |
| `GET /client-balance/:clientCode` | ❌ Missing | 🔴 **MISSING** |
| `GET /analytics` | ❌ Missing | 🔴 **MISSING** |
| `GET /orders/stats` | `GET /stats` | ⚠️ Different path, different auth model |
| `GET /promotions` | `GET /promotions` | ✅ Same signature |
| `GET /recommendations/:clientCode` | ❌ Missing | 🔴 **MISSING** |
| `GET /product-history/:productCode/:clientCode` | ❌ Missing | 🔴 **MISSING** |
| `GET /similar-products/:code` | ❌ Missing | 🔴 **MISSING** |
| `GET /search-products` | ❌ Missing | 🔴 **MISSING** |
| `GET /` (list orders) | ❌ Missing | 🔴 **MISSING** |
| `GET /:id` (order detail) | ❌ Missing | 🔴 **MISSING** |
| `GET /:id/albaran` | ❌ Missing | 🔴 **MISSING** |
| `GET /:id/clone` | ❌ Missing | 🔴 **MISSING** |
| `GET /:id/pdf` | ❌ Missing | 🔴 **MISSING** |
| `POST /create` | `POST /confirm` | ⚠️ Different semantics (create vs confirm) |
| `POST /complementary` | ❌ Missing | 🔴 **MISSING** |
| `PUT /:id/lines` | ❌ Missing | 🔴 **MISSING** |
| `PUT /:id/lines/:lineId` | ❌ Missing | 🔴 **MISSING** |
| `DELETE /:id/lines/:lineId` | ❌ Missing | 🔴 **MISSING** |
| `PUT /:id/confirm` | ❌ Missing | 🔴 **MISSING** |
| `DELETE /:id` | ❌ Missing | 🔴 **MISSING** |
| `PUT /:id/status` | ❌ Missing | 🔴 **MISSING** |
| Debug endpoints | ❌ Missing | ✅ Intentionally omitted |

**Parity Score: 3/28 (10.7%)** — Only 3 endpoints have true parity; 25 are missing.

### API Compatibility

- **Response format:** DDD uses `{ success: true, ... }` — matches legacy ✅
- **Auth model:** DDD uses `req.user?.code` for history/stats, legacy doesn't require auth for most endpoints — ⚠️ **Incompatible**
- **Caching:** DDD has its own `ResponseCache`, legacy uses `cachedQuery` + Redis — different implementations but same goal

### Recommendation: **Keep legacy as source of truth**

The DDD pedidos routes are a thin skeleton. The legacy route has 4x more endpoints including the critical order CRUD (`/:id`, `/create`, `/:id/confirm`, `/:id/lines/*`). Do not enable `USE_DDD_ROUTES` for pedidos until the DDD layer implements at minimum: order CRUD, stock, pricing, recommendations, and line management.

---

## 2. COBROS Module

### Legacy Endpoints (`backend/routes/cobros.js`) — 3 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/:codigoCliente/pendientes` | Pending collections for client |
| POST | `/:codigoCliente/registrar` | Register a payment |
| GET | `/pending-summary/:vendedorCode` | Pending summary by vendor |

### DDD Endpoints (`createCobrosRoutes()`) — 3 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/:codigoCliente/pendientes` | Pending collections |
| POST | `/register` | Register payment |
| GET | `/:codigoCliente/historico` | Payment history |

### Feature Parity Analysis

| Legacy Endpoint | DDD Equivalent | Parity |
|----------------|---------------|--------|
| `GET /:codigoCliente/pendientes` | `GET /:codigoCliente/pendientes` | ✅ Same path |
| `POST /:codigoCliente/registrar` | `POST /register` | ⚠️ Different path, missing `codigoCliente` in URL |
| `GET /pending-summary/:vendedorCode` | ❌ Missing | 🔴 **MISSING** |
| N/A | `GET /:codigoCliente/historico` | 🟢 DDD-only (new feature) |

**Parity Score: 2/3 (66.7%)** — One critical endpoint missing (`pending-summary`).

### API Compatibility

- **Response format:** DDD returns `{ success: true, pendientes }` vs legacy `{ success: true, cobros, resumen }` — ⚠️ **Different field names**
- **Payment registration:** Legacy uses `/:codigoCliente/registrar` with body fields `referencia, importe, formaPago, observaciones, tipoVenta, tipoModo, tipoUsuario, codigoUsuario`. DDD uses `/register` with `clientCode, amount, paymentMethod, reference, observations` — ⚠️ **Different field names and path structure**
- **Missing `pending-summary`:** This endpoint is used by the dashboard for vendor-level overview — **breaking change**

### Recommendation: **Keep legacy as source of truth**

The DDD cobros routes have the right structure but need: (1) `pending-summary` endpoint, (2) response format alignment (`cobros` vs `pendientes`, `resumen` field), (3) payment registration path fix to include `codigoCliente` in URL.

---

## 3. ENTREGAS Module

### Legacy Endpoints (`backend/routes/entregas.js`) — 12 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/pendientes/:repartidorId` | Pending deliveries for repartidor |
| GET | `/payment-conditions` | List payment conditions |
| GET | `/albaran/:numero/:ejercicio` | Albaran detail |
| POST | `/update` | Update delivery status |
| POST | `/uploads/photo` | Upload delivery photo |
| POST | `/uploads/signature` | Save delivery signature |
| GET | `/signers/:clientCode` | Get client signers |
| POST | `/receipt/:entregaId` | Generate delivery receipt PDF |
| POST | `/receipt/:entregaId/email` | Email receipt |
| POST | `/receipt/:entregaId/whatsapp` | WhatsApp share receipt |
| GET | `/receipt/:entregaId` | (implicit from path structure) |
| POST | `/receipt/:entregaId/email` | Email receipt |

### DDD Endpoints (`createEntregasRoutes()`) — 5 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/albaranes` | List albaranes |
| GET | `/albaranes/:id` | Albaran detail |
| POST | `/albaranes/:id/deliver` | Mark as delivered |
| GET | `/gamification` | Gamification stats |
| GET | `/summary` | Route summary |

### Feature Parity Analysis

| Legacy Endpoint | DDD Equivalent | Parity |
|----------------|---------------|--------|
| `GET /pendientes/:repartidorId` | `GET /albaranes` | ⚠️ Different path, different param source |
| `GET /albaran/:numero/:ejercicio` | `GET /albaranes/:id` | ⚠️ Different ID format |
| `POST /update` | `POST /albaranes/:id/deliver` | ⚠️ Different semantics |
| `POST /uploads/photo` | ❌ Missing | 🔴 **MISSING** |
| `POST /uploads/signature` | ❌ Missing | 🔴 **MISSING** |
| `GET /signers/:clientCode` | ❌ Missing | 🔴 **MISSING** |
| `POST /receipt/:entregaId` | ❌ Missing | 🔴 **MISSING** |
| `POST /receipt/:entregaId/email` | ❌ Missing | 🔴 **MISSING** |
| `POST /receipt/:entregaId/whatsapp` | ❌ Missing | 🔴 **MISSING** |
| `GET /payment-conditions` | ❌ Missing | 🔴 **MISSING** |
| N/A | `GET /gamification` | 🟢 DDD-only (new) |
| N/A | `GET /summary` | 🟢 DDD-only (new) |

**Parity Score: 0/12 (0%)** — No endpoint has true path + signature parity.

### API Compatibility

- **ID format:** Legacy uses composite IDs like `EJERCICIO-SERIE-TERMINAL-NUMERO-CLIENTE`. DDD uses simple `:id` — ⚠️ **Breaking change**
- **Auth model:** DDD requires `req.user?.code` for all endpoints, legacy gets `repartidorId` from URL params — ⚠️ **Incompatible**
- **Response format:** Both use `{ success: true, ... }` ✅

### Recommendation: **Keep legacy as source of truth**

The entregas DDD routes are the most divergent from legacy. The legacy route handles photo uploads, signature capture, receipt generation, WhatsApp sharing, and payment conditions — none of which exist in DDD. The DDD version introduces different URL patterns and authentication requirements that would break the Flutter app.

---

## 4. RUTERO/PLANNER Module

### Legacy Endpoints (`backend/routes/planner.js`) — 14+ endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/router/calendar` | Router calendar by month |
| GET | `/rutero/week` | Weekly client counts (cached) |
| GET | `/rutero/vendedores` | List vendors |
| POST | `/rutero/move_clients` | Move clients between days |
| POST | `/rutero/config` | Save route configuration |
| GET | `/rutero/config` | Get route configuration |
| GET | `/rutero/counts` | Day counts |
| GET | `/rutero/positions/:day` | Available positions |
| POST | `/rutero/reload-cache` | Full cache reload |
| GET | `/rutero/day-direct/:day` | Direct DB query (no cache) |
| POST | `/rutero/reload-cache-old` | Old cache reload |
| GET | `/rutero/day/:day` | Daily client list with sales |
| GET | `/diagnose/client/:code` | Client diagnostic |
| GET | `/diagnose/vendor/:code` | Vendor cache diagnostic |
| GET | `/rutero/client/:code/detail` | Client year comparison |

### DDD Endpoints (`createRuteroRoutes()`) — 4 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/config` | Get ruta config |
| PUT | `/config/:id/order` | Update order |
| GET | `/commissions` | Get commissions |
| GET | `/summary` | Day summary |

### Feature Parity Analysis

| Legacy Endpoint | DDD Equivalent | Parity |
|----------------|---------------|--------|
| `GET /rutero/config` | `GET /config` | ⚠️ Different path, different params |
| `POST /rutero/config` | ❌ Missing | 🔴 **MISSING** (bulk save) |
| `POST /rutero/move_clients` | `PUT /config/:id/order` | ⚠️ Different semantics |
| `GET /rutero/week` | ❌ Missing | 🔴 **MISSING** |
| `GET /rutero/day/:day` | ❌ Missing | 🔴 **MISSING** |
| `GET /rutero/vendedores` | ❌ Missing | 🔴 **MISSING** |
| `GET /router/calendar` | ❌ Missing | 🔴 **MISSING** |
| `GET /rutero/counts` | ❌ Missing | 🔴 **MISSING** |
| `GET /rutero/positions/:day` | ❌ Missing | 🔴 **MISSING** |
| `POST /rutero/reload-cache` | ❌ Missing | 🔴 **MISSING** |
| `GET /rutero/client/:code/detail` | ❌ Missing | 🔴 **MISSING** |
| N/A | `GET /commissions` | 🟢 DDD-only (new) |
| N/A | `GET /summary` | 🟢 DDD-only (new) |

**Parity Score: 0/14 (0%)** — No endpoint has true path + signature parity.

### API Compatibility

- **Param naming:** Legacy uses `vendedor` and `dia`, DDD uses `vendorCode` and `date` — ⚠️ **Breaking change**
- **Config save:** Legacy has a sophisticated bulk save with smart merge, ghost blocking, and audit logging. DDD only has single-item `PUT /config/:id/order` — 🔴 **Massively reduced functionality**
- **Cache management:** Legacy has full cache reload, direct DB bypass, and Redis invalidation. DDD has none of this.

### Recommendation: **Keep legacy as source of truth**

The rutero/planner module is the most complex in the entire backend. The legacy version handles caching (LACLAE + CDVI + RUTERO_CONFIG), smart merge logic, audit logging, email notifications, GPS data, year-over-year sales comparison, and diagnostic tools. The DDD version is a minimal stub.

---

## 5. AUTH Module

### Legacy Endpoints (`backend/routes/auth.js`) — 5 endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/login` | Authenticate user |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Logout (verify token) |
| POST | `/switch-role` | Switch user role |
| GET | `/repartidores` | List repartidores |

### DDD Endpoints (`createAuthRoutes()`) — 1 endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/login` | Authenticate user |

### Feature Parity Analysis

| Legacy Endpoint | DDD Equivalent | Parity |
|----------------|---------------|--------|
| `POST /login` | `POST /login` | ⚠️ Different response format |
| `POST /refresh` | ❌ Missing | 🔴 **MISSING** |
| `POST /logout` | ❌ Missing | 🔴 **MISSING** |
| `POST /switch-role` | ❌ Missing | 🔴 **MISSING** |
| `GET /repartidores` | ❌ Missing | 🔴 **MISSING** |

**Parity Score: 1/5 (20%)** — Only login exists, with different response format.

### API Compatibility

- **Login response:** Legacy returns `{ user, role, isRepartidor, showCommissions, vendedorCodes, token, refreshToken, latestVersion, tokenExpiresIn, refreshExpiresIn }`. DDD returns `{ success: true, user: { id, code, name, role, isJefeVentas }, accessToken, refreshToken, expiresIn }` — 🔴 **Major breaking change**
- **Missing fields:** `isRepartidor`, `showCommissions`, `vendedorCodes`, `latestVersion`, `matricula`, `codigoConductor` — all missing from DDD
- **Security features:** Legacy has rate limiting, lockout management, SQL injection detection, audit logging — DDD has none of these
- **Token naming:** Legacy uses `token`, DDD uses `accessToken` — 🔴 **Breaking change**

### Recommendation: **Keep legacy as source of truth**

The auth module is the most critical — the DDD login response is incompatible with the Flutter app's expected format. The missing `refresh`, `logout`, `switch-role`, and `repartidores` endpoints would break the entire authentication flow.

---

## 6. Overall Summary

| Module | Legacy Endpoints | DDD Endpoints | True Parity | Missing in DDD | DDD-Only | Parity Score |
|--------|-----------------|---------------|-------------|----------------|----------|-------------|
| **Pedidos** | 28 | 7 | 3 | 25 | 0 | 10.7% |
| **Cobros** | 3 | 3 | 2 | 1 | 1 | 66.7% |
| **Entregas** | 12 | 5 | 0 | 9 | 2 | 0% |
| **Rutero** | 14 | 4 | 0 | 12 | 2 | 0% |
| **Auth** | 5 | 1 | 1 | 4 | 0 | 20% |
| **TOTAL** | **62** | **20** | **6** | **51** | **5** | **9.7%** |

---

## 7. Feature Toggle Verification (`server.js`)

### Current State: ✅ WORKING CORRECTLY

**Toggle definition** (line 48):
```js
const USE_DDD_ROUTES = process.env.USE_DDD_ROUTES === 'true';
```

**Default:** `false` (legacy routes) — safe default ✅

**Mount logic:**
- **Auth routes** (line 200-205): DDD mounted if `USE_DDD_ROUTES=true`, else legacy ✅
- **Protected routes** (lines 252-266):
  - When `USE_DDD_ROUTES=true`: DDD routes mounted at `/api/{auth,pedidos,cobros,entregas,rutero}` with Express first-match priority ✅
  - When `USE_DDD_ROUTES=false`: Legacy routes mounted at `/api/{entregas,products,pedidos,cobros}` ✅
- **Fallback logic** (lines 136-139): If DDD module fails to load, `USE_DDD_ROUTES` is set to `false` and legacy is used ✅
- **Startup initialization** (lines 379-394): DDD connection pool and cache are initialized when toggle is enabled ✅

**Independence:** `USE_DDD_ROUTES` is independent of `USE_TS_ROUTES` (line 47) ✅

### Risk Assessment

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| `USE_DDD_ROUTES=true` in production | 🔴 **CRITICAL** — 51 missing endpoints would break the app | Keep default `false` |
| DDD module fails to load | ✅ Safe fallback to legacy | Built-in error handling |
| Both toggles true | ⚠️ TS routes take priority, DDD ignored | Documented behavior |

---

## 8. Recommendations

### Immediate Actions

1. **Keep `USE_DDD_ROUTES=false` as default** — The DDD layer is not ready for production use
2. **Do not commit any changes that would flip this toggle** without a full migration plan
3. **The DDD adapters serve as a good architectural blueprint** but need 51 endpoint implementations

### Migration Path (if desired)

**Phase 1 — Auth (highest priority, most impact):**
- Align DDD login response format with legacy (add `isRepartidor`, `showCommissions`, `vendedorCodes`, `latestVersion`, etc.)
- Implement `refresh`, `logout`, `switch-role`, `repartidores` endpoints
- Add rate limiting, lockout management, and audit logging

**Phase 2 — Cobros (closest to parity):**
- Add `pending-summary/:vendedorCode` endpoint
- Align response field names (`cobros` vs `pendientes`)
- Fix payment registration path to include `codigoCliente`

**Phase 3 — Pedidos (core business logic):**
- Implement order CRUD (`/:id`, `/create`, `/:id/confirm`, `/:id/lines/*`)
- Add stock, pricing, recommendations, and line management endpoints

**Phase 4 — Entregas + Rutero (most complex):**
- These require the most work and should be migrated last
- Consider keeping legacy for these modules indefinitely

### Long-term Strategy

The DDD module architecture is sound (repository pattern, clean separation, validation layer) but the implementation is at ~10% completion. Rather than a big-bang migration, consider:

1. **Strangler fig pattern:** Migrate one endpoint at a time, routing specific paths to DDD while keeping the rest on legacy
2. **API versioning:** Introduce `/api/v2/` for DDD routes while keeping `/api/` on legacy
3. **Feature flags per module:** Instead of a single `USE_DDD_ROUTES`, use `USE_DDD_AUTH`, `USE_DDD_PEDIDOS`, etc.

---

## 9. repartidor.js Change Analysis

### Summary of Unstaged Changes: 108 lines

**Nature of changes:** 🔒 **SQL Injection Fix + New Feature** — LEGITIMATE, should be committed

### Changes Breakdown:

#### A. SQL Injection Fixes (Security Critical) — ~80 lines
Multiple instances of string-interpolated SQL queries converted to parameterized queries:

| Location | Before | After |
|----------|--------|-------|
| Albaran PDF header query | `WHERE ... = ${number}` | `WHERE ... = ?` with params |
| Albaran IVA breakdown | String concat | Parameterized |
| Albaran lines query | String concat | Parameterized |
| DELIVERY_STATUS lookup | `WHERE ID = '${albId}'` | `WHERE ID = ?` |
| REPARTIDOR_FIRMAS query | String concat | Parameterized |
| CACFIRMAS query | String concat | Parameterized |
| Invoice PDF queries (3 variants) | String concat | Parameterized |
| Legacy signature lookup | String concat | Parameterized |
| Firma endpoint | `WHERE ENTREGA_ID = ${entregaId}` | `WHERE ENTREGA_ID = ?` |

**Impact:** These are **critical security fixes** that prevent SQL injection in PDF generation endpoints. All use `queryWithParams()` instead of raw `query()` with string interpolation.

#### B. PDF Response Headers Enhancement — ~8 lines
- Added `safeFilename` sanitization for PDF filenames
- Enhanced `Content-Disposition` with UTF-8 encoding support (`filename*=UTF-8''...`)
- Added `Accept-Ranges: bytes` and `Cache-Control: no-cache, no-store, must-revalidate`

#### C. New WhatsApp Share Endpoint — ~98 lines
- New `POST /document/share/whatsapp` endpoint
- Generates PDF base64 for WhatsApp sharing
- Supports both albaran and factura document types
- Includes PDF caching for performance

### Verdict: ✅ STAGE AND COMMIT

These changes are:
- **Security-critical** (SQL injection fixes across 10+ query locations)
- **Feature additions** (WhatsApp sharing)
- **Quality improvements** (PDF filename sanitization, cache headers)
- **Not debug/temp code**

**Recommended commit message:**
```
fix(repartidor): parameterize SQL queries + add WhatsApp PDF share

- Convert 10+ string-interpolated SQL queries to parameterized queries
  in albaran/invoice PDF generation endpoints (security: SQL injection)
- Add POST /document/share/whatsapp endpoint for PDF sharing
- Sanitize PDF filenames and add UTF-8 Content-Disposition support
- Add cache-control headers for PDF responses
```
