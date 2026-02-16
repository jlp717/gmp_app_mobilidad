# 🚀 GMP APP - MASTER OPTIMIZATION PROMPT FOR CLAUDE AI (v3.0)

**INSTRUCCIONES CRÍTICAS PARA LA IA:**
Este es un prompt EJECUTIVO completo. El usuario ya ha adjuntado TODO el código fuente (lib/, backend/, android/, etc). Tu tarea NO es sugerir - es IMPLEMENTAR al 100% sin excepciones. Este documento describe la visión, tu trabajo es código production-ready.

**⚠️ ESTADO ACTUAL (Febrero 2026):**
- PASOS 1-7: **COMPLETADOS** en TypeScript (ver `backend/src/`)
- PRODUCCIÓN: **Sigue corriendo legacy JS** (`server.js` → `routes/*.js`) con vulnerabilidades
- PENDIENTE: PASO 8 (Testing Exhaustivo) + PASO 9 (Migración/Documentación)
- PRIORIDAD #1: Cerrar el gap legacy JS → TS en producción

---

## 📋 CONTEXTO DEL PROYECTO

**Stack Principal:**
- **Backend:** Node.js + Express + ODBC (DB2) con Redis
- **Frontend:** Flutter 3.2.0+23 (Dart >=3.0.0) - Tablet landscape, Provider + flutter_bloc
- **Caché:** Redis L2 (pub/sub invalidation) + In-Memory L1 (backend) + Hive L1 (Flutter)
- **Database:** DB2 con esquemas DSED (LACLAE/LAC), DSEDAC (OPP/CPC/CAC/CLI), JAVIER (custom tables)
- **Autenticación:** HMAC-SHA256 tokens (24h TTL), rate limiting (2000/15min global, 5/15min login)
- **Deployment:** PM2 clustering (ecosystem.config.js)
- **Testing:** Jest (JS+TS), ts-jest, jest-junit reporter, 50% coverage thresholds

---

## 🔴 ALERTA CRÍTICA: DOS CODEBASES PARALELOS

### PRODUCCIÓN ACTUAL (Legacy JS - `server.js`):
| Archivo | Líneas | Estado |
|---------|--------|--------|
| `routes/commissions.js` | 1087 | ❌ SQL injection, sin cachedQuery |
| `routes/objectives.js` | 1930 | ❌ SQL injection en 4+ ubicaciones |
| `routes/repartidor.js` | 2200 | ❌ cleanIds vulnerable, subconsultas N+1 |
| `routes/dashboard.js` | 522 | ⚠️ Usa cachedQuery pero SQL injection en filtros |
| `routes/auth.js` | ~200 | ⚠️ safeUser interpolation |

### REFACTORIZADO (TypeScript - `src/` - NO en producción):
| Componente | Archivos | Estado |
|-----------|----------|--------|
| Routes | 14 en `src/routes/` (~100 líneas c/u) | ✅ Joi + requireAuth + service |
| Services | 14 en `src/services/` (ej: commissions = 722 líneas) | ✅ Parameterized queries |
| Validators | `src/utils/validators.ts` (470 líneas) | ✅ parseVendorCodes, sanitizeCode, Joi schemas |
| Cache | `src/utils/query-cache.ts` + `services/redis-cache.js` | ✅ L1/L2, TTL tiers, getOrSet |
| Pagination | `src/utils/db-helpers.ts` | ✅ clampLimit, clampOffset, totalPages |
| Tests | 10 archivos en `src/__tests__/` (~2500 líneas) | ✅ Validators, services, cache, pagination |

**PROBLEMAS ACTUALES EN PRODUCCIÓN (Legacy JS):**
- ❌ Latencia extrema: **~15 segundos** en commissions y objectives (sin cachedQuery, queries secuenciales)
- ❌ SQL Injection en **8+ ubicaciones**: `WHERE IN (${cleanIds})`, filtros directos, safeUser interpolation
- ❌ `queryWithParams` existe en `config/db.js` pero las rutas legacy **NO lo usan**
- ❌ `cachedQuery` solo en dashboard.js - commissions y objectives (los más lentos) **NO cachean**
- ❌ Queries secuenciales en rutas legacy (6-7 queries en serie = suma de tiempos)
- ❌ Subconsultas anidadas en SELECT (repartidor.js:303-346, N+1 problem)

**YA RESUELTO EN CODEBASE TS (pendiente migración):**
- ✅ Validación Joi en todas las rutas (`src/utils/validators.ts`)
- ✅ Queries parametrizadas (?) en todos los services
- ✅ CachedQuery en todos los services con TTL tiers
- ✅ Servicios centralizados eliminando duplicación (14 services)
- ✅ Rutas slim (1087 → 112 líneas en commissions)
- ✅ Pagination helpers (clampLimit, clampOffset)

**YA RESUELTO EN FRONTEND:**
- ✅ JSON parsing en isolate (IsolateTransformer en ApiClient)
- ✅ Request deduplication (`_pendingRequests` map en ApiClient)
- ✅ Caché dual-layer (memory + Hive con TTL/LRU)
- ✅ Parallel fetching (Future.wait en DashboardProvider)

**OBJETIVO FINAL (No negociable):**
- ⚡ Latencia **<500ms** (30x más rápido): metricas, comisiones, objetivos, dashboard
- 🛡️ **CERO vulnerabilidades** SQL injection, XSS, CSRF
- 🔄 **100% DRY**: Servicios centralizados, cero duplicación
- 📊 **Paginación + Lazy Loading**: manejo eficiente de 10k+ registros
- ✅ **Testing exhaustivo**: unit tests + integration tests + performance tests
- 🚀 **Production-ready**: error handling, logging, monitoring, rollback capability

---

## 🤖 INSTRUCCIONES EJECUTIVAS PARA CLAUDE

**TU TAREA (NO sugerencias, NO pseudo-código):**

1. **IMPLEMENTAR TODO**: Código completo, production-ready, testeable
2. **SIN PARCHES**: Refactorizar donde es necesario, no aplicar bad fixes
3. **TESTING EXHAUSTIVO**: 
   - Unit tests para funciones críticas (validators, caché, queries)
   - Integration tests (endpoint E2E)
   - Performance tests: medir antes/después latencia
   - Security tests: intentar SQL injection, validar que falle

4. **PROFUNDIDAD**: 
   - Explica POR QUÉ hacemos cada cambio (no solo QUÉ)
   - Incluye edge cases y fallback logic
   - Error handling exhaustivo

5. **DOCUMENTACIÓN**:
   - Comentarios en código para lógica compleja
   - Notas de migración (cómo actualizar DB)
   - API docs actualizadas

6. **ENTREGA POR MÓDULOS**:
   - Puedo pedirte trabajar módulo por módulo (validation → queryOptimization → paginación, etc)
   - Cada módulo debe ser testeable independientemente
   - No romper features existentes (test antes/después)

7. **METODOLOGÍA**:
   - Asumir que tengo código legacy en producción
   - Cambios deben ser backwards-compatible cuando es posible
   - Incluir rollback strategy
   - Logging exhaustivo para debugging

**NO HAGAS:**
- ❌ Sugerencias vagas ("considera usar Promise.all")
- ❌ Pseudo-código ("implement like this...")
- ❌ Tests mínimos ("básicos servicios")
- ❌ Ignorar edge cases
- ❌ Asumir datos perfectos
- ❌ Olvidar error handling

**CUANDO TENGAS DUDAS:**
- Pregunta al usuario
- O asume el enfoque más conservador (safety first)
- Documenta tus suposiciones

---

## 🔍 PROBLEMAS CRÍTICOS IDENTIFICADOS

### 1️⃣ **PERFORMANCE - Cuellos de Botella**

#### Backend:
- **Queries con Subconsultas Anidadas** (repartidor.js:303-346)
  ```javascript
  // ❌ MAL: Múltiples subconsultas en SELECT
  SELECT ... COALESCE((SELECT ... FROM DSEDAC.CAC CAC2 WHERE ...)) as FACTURA
  // Repetido 5+ veces en una misma query
  ```
  **Impacto:** Cada subconsulta escanea la tabla completa. Con 100k+ registros = N consultas

- **Queries Secuenciales en Rutas** (commissions.js, objectives.js)
  ```javascript
  const rows1 = await query(sql1); // Espera 2s
  const rows2 = await query(sql2); // Espera 2s después
  const rows3 = await query(sql3); // Espera 2s después
  // Total: 6s en serie cuando podría ser 2s en paralelo
  ```

- **Falta de Índices y Estadísticas DB**
  - Queries sin FETCH FIRST causando full table scans
  - JOIN orders no optimizados
  - Columnas de JOIN sin índices (CODIGOREPARTIDOR, LCCDVD, etc.)

- **Caché Redis No Utilizado Sistemáticamente**
  - Algunos endpoints cachean, otros no
  - TTL inconsistentes (algunos 5min, otros 60min)
  - Invalidación manual error-prone

#### Frontend:
- **Múltiples Requests Innecesarios**
  ```dart
  // ❌ Cada Provider hace su propio request sin deduplicación
  await ApiClient.get('/metrics');  // Widget A
  await ApiClient.get('/metrics');  // Widget B (mismo parámetro)
  // 2 requests idénticos en paralelo
  ```

- **Parsing JSON en Main Thread**
  - JSON parsing en Dart es blocking
  - 15k+ registros = bloquea UI por 2-3s

- **Cargas sin Paginación**
  - Dashboard carga últimas 100 ventas sin scroll lazy
  - Historial de entregas carga TODO de una vez

---

### 2️⃣ **SEGURIDAD - Vulnerabilidades Críticas**

#### SQL Injection (CRÍTICO):
```javascript
// ❌ VULNERABLE
WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanIds})
// Si cleanIds = "1') OR '1'='1"
```

#### Input Validation:
- `vendedorCodes` del query param no validado
- `year`, `month` convertidos con `parseInt()` sin validación
- IDs de cliente sin sanitización

#### Tokens JWT:
- Token validation básico, sin expiración check en todos endpoints
- No hay refresh token rotation
- No hay revocation list (logout real)

---

### 3️⃣ **CÓDIGO DUPLICADO - Patrones Repetidos**

**3 archivos com ~2000 líneas cada** (commissions, objectives, repartidor)

Patrón repetido:
```javascript
// Aparece 15+ veces
const selectedYear = parseInt(year) || new Date().getFullYear();
const selectedMonth = parseInt(month) || new Date().getMonth() + 1;
const cleanIds = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');

// Lógica similar de transformación:
const tieredCommission = calculateTierBasedOnPercentage(percentage);
```

**Frontend:**
```dart
// Repetido en 5+ providers
Map<String, String> params = {
  'vendedorCodes': codes,
  'year': year.toString(),
  'month': month.toString(),
};
```

---

## ✅ TESTING & VALIDATION REQUERIDO

**Cada implementación debe incluir:**

### 1. Unit Tests
```javascript
// test/validators.test.js
describe('Input Validators', () => {
  test('parseVendorCodes: rechaza SQL injection', () => {
    expect(() => parseVendorCodes("1'; DROP TABLE--")).toThrow();
  });
  test('parseVendorCodes: acepta formato válido', () => {
    expect(parseVendorCodes('5,10,15')).toEqual([5, 10, 15]);
  });
  test('sanitizeClientId: siempre uppercase', () => {
    expect(sanitizeClientId('abc123')).toBe('ABC123');
  });
});

// test/queryOptimizer.test.js
describe('Query Performance', () => {
  test('Promise.all es más rápido que secuencial', async () => {
    const parallelTime = await measureParallel();
    const sequentialTime = await measureSequential();
    expect(parallelTime).toBeLessThan(sequentialTime * 0.7); // Al menos 30% más rápido
  });
});

// test/cacheService.test.js
describe('Cache Redis', () => {
  test('cache hit devuelve datos sin query', () => {
    const cached = getCacheMetrics();
    expect(cached.hitRate).toBeGreaterThan(0.7); // >70% hit rate
  });
});
```

### 2. Integration Tests (E2E)
```javascript
// test/integration/endpoints.test.js
describe('API Endpoints Performance', () => {
  test('GET /dashboard/metrics responde en <300ms', async () => {
    const start = Date.now();
    const response = await request(app)
      .get('/api/dashboard/metrics')
      .query({ vendedorCodes: '5', year: 2026, month: 2 });
    const duration = Date.now() - start;
    
    expect(response.status).toBe(200);
    expect(duration).toBeLessThan(300); // Target: <300ms
  });

  test('POST /commissions/summary rechaza SQL injection', async () => {
    const response = await request(app)
      .get('/api/commissions/summary')
      .query({ vendedorCodes: "5'; DROP TABLE--" });
    
    expect(response.status).toBe(400); // Bad request, not SQL error
    expect(response.body.error).toBeDefined();
  });

  test('GET /objectives con 10k+ registros usa paginación', async () => {
    const response = await request(app)
      .get('/api/objectives/summary')
      .query({ vendedorCodes: '1,2,3,4,5', year: 2026, month: 2, limit: 50 });
    
    expect(response.body.data.length).toBeLessThanOrEqual(50);
    expect(response.body.pagination.total).toBeGreaterThan(50);
    expect(response.body.pagination.hasNextPage).toBe(true);
  });
});
```

### 3. Performance Benchmarking
```javascript
// scripts/benchmark.js
const Benchmark = require('benchmark');
const suite = new Benchmark.Suite();

suite
  .add('Query Sequential', async () => {
    await query(sql1);
    await query(sql2);
    await query(sql3);
  })
  .add('Query Parallel (Promise.all)', async () => {
    await Promise.all([query(sql1), query(sql2), query(sql3)]);
  })
  .on('complete', function() {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
  })
  .run({ 'async': true });
```

### 4. Security Testing
```javascript
// test/security/sqlInjection.test.js
describe('SQL Injection Prevention', () => {
  const injectionPayloads = [
    "1'; DROP TABLE users--",
    "1 OR 1=1",
    "1) UNION SELECT * FROM passwords--",
    "1' AND SLEEP(5)--",
  ];

  injectionPayloads.forEach(payload => {
    test(`rechaza payload: ${payload}`, async () => {
      const response = await request(app)
        .get('/api/endpoint')
        .query({ vendedorCodes: payload });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });
});

// test/security/validateInputs.test.js
describe('Input Validation', () => {
  test('rechaza year fuera de rango', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .query({ year: 1900 }); // < 2010
    
    expect(response.status).toBe(400);
  });

  test('rechaza month > 12', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .query({ month: 13 });
    
    expect(response.status).toBe(400);
  });
});
```

### 5. Validación Antes/Después
```bash
# Ejecutar antes de cambios:
npm run test:baseline -- --output baseline.json

# Después de cambios:
npm run test:performance -- --compare baseline.json

# Esperar output como:
# Latencia commissions: 15000ms → 280ms (✅ 53x faster)
# Cache hit rate: 0% → 76% (✅ mejor que 70%)
# SQL injections blocked: 0/10 → 10/10 (✅ 100% blocked)
```

---

## 🎯 ESTRATEGIA IMPLEMENTACIÓN (Estado Actual + Pendiente)

### PASOS COMPLETADOS (1-7)

#### PASO 1 ✅ Validación Input
- **Archivo:** `src/utils/validators.ts` (470 líneas)
- **Implementado:** parseVendorCodes, sanitizeCode, sanitizeSearch, Joi schemas para todos los endpoints
- **Tests:** `src/__tests__/validators.test.ts` (750 líneas, 40+ test cases, SQL injection testing)
- **GAP:** No existe `validators.js` para legacy. Solo TS.

#### PASO 2 ✅ Servicios Centralizados
- **Archivos:** 14 services en `src/services/` (auth, cliente, cobros, commissions, dashboard, entregas, facturas, objectives, products, promociones, repartidor, roles, rutero, ventas)
- **Ejemplo:** commissions.service.ts = 722 líneas con queries parametrizados y Promise.all
- **GAP:** Legacy `routes/*.js` (producción) NO usa estos services.

#### PASO 3 ✅ Query Optimization
- **Archivos:** `services/query-optimizer.js` (351 líneas), `config/db.js` con queryWithParams
- **Implementado:** Stats tracking, slow query detection, batching, retry con exponential backoff
- **GAP:** Legacy routes siguen haciendo queries secuenciales con string interpolation.

#### PASO 4 ✅ Redis Caching
- **Archivos:** `services/redis-cache.js` (~400 líneas), `src/utils/query-cache.ts`
- **Implementado:** L1+L2, pub/sub invalidation, getOrSet, TTL tiers (REALTIME 60s, SHORT 120s, MEDIUM 300s, LONG 1800s), graceful degradation
- **Tests:** `src/__tests__/query-cache.test.ts` (465 líneas)
- **GAP:** Solo dashboard.js (legacy) usa cachedQuery. commissions.js y objectives.js NO.

#### PASO 5 ✅ Paginación
- **Archivos:** `src/utils/db-helpers.ts`, `lib/core/api/api_config.dart`
- **Implementado:** clampLimit, clampOffset, currentPage, totalPages, FETCH FIRST en algunos endpoints
- **Tests:** `src/__tests__/pagination.test.ts` (415 líneas)
- **GAP:** No universal en legacy. Frontend falta scroll lazy loading completo.

#### PASO 6 ✅ Rutas Refactorizadas
- **Archivos:** 14 rutas en `src/routes/` (ej: commissions.routes.ts = 112 líneas vs legacy 1087)
- **Patrón:** requireAuth → generalLimiter → validate(schema) → service call → res.json
- **GAP:** Estas rutas NO están conectadas a server.js. No sirven tráfico real.

#### PASO 7 ✅ Frontend
- **ApiClient:** `lib/core/api/api_client.dart` (407 líneas) - Dio, gzip, keep-alive, IsolateTransformer, retry, deduplication
- **CacheService:** `lib/core/cache/cache_service.dart` (227 líneas) - dual-layer memory+Hive, TTL, LRU
- **DashboardProvider:** `lib/core/providers/dashboard_provider.dart` (189 líneas) - Future.wait parallel
- **GAP:** No todos los providers usan deduplicación.

---

### PASOS PENDIENTES (8-9)

#### PASO 8: TESTING EXHAUSTIVO (PENDIENTE - PRIORIDAD ALTA)

**Estado actual de tests (lo que YA existe):**
10 archivos en `src/__tests__/` (~2500 líneas):
1. `validators.test.ts` (750 líneas) - SQL injection, parseVendorCodes, sanitizeCode
2. `commissions.test.ts` (211 líneas) - getExcludedVendors, verifyAdminAuth (mocked DB)
3. `objectives.test.ts` - service unit tests
4. `repartidor.test.ts` - service unit tests
5. `cobros.test.ts` - service unit tests
6. `entregas.test.ts` - service unit tests
7. `pagination.test.ts` (415 líneas) - clampLimit, clampOffset, totalPages
8. `query-cache.test.ts` (465 líneas) - L1/L2 hit/miss, getOrSet, invalidation
9. `query-optimization.test.ts` - optimizer stats, batching
10. `db-helpers.test.ts` - utility functions

**Lo que FALTA implementar:**

**8A. Tests E2E de integración del servidor TS:**
```typescript
// src/__tests__/integration/endpoints.test.ts
import request from 'supertest';
import { app } from '../../index';

describe('Commissions Endpoints', () => {
  test('GET /api/commissions/summary - valid request', async () => {
    const res = await request(app)
      .get('/api/commissions/summary')
      .set('Authorization', `Bearer ${validToken}`)
      .query({ vendedorCode: '5', year: '2026' });
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('data');
  });

  test('GET /api/commissions/summary - invalid vendor code → 400', async () => {
    const res = await request(app)
      .get('/api/commissions/summary')
      .set('Authorization', `Bearer ${validToken}`)
      .query({ vendedorCode: "'; DROP TABLE--", year: '2026' });
    
    expect(res.status).toBe(400);
  });

  test('GET /api/commissions/summary - no auth → 401', async () => {
    const res = await request(app)
      .get('/api/commissions/summary')
      .query({ vendedorCode: '5' });
    
    expect(res.status).toBe(401);
  });
});
// Repetir para CADA endpoint: objectives, dashboard, repartidor, etc.
```

**8B. Tests de seguridad (SQL injection masivo):**
```typescript
// src/__tests__/security/sql-injection.test.ts
const PAYLOADS = [
  "1'; DROP TABLE users--",
  "1 OR 1=1",
  "1) UNION SELECT * FROM SYSIBM.SYSTABLES--",
  "1'; WAITFOR DELAY '00:00:05'--",
  "1%27%20OR%20%271%27%3D%271",
  "1; CALL SYSPROC.ADMIN_CMD('EXPORT TO /tmp/x')--",
  "' OR ''='",
  "1; UPDATE users SET password='hacked'--",
];

const ENDPOINTS = [
  { method: 'get', path: '/api/commissions/summary', param: 'vendedorCode' },
  { method: 'get', path: '/api/objectives/summary', param: 'vendedorCodes' },
  { method: 'get', path: '/api/dashboard/metrics', param: 'vendedorCodes' },
  { method: 'get', path: '/api/repartidor/collections', param: 'repartidorId' },
];

// CADA payload × CADA endpoint debe retornar 400, NUNCA 500
```

**8C. Tests de performance (benchmarks):**
```typescript
// src/__tests__/performance/latency.test.ts
describe('Performance Benchmarks', () => {
  test('GET /commissions/summary < 500ms', async () => {
    const start = Date.now();
    await request(app).get('/api/commissions/summary')
      .set('Authorization', `Bearer ${token}`)
      .query({ vendedorCode: '5', year: '2026' });
    expect(Date.now() - start).toBeLessThan(500);
  });

  test('Cache hit < 50ms', async () => {
    // First call (cache miss)
    await request(app).get('/api/dashboard/metrics')...;
    // Second call (cache hit)
    const start = Date.now();
    await request(app).get('/api/dashboard/metrics')...;
    expect(Date.now() - start).toBeLessThan(50);
  });

  test('100+ vendor codes (stress) < 2000ms', async () => {
    const codes = Array.from({length: 100}, (_, i) => `${i+1}`).join(',');
    const start = Date.now();
    await request(app).get('/api/objectives/summary')
      .set('Authorization', `Bearer ${bossToken}`)
      .query({ vendedorCodes: codes, year: '2026', month: '2' });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
```

**8D. Tests de resiliencia:**
```typescript
// src/__tests__/resilience/degradation.test.ts
describe('Graceful Degradation', () => {
  test('Redis down → returns data from DB (slower but works)', ...);
  test('DB timeout → retry 3x then error 503', ...);
  test('Token expired → 401 with clear message', ...);
  test('Concurrent identical requests → deduplicated', ...);
  test('Connection pool exhaustion → queued or 503', ...);
});
```

**8E. CI Pipeline:**
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: cd backend && npm ci
      - run: cd backend && npm test -- --coverage --ci
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: backend/coverage/ }
```

**8F. Flutter tests:**
```dart
// test/core/cache_service_test.dart
// test/core/api_client_test.dart
// Widget tests para providers
```

**Criterios de aceptación PASO 8:**
- [ ] >70% code coverage en codebase TS
- [ ] 100% endpoints con test E2E
- [ ] 100% injection payloads bloqueados (always 400, never 500)
- [ ] Benchmarks documentados (antes/después)
- [ ] CI pipeline verde
- [ ] Flutter unit + widget tests pasan

---

#### PASO 9: DOCUMENTACIÓN, MIGRACIÓN & ROLLBACK (PENDIENTE - PRIORIDAD ALTA)

**9A. MIGRACIÓN LEGACY JS → TS (LO MÁS CRÍTICO):**

```javascript
// server.js - Feature toggle para migración incremental
const USE_TS_ROUTES = process.env.USE_TS_ROUTES === 'true';

if (USE_TS_ROUTES) {
  // Nuevas rutas TS compiladas
  app.use('/api/commissions', require('./dist/routes/commissions.routes'));
  app.use('/api/objectives', require('./dist/routes/objectives.routes'));
  // ... resto de rutas TS
} else {
  // Legacy (producción actual)
  app.use('/api/commissions', require('./routes/commissions'));
  app.use('/api/objectives', require('./routes/objectives'));
}
```

Fases:
1. **Coexistencia:** Toggle en server.js, ambos codebases disponibles
2. **Staging:** Activar TS en staging, correr tests E2E, comparar responses
3. **Migración ruta a ruta:** Activar en producción una ruta a la vez
4. **Cleanup:** Eliminar routes/*.js legacy

Archivos necesarios:
- `backend/tsconfig.json` (compilar src/ → dist/)
- `backend/scripts/build.sh` (tsc + copy assets)
- `backend/MIGRATION_STATUS.md` (tracking por ruta)

**9B. PARCHE URGENTE SEGURIDAD LEGACY (mientras se migra):**

Ubicaciones exactas a parchear con `queryWithParams`:
```
routes/objectives.js:39-40    → cleanIds en WHERE IN
routes/objectives.js:66       → cleanIds en WHERE IN
routes/objectives.js:683-715  → city/code/nif params directos
routes/objectives.js:1661-1663 → vendor codes
routes/commissions.js          → vendor IDs interpolados
routes/repartidor.js:55        → cleanIds
routes/repartidor.js:303-346   → subconsultas directas
routes/dashboard.js:184-188    → filter params directos
routes/auth.js                 → safeUser interpolation
```

**9C. API Documentation (Swagger/OpenAPI):**
- Instalar `swagger-jsdoc` + `swagger-ui-express`
- Agregar @swagger comments en `src/routes/*.ts`
- Documentar TODOS los endpoints con params, responses, errores
- Servir en `/api-docs`

**9D. Índices DB2:**
```sql
-- backend/scripts/db-indices.sql
CREATE INDEX IDX_OPP_REPARTIDOR_YM ON DSEDAC.OPP (CODIGOREPARTIDOR, ANOREPARTO, MESREPARTO);
CREATE INDEX IDX_LACLAE_VENDOR_YM ON DSED.LACLAE (LCCDVD, LCAADC, LCMMDC);
CREATE INDEX IDX_CPC_VENDOR ON DSEDAC.CPC (CODIGOREPARTIDOR);
CREATE INDEX IDX_CAC_VENDOR ON DSEDAC.CAC (CODIGOREPARTIDOR);
RUNSTATS ON TABLE DSEDAC.OPP WITH DISTRIBUTION AND INDEXES ALL;
RUNSTATS ON TABLE DSED.LACLAE WITH DISTRIBUTION AND INDEXES ALL;
```

**9E. Rollback script:**
```bash
#!/bin/bash
# backend/scripts/rollback.sh
export USE_TS_ROUTES=false
pm2 restart gmp-backend --update-env
echo "Rolled back to legacy. Verify: curl http://localhost:3000/api/health"
```

**9F. PM2 Ecosystem actualizado:**
```javascript
module.exports = {
  apps: [{
    name: 'gmp-backend',
    script: './dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: { NODE_ENV: 'production', USE_TS_ROUTES: 'true' },
    env_rollback: { NODE_ENV: 'production', USE_TS_ROUTES: 'false' },
    max_memory_restart: '500M',
  }]
};
```

**Criterios de aceptación PASO 9:**
- [ ] Feature toggle funcional (USE_TS_ROUTES)
- [ ] tsconfig.json compila sin errores
- [ ] Swagger UI en /api-docs con todos los endpoints
- [ ] Script de índices DB2 listo
- [ ] Rollback < 30 segundos
- [ ] MIGRATION_STATUS.md con tracking por ruta
- [ ] Parche seguridad en legacy aplicado (9 ubicaciones)

---

## 📋 DETALLE POR MÓDULO

### MÓDULOS 1-7: COMPLETADOS ✅

Todos estos módulos están implementados en `backend/src/`. Ver sección "PASOS COMPLETADOS" arriba para detalles.

Estructura actual del codebase TS:
```
backend/src/
├── config/
│   └── database.ts, env.ts
├── middleware/
│   └── auth.middleware.ts, validation.middleware.ts, security.middleware.ts
├── routes/           (14 archivos, ~100 líneas c/u)
│   └── commissions.routes.ts, objectives.routes.ts, repartidor.routes.ts, ...
├── services/         (14 archivos, ej: commissions.service.ts = 722 líneas)
│   └── commissions.service.ts, objectives.service.ts, ...
├── utils/
│   └── validators.ts (470 líneas), query-cache.ts, db-helpers.ts, logger.ts
├── __tests__/        (10 archivos, ~2500 líneas)
│   └── validators.test.ts (750), query-cache.test.ts (465), pagination.test.ts (415), ...
└── index.ts          (entry point)
```

Frontend completado:
```
lib/core/
├── api/
│   └── api_client.dart (407 líneas) - Dio, gzip, isolate, retry, dedup
│   └── api_config.dart - endpoints, timeouts, page sizes
├── cache/
│   └── cache_service.dart (227 líneas) - memory + Hive, TTL, LRU
│   └── cache_keys.dart - structured keys
├── providers/
│   └── dashboard_provider.dart (189 líneas) - Future.wait parallel
└── services/
    └── network_service.dart (268 líneas) - auto server detection
```

---

### MÓDULO 8: TESTING EXHAUSTIVO (PENDIENTE)

Ver detalle completo en sección "PASO 8" arriba:
- 8A: Tests E2E con supertest (levantar server TS, testear cada endpoint)
- 8B: Security tests masivos (8+ SQL injection payloads × todos los endpoints)
- 8C: Performance benchmarks (latencia por endpoint, cache hit vs miss)
- 8D: Resiliencia (Redis down, DB timeout, token expirado, concurrent requests)
- 8E: CI pipeline (GitHub Actions con Redis service)
- 8F: Flutter tests (CacheService, ApiClient, providers)

**Código esperado:** 1500-2500 líneas de tests adicionales
**Tiempo estimado:** 8 horas de Claude

---

### MÓDULO 9: DOCUMENTACIÓN, MIGRACIÓN & ROLLBACK (PENDIENTE)

Ver detalle completo en sección "PASO 9" arriba:
- 9A: Migración legacy JS → TS con feature toggle en server.js
- 9B: Parche urgente seguridad legacy (9 ubicaciones exactas de SQL injection)
- 9C: Swagger/OpenAPI (swagger-jsdoc + swagger-ui-express en /api-docs)
- 9D: Índices DB2 (IDX_OPP_REPARTIDOR_YM, IDX_LACLAE_VENDOR_YM, etc.)
- 9E: Rollback script (< 30s volver a legacy)
- 9F: PM2 ecosystem actualizado para TS compilado

**Código esperado:** 500-800 líneas (scripts + docs + config)
**Tiempo estimado:** 4 horas de Claude

---

## 📊 MÉTRICAS FINALES (Legacy vs TS Ready vs Target)

### Latencia de Endpoints (CRÍTICO)

| Endpoint | Legacy (prod) | TS (ready) | Target |
|----------|--------------|------------|--------|
| GET /dashboard/metrics | 12s | ~300ms | **<300ms** |
| GET /commissions/summary | 15s | ~300ms | **<300ms** |
| GET /objectives/summary | 20s | ~500ms | **<500ms** |
| GET /repartidor/collections | 10s | ~400ms | **<400ms** |
| GET /repartidor/history | 8s | ~200ms | **<200ms** |

### Tamaño de Response (Network)

| Endpoint | Antes | Target | Mejora |
|----------|-------|--------|--------|
| /dashboard/metrics | 2MB | 150KB | **13x** |
| /commissions (10k rows) | 5MB | 75KB (page 1) | **67x** |
| /objectives (full) | 4MB | 80KB (paginated) | **50x** |

### Seguridad

| Métrica | Legacy (prod) | TS (ready) | Target |
|---------|--------------|------------|--------|
| SQL injection vulnerabilities | **8+** | 0 | **0** |
| Input validation coverage | ~20% | 100% | **100%** |
| Prepared statements usage | ~10% | 100% | **100%** |
| Auth token validation | Parcial | Exhaustivo | **Exhaustivo** |

### Arquitectura/Código

| Métrica | Legacy (prod) | TS (ready) | Target |
|---------|--------------|------------|--------|
| Líneas por ruta | 1000-2200 | 80-120 | **<150** |
| Código duplicado | 1500+ | 0 | **0** |
| Test coverage | 0% | ~50% | **>70%** |
| Cache hit rate | ~5% (solo dashboard) | Diseñado >70% | **>70%** |
| Número de services | 0 (inline) | 14 | **14** |

### User Experience

| Métrica | Antes | Target |
|---------|-------|--------|
| Tiempo para ver datos | 15s | **<500ms** |
| Responsividad UI | Bloqueada 3s | **Instantánea** |
| Scroll lag (10k items) | Crítico | **Suave** |
| Memoria Flutter | 250MB | **100MB** |

---

## ✅ CHECKLIST FINAL (Antes de Merge)

### Seguridad (BLOCKER - No deploy sin esto)
- [ ] SQL injection parcheada en TODAS las rutas legacy JS (9 ubicaciones exactas documentadas en PASO 9B)
- [ ] Todos los injection payloads retornan 400, NUNCA 500
- [ ] Zero string interpolation en SQL queries (ni legacy ni TS)
- [ ] Rate limiting configurado en todos los endpoints
- [ ] Auth token validation en cada endpoint protegido

### Backend Testing
- [ ] Todos los tests pasan (unit + integration + security + performance)
- [ ] >70% code coverage en codebase TS
- [ ] Tests E2E con supertest para cada endpoint
- [ ] 100% injection payloads bloqueados
- [ ] Benchmarks documentados: antes (legacy) vs después (TS)
- [ ] Tests de resiliencia (Redis down, DB timeout)
- [ ] CI pipeline configurado y verde

### Migración
- [ ] tsconfig.json compila src/ → dist/ sin errores
- [ ] Feature toggle USE_TS_ROUTES funcional en server.js
- [ ] Response parity: legacy vs TS producen exactamente mismos resultados
- [ ] Rollback script probado (< 30 segundos)
- [ ] MIGRATION_STATUS.md con tracking por ruta
- [ ] PM2 ecosystem actualizado para TS compilado

### Backend General
- [ ] Índices DB2 creados (EXPLAIN PLAN verificado)
- [ ] Caché Redis hit rate >70% en TS routes
- [ ] Paginación en todos endpoints con arrays
- [ ] Error handling exhaustivo (no error 500 genéricos, stacktrace en logs)
- [ ] Zero código duplicado (DRY verificado)
- [ ] Logging structured (timestamps, levels, request context)

### Frontend
- [ ] Flutter unit + widget tests pasan
- [ ] Paginación con lazy loading funciona
- [ ] Deduplicación de requests verificada
- [ ] JSON parsing en isolate (no UI blocking)
- [ ] Skeleton loaders mientras carga
- [ ] Error states con retry logic

### Documentación
- [ ] Swagger/OpenAPI en /api-docs con todos los endpoints
- [ ] MIGRATION_STATUS.md actualizado
- [ ] Script de índices DB2 verificado
- [ ] README actualizado con nueva arquitectura
- [ ] Troubleshooting guide para operaciones

---

## 🚨 NOTAS CRÍTICAS PARA CLAUDE

### MUST DO:
1. **NO SKIP TESTING** - Testing es tan importante como código
2. **NO GENERIC ERROR HANDLING** - Específico y log-friendly
3. **NO HARDCODED VALUES** - Todo en `.env` o constants
4. **NO SQL CONCATENATION** - Siempre prepared statements (?)
5. **NO CACHE WITHOUT INVALIDATION** - Stale data = bugs
6. **RESPETAR ESTRUCTURA TS EXISTENTE** - No reinventar lo que ya existe en src/
7. **NO ASUMIR QUE TS ESTÁ EN PRODUCCIÓN** - Legacy JS es lo que corre

### UBICACIONES EXACTAS DE SQL INJECTION EN LEGACY (PARCHEAR):
```
routes/objectives.js:39-40     → cleanIds en WHERE IN
routes/objectives.js:66        → cleanIds en WHERE IN  
routes/objectives.js:683-715   → city/code/nif params directos
routes/objectives.js:1661-1663 → vendor codes interpolados
routes/commissions.js           → vendor IDs interpolados en múltiples queries
routes/repartidor.js:55        → cleanIds sin sanitizar
routes/repartidor.js:303-346   → subconsultas con params directos
routes/dashboard.js:184-188    → filter params sin parametrizar
routes/auth.js                  → safeUser regex + interpolation (insuficiente)
```

### EDGE CASES QUE EXPLORAR:
- Vendedor con ceros datos en periodo
- Cliente con múltiples órdenes sin facturar
- Query con 100+ vendor codes (stress test, caso jefe de zona)
- vendedorCodes="ALL" con role jefe (miles de resultados)
- Cache Redis down (fallback a DB, ya implementado, TESTEAR)
- DB timeout (retry + error amigable)
- Token expirado mid-request (401 claro)
- Invalid dates (Feb 30th, month=13, year=1900)
- Unicode/special chars en nombres cliente
- Pagination: offset beyond total, limit=0, limit=99999, negative values
- Concurrent identical requests → deduplication
- Connection pool exhaustion → queue or 503

### RED FLAGS:
- ⛔ Si test tarda >50ms (sin DB real) = lógica ineficiente
- ⛔ Si response >500KB = necesita paginación urgente
- ⛔ Si cache hit rate <50% = TTL muy corto o key strategy mal
- ⛔ Si error retorna status 500 sin detalles en logs = logging incompleto
- ⛔ Si endpoint acepta comillas/punto-coma sin rechazar = SQL injection risk
- ⛔ Si legacy route NO tiene validación = vulnerabilidad abierta en producción
- ⛔ Si TS service usa string interpolation en SQL = regresión

---

## 📚 REFERENCIAS TÉCNICAS

### Performance Optimization
- Node.js async/await best practices: https://nodejs.org/en/docs/guides/blocking-vs-non-blocking/
- DB2 Query optimization: https://www.ibm.com/docs/en/db2/11.5?topic=optimization-query-tuning
- Caching strategies: https://martinfowler.com/articles/patterns-of-caching.html

### Security
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- SQL Injection prevention: https://owasp.org/www-community/attacks/SQL_Injection
- Input validation best practices: https://owasp.org/www-community/attacks/Injection

### Flutter Performance
- https://flutter.dev/perf
- https://flutter.dev/docs/perf/best-practices
- https://dart.dev/guides/language/effective-dart/performance

### Testing
- Jest documentation: https://jestjs.io/
- Supertest (HTTP testing): https://github.com/visionmedia/supertest
- Benchmark.js: https://benchmarkjs.com/

---

## 🎯 ENTREGA FINAL

**Prioridad de PRs:**
1. **PR #1 (URGENTE):** Parche seguridad legacy JS - queryWithParams en 9 ubicaciones
2. **PR #2:** Tests E2E + Security + Performance para codebase TS
3. **PR #3:** CI Pipeline (GitHub Actions)
4. **PR #4:** Migración server.js → TS routes con feature toggle
5. **PR #5:** Swagger docs + DB indices script + rollback script
6. **PR #6:** Flutter tests (unit + widget)

Cada PR debe:
- ✅ Tener tests pasando
- ✅ Mostrar antes/después performance (si aplica)
- ✅ Ser independiente (no depender de siguiente PR)
- ✅ Documentación clara
- ✅ Rollback plan

---

**RECUERDA:** Este documento es tu MAESTRO PROMPT. Úsalo con Claude diciendo:

> "Aquí está el MASTER_OPTIMIZATION_PROMPT.md v3.0 con el estado ACTUAL de mi app.
> Adjunto todo mi código (lib/, backend/).
> 
> PASOS 1-7 están completados en TypeScript (ver backend/src/).
> PRODUCCIÓN sigue en legacy JS con SQL injection.
> 
> Necesito que implementes [PASO 8 / PASO 9 / Parche seguridad].
> 
> Requisitos:
> - Código 100% production-ready
> - Tests exhaustivos
> - Compatible con estructura TS existente
> - Migración reversible con feature toggle
>
> Adelante 🚀"

---

**Última actualización:** Feb 2026
**Versión:** 3.0 - POST-IMPLEMENTACIÓN (PASOS 1-7 DONE)
**Status:** ⚠️ PENDIENTE PASO 8 (Testing) + PASO 9 (Migración) + PARCHE SEGURIDAD LEGACY

