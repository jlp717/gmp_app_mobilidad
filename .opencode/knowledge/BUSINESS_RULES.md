# Business Rules — GMP App Movilidad

> **Do NOT modify unless business logic changes.**
> These are invariants that ALL agents must respect.

---

## Core Rules

### Vendor Code 'ALL'
- Vendor code `'ALL'` means: query ALL vendors with NO `WHERE` clause on vendor code
- NEVER generate `WHERE VENDORED='ALL'` — that would return no results
- Implemented in: `backend/src/utils/vendor-helpers.ts`

### RUTERO_CONFIG Queries
- ALL queries against RUTERO_CONFIG MUST filter `ORDEN >= 0`
- This excludes blocking/deactivated entries (which have negative ORDEN values)

### Commissions Visibility
- The Comisiones tab visibility is controlled by `JAVIER.COMMISSION_EXCEPTIONS.HIDE_COMMISSIONS`
- If `HIDE_COMMISSIONS` = '1' → hide the tab
- If `HIDE_COMMISSIONS` = '0' → show the tab

### Delivery Detail UI
- The REAL delivery detail UI is `rutero_detail_modal.dart` (3517 lines)
- `albaran_detail_page.dart` is a dead UI — NEVER edit it for repartidor bugs
- Any fix related to delivery details MUST go in `rutero_detail_modal.dart`

### User Roles
- `JEFE_VENTAS` — Sales admin (full access)
- `COMERCIAL` — Salesperson (limited scope)
- `REPARTIDOR` — Delivery driver (logistics only)

### PedidosProvider — NO autoDispose
- `pedidosProvider` MUST NOT use `autoDispose`
- It has periodic timers and 39 `ref.read()` references
- Adding autoDispose would break the timer mechanism
- Requires a full refactor to add (not a quick fix)

### select() Optimization
- `authProvider`, `cobrosProvider`, `entregasProvider` already optimized with `select()`
- Each has 10 individual `select()` consumers
- When adding new providers, use `select()` to prevent unnecessary rebuilds

---

## Cache Architecture (Deuda Técnica)

- There are 14 cache-related files detected (known technical debt)
- **DO NOT consolidate or refactor the cache layer without explicit audit approval**
- The cache includes Redis for heavy endpoints (clients, commissions, dashboard)
- Pre-loader: `cache-preloader.ts`

---

## Production Server

- **Server**: 192.168.1.230 (gmp@gmp-online)
- **PM2 service**: `gmp-api`
- **Known bug**: PM2 restart counts reach 85 — needs investigation
- **Deploy via**: `gmp-deploy-ssh` MCP

---

## Receipt Endpoints

- Receipt/justificante endpoints MUST include `signaturePath` field in response

---

## Prohibited Operations

| Operation | Reason |
|-----------|--------|
| Modify `backend/config/database.js` | Production DB config — NO TOUCH |
| Modify `backend/middleware/authMiddleware.js` | Auth middleware — NO TOUCH |
| Hardcode API keys / credentials | Security risk |
| `SELECT *` in production queries | Performance |
| String concatenation in SQL | SQL injection risk |
| `autoDispose` on `pedidosProvider` | Breaks timer mechanism |
| Edit `albaran_detail_page.dart` | Dead UI — use `rutero_detail_modal.dart` |
