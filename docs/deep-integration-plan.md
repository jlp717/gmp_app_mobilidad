# V3 Deep Integration Plan

**Fecha**: 1 Abril 2026
**Estado**: Planificado
**Objetivo**: Eliminar duplicación entre `backend/routes/` (legacy JS) y `backend/src/` (DDD modules)

---

## Current State (Duplication)

| Module | Legacy (routes/) | DDD (src/modules/) | Status |
|---|---|---|---|
| **Auth** | `routes/auth.js` | `src/modules/auth/` | ⚠️ Duplicated |
| **Pedidos** | `routes/pedidos.js` | `src/modules/pedidos/` | ⚠️ Duplicated |
| **Cobros** | `routes/cobros.js` | `src/modules/cobros/` | ⚠️ Duplicated |
| **Entregas** | `routes/entregas.js` | `src/modules/entregas/` | ⚠️ Duplicated |
| **Rutero** | `routes/planner.js` (partial) | `src/modules/rutero/` | ⚠️ Duplicated |
| **Dashboard** | `routes/dashboard.js` | N/A | ✅ No DDD yet |
| **Clients** | `routes/clients.js` | N/A | ✅ No DDD yet |
| **Warehouse** | `routes/warehouse.js` | N/A | ✅ No DDD yet |

---

## Migration Strategy

### Phase 1: Complete DDD Modules (Priority: High)

For each module, implement the full DDD stack:

```
src/modules/<module>/
├── domain/
│   ├── <entity>.js          # Entity classes
│   └── <module>-repository.js  # Repository interface
├── application/
│   └── <usecase>-usecase.js # Use case implementations
└── infrastructure/
    └── db2-<module>-repository.js  # DB2 implementation
```

**Modules to complete:**
1. `pedidos` - Add repository, use cases (getProducts, confirmOrder, etc.)
2. `cobros` - Add repository, use cases (registerPayment, getCobros, etc.)
3. `entregas` - Add repository, use cases (markDelivered, getAlbaranes, etc.)
4. `rutero` - Add repository, use cases (getRutaConfig, updateOrder, etc.)

### Phase 2: Route Adapter Layer

Create adapter that bridges legacy routes to DDD use cases:

```javascript
// src/adapters/route-adapter.js
const { LoginUseCase } = require('../modules/auth');
const { Db2AuthRepository } = require('../modules/auth/infrastructure/db2-auth-repository');

function createAuthRoutes() {
  const router = express.Router();
  const repo = new Db2AuthRepository();
  const loginUseCase = new LoginUseCase(repo, hashUtils, tokenUtils);

  router.post('/login', async (req, res) => {
    try {
      const result = await loginUseCase.execute({
        username: req.body.username,
        password: req.body.password,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'INVALID_CREDENTIALS') {
        return res.status(401).json({ error: err.message });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
```

### Phase 3: Feature Toggle Migration

Use existing `USE_TS_ROUTES` pattern to gradually switch:

```javascript
// server.js
const USE_DDD_ROUTES = process.env.USE_DDD_ROUTES === 'true';

if (USE_DDD_ROUTES) {
  // Use DDD modules
  app.use('/api/auth', createAuthRoutes());
  app.use('/api/pedidos', createPedidosRoutes());
} else {
  // Use legacy routes (fallback)
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/pedidos', require('./routes/pedidos'));
}
```

### Phase 4: Eliminate Legacy

Once all modules are migrated and tested:
1. Set `USE_DDD_ROUTES=true` as default
2. Archive legacy routes to `backend/archive/routes/`
3. Remove legacy services that have DDD equivalents
4. Update server.js to only use DDD routes

---

## TypeScript Migration Path

Current `backend/src/` has TypeScript files (`api-server.ts`, `index.ts`).
The DDD modules are JavaScript for compatibility.

**Migration options:**

1. **Keep JS** - Simpler, no build step needed, matches existing routes pattern
2. **Migrate to TS** - Type safety, better IDE support, requires compilation

**Recommendation**: Keep JS for now, migrate to TS incrementally as modules are completed.

---

## Success Criteria

- [ ] All 5 DDD modules have complete domain/application/infrastructure layers
- [ ] Route adapters created for all modules
- [ ] Feature toggle working (can switch between legacy and DDD)
- [ ] All existing tests pass with DDD routes
- [ ] No functionality regression
- [ ] Legacy routes archived (not deleted)
- [ ] Documentation updated

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Functionality regression | Comprehensive test suite before/after |
| Performance degradation | Benchmark endpoints before/after migration |
| DB2 compatibility | All repositories use existing `queryWithParams` pattern |
| Downtime during migration | Feature toggle allows instant rollback |
