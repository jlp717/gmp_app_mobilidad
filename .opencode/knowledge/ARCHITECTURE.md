# Architecture — GMP App Movilidad

> System architecture documentation. Updated when significant architectural changes occur.

---

## Stack Overview

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Flutter | 3.x |
| State Management | Riverpod | 2.5 |
| HTTP Client | Dio | latest |
| UI Framework | Material 3 | bundled |
| DI | GetIt + Injectable | latest |
| Code Generation | Freezed + json_serializable | latest |
| Backend | Node.js + Express | latest |
| Database | IBM Db2 for i | via ODBC (DSN=GMP) |
| Auth | JWT + Refresh Tokens | custom |

---

## Flutter Architecture

### Directory Structure
```
lib/
├── core/                    # Shared utilities
│   ├── theme/
│   │   └── app_colors.dart  # 40+ centralized colors
│   ├── constants/
│   ├── errors/
│   └── utils/
├── features/                # Feature modules
│   └── <feature>/
│       ├── presentation/
│       │   ├── pages/       # Screen-level widgets
│       │   ├── providers/   # Riverpod providers
│       │   └── widgets/     # Reusable UI components
│       ├── domain/          # Entities, repos (interfaces)
│       └── data/            # DTOs, datasources, repo impls
└── main_shell.dart          # Root navigation
```

### Navigation
- **Entry point**: `main_shell.dart` in `lib/features/dashboard/presentation/pages/`
- Adding new tabs requires updating BOTH `_getNavItems` AND `_buildCurrentPage`
- Navigation uses GoRouter

### State Management
- Riverpod 2.5 with AsyncNotifier pattern
- NO legacy Provider API
- Auto-generated providers via `riverpod_generator`
- `select()` optimization already applied to auth, cobros, entregas

### HTTP Layer
- Dio with interceptors for auth/refresh token flow
- Base URL configurable via environment

---

## Backend Architecture

### Server
- **Entry**: `server.js` (838 lines)
- **Port**: 3334 (`process.env.PORT`)
- **3 routing layers**:
  - TypeScript compiled routes (DDD)
  - JavaScript legacy routes
  - DDD modules
- **Feature toggles**:
  - `USE_TS_ROUTES` (default: false)
  - `USE_DDD_ROUTES` (default: true)
- **Auth**: JWT with refresh tokens, middleware at `./middleware/auth.js`
- **DB**: IBM Db2 for i via ODBC (DSN=GMP), config at `./config/db.js` and `./src/config/database.ts`
- **Cache**: Redis for heavy endpoints, preloader at `cache-preloader.ts`
- **CORS**: Behind proxy (`trust proxy = 1`)

### Route Structure
```
backend/
├── routes/                  # JS legacy routes (23 files)
│   ├── auth.js, dashboard.js, analytics.js, master.js
│   ├── clients.js, planner.js, objectives.js, export.js
│   ├── chatbot.js, commissions.js, filters.js, entregas.js
│   ├── repartidor.js, repartidor-finanzas.js, user-actions.js
│   ├── facturas.js, warehouse.js, products.js, bolsa.js
│   ├── evolution.js, pedidos.js, cobros.js, health.js
├── src/
│   ├── routes/              # TypeScript DDD routes
│   ├── controllers/         # DDD controllers
│   ├── services/            # DDD services
│   ├── middleware/           # DDD middleware
│   └── jobs/                # Cron jobs (e.g., transferencias.job.ts)
├── kpi/                     # KPI module (DB2/ODBC + Redis)
└── __tests__/               # 204 tests
```

### Key Backend Files (DO NOT TOUCH)
| File | Reason |
|------|--------|
| `backend/config/database.js` | Production DB config |
| `backend/middleware/authMiddleware.js` | Auth middleware |

---

## Key Flutter Files

| File | Purpose | Lines |
|------|---------|-------|
| `main_shell.dart` | Root navigation + tab management | ~200 |
| `rutero_detail_modal.dart` | Delivery detail UI (ACTIVE) | 3517 |
| `albaran_detail_page.dart` | Delivery detail (DEAD — DO NOT USE) | — |
| `app_colors.dart` | Color system (40+ colors) | ~150 |

### Technical Debt (Known)
- `rutero_detail_modal.dart`: 3517 lines — needs widget extraction
- 30 files > 500 LOC
- 14 cache-related files (duplicated logic)
- `pedidosProvider`: 39 `ref.read()` calls, cannot add autoDispose
