# 🏗️ ARQUITECTURA TÉCNICA - GMP APP MOVILIDAD

**Última actualización**: 1 Abril 2026
**Versión de la app**: 3.3.2+37
**Arquitectura**: Clean Architecture + DDD + Riverpod + V3 Integration

---

## 📋 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura de Alto Nivel](#arquitectura-de-alto-nivel)
3. [Backend DDD Architecture](#backend-ddd-architecture)
4. [Estructura de Carpetas](#estructura-de-carpetas)
5. [State Management](#state-management)
6. [Security Layer](#security-layer)
7. [Performance & Caching](#performance--caching)
8. [Memory & Offline](#memory--offline)
9. [Flujos de Datos](#flujos-de-datos)
10. [Decisiones Técnicas](#decisiones-técnicas)

---

## Visión General

GMP App Movilidad es una aplicación **offline-first** para comerciales de campo, construida con Flutter 3.24+ y Node.js backend con DB2/ODBC. Sigue principios de **Clean Architecture**, **DDD** y **SOLID**.

### Stack Tecnológico

| Capa | Tecnología |
|---|---|
| **Frontend** | Flutter 3.24+, Riverpod 2.5+, go_router |
| **Backend** | Node.js, Express, TypeScript (src/), JavaScript (routes/) |
| **Database** | DB2 vía ODBC (DSN='GMP'), schema JAVIER |
| **Cache** | Redis (L2) + In-memory Map (L1) |
| **Auth** | HMAC-signed JWT, bcrypt 12 rounds, refresh token rotation |
| **Security** | Helmet, CORS, Rate Limiting, Zod validation, SQL injection detection |
| **Local Storage** | Hive + SharedPreferences |

### Características Clave

- ✅ **DDD Backend**: Entity, ValueObject, Repository, UseCase patterns en `backend/src/modules/`
- ✅ **Clean Architecture**: Domain, Data, Presentation layers separados
- ✅ **Riverpod puro**: Eliminado Provider/ChangeNotifier mixto
- ✅ **Security-first**: Input validation (Zod), path sanitization, rate limiting, bcrypt, HMAC JWT
- ✅ **Performance**: Connection pooling, L1/L2 caching, response coalescing
- ✅ **Offline-first**: Hive para caché y operaciones pendientes
- ✅ **Type-safe**: Entities con Equatable, DTOs para transferencia

---

## Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────┐
│                   PRESENTATION LAYER                     │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Riverpod Providers (Notifiers)                     ││
│  │  - AuthNotifier, CartNotifier, OrdersNotifier       ││
│  │  - DashboardNotifier, CobrosNotifier, etc.          ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Pages & Widgets (ConsumerWidget)                   ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            ↕ (HTTP/Dio)
┌─────────────────────────────────────────────────────────┐
│                  BACKEND API (Express)                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Middleware: Auth, Rate Limit, Validation, Audit    ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  DDD Modules: auth, pedidos, cobros, entregas,      ││
│  │               rutero (domain/application/infra)     ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Core: Entity, ValueObject, Repository, UseCase     ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            ↕ (ODBC)
┌─────────────────────────────────────────────────────────┐
│                    DATABASE (DB2)                        │
│  Schema JAVIER: APP_USUARIOS, LACLAE, CACFIRMAS,       │
│  RUTERO_CONFIG, DELIVERY_STATUS, etc.                   │
└─────────────────────────────────────────────────────────┘
```

---

## Backend DDD Architecture

### Estructura de Módulos DDD

```
backend/src/
├── core/                          # Shared kernel
│   ├── domain/
│   │   ├── entity.js              # Base Entity class
│   │   ├── value-object.js        # Base ValueObject class
│   │   └── repository.js          # Base Repository interface
│   ├── application/
│   │   └── use-case.js            # Base UseCase class
│   └── infrastructure/
│       ├── database/
│       │   └── db2-connection-pool.js  # DB2 pool wrapper
│       ├── cache/
│       │   └── response-cache.js       # L1/L2 caching
│       └── security/
│           ├── input-validator.js      # Zod schemas
│           └── path-sanitizer.js       # Directory traversal protection
│
├── modules/                       # Bounded contexts
│   ├── auth/
│   │   ├── domain/
│   │   │   ├── user.js                 # User entity
│   │   │   └── auth-repository.js      # Repository interface
│   │   ├── application/
│   │   │   └── login-usecase.js        # Login use case
│   │   └── infrastructure/
│   │       └── db2-auth-repository.js  # DB2 implementation
│   ├── pedidos/
│   │   ├── domain/
│   │   │   └── product.js              # Product, OrderLine, Cart
│   │   ├── application/
│   │   └── infrastructure/
│   ├── cobros/
│   │   ├── domain/
│   │   │   └── cobro.js                # Cobro entity
│   │   ├── application/
│   │   └── infrastructure/
│   ├── entregas/
│   │   ├── domain/
│   │   │   └── albaran.js              # Albaran entity
│   │   ├── application/
│   │   └── infrastructure/
│   └── rutero/
│       ├── domain/
│       │   └── ruta-config.js          # RutaConfig entity
│       ├── application/
│       └── infrastructure/
│
└── shared/
    └── middleware/
        └── index.js               # Shared middleware exports
```

### Patrones DDD Implementados

**Entity Pattern**:
```javascript
class User extends Entity {
  constructor({ id, code, name, role, ... }) {
    super(id);
    this._code = code;
    // ...
  }

  hasRole(role) { return this._role === role; }

  deactivate() {
    this._active = false;
    this.addDomainEvent({ type: 'USER_DEACTIVATED', userId: this._id });
  }
}
```

**Repository Pattern**:
```javascript
class AuthRepository extends Repository {
  async findByCode(code) { throw new Error('Not implemented'); }
}

class Db2AuthRepository extends AuthRepository {
  async findByCode(code) {
    const result = await this._db.executeParams(sql, [code]);
    return result.length ? User.fromDbRow(result[0]) : null;
  }
}
```

**Use Case Pattern**:
```javascript
class LoginUseCase extends UseCase {
  constructor(authRepository, hashUtils, tokenUtils) {
    super();
    // inject dependencies
  }

  async execute({ username, password, ip, userAgent }) {
    // 1. Validate input
    // 2. Load aggregate
    // 3. Apply business logic
    // 4. Persist
    // 5. Return result
  }
}
```

---

## Estructura de Carpetas

### Frontend (Flutter)

```
lib/
├── main.dart                          # Entry point con ProviderScope
├── core/                              # Código core compartido
│   ├── api/                           # Dio client, endpoints config
│   ├── cache/                         # Hive cache service
│   ├── config/                        # Feature flags
│   ├── memory/                        # Memory management
│   ├── models/                        # Modelos legacy
│   ├── providers/                     # ⚠️ ChangeNotifier legacy (migrar)
│   ├── router/                        # go_router
│   ├── services/                      # Analytics, network, secure storage
│   ├── theme/                         # Colors, theme
│   ├── utils/                         # Formatters, responsive
│   └── widgets/                       # Reusable widgets
├── features/                          # Feature-based (UI)
│   ├── analytics/
│   ├── auth/ & authentication/
│   ├── chatbot/
│   ├── clients/
│   ├── cobros/
│   ├── commissions/
│   ├── dashboard/ & real_dashboard/
│   ├── entregas/
│   ├── facturas/
│   ├── kpi_alerts/
│   ├── objectives/
│   ├── pedidos/
│   ├── repartidor/
│   ├── rutero/
│   ├── sales_history/
│   ├── settings/
│   └── warehouse/
└── src/                               # Clean Architecture (legacy)
    ├── core/                          # Error handling
    ├── data/                          # Datasources, DTOs, Repos impl
    ├── di/                            # GetIt injection
    ├── domain/                        # Entities, Repos, UseCases
    └── presentation/                  # Riverpod providers
```

### Backend (Node.js)

```
backend/
├── server.js                          # Express entry point
├── routes/                            # Legacy JS routes (15 modules)
├── services/                          # Business logic services
├── middleware/                        # Auth, security, logging, audit
├── config/                            # DB config, environment
├── utils/                             # Common utilities
├── kpi/                               # KPI Glacius module
├── migrations/                        # DB migrations
├── src/                               # TypeScript/DDD modules (V3)
│   ├── core/                          # Shared kernel (Entity, VO, Repo)
│   ├── modules/                       # Bounded contexts (DDD)
│   └── shared/                        # Shared middleware
├── scripts/sql/                       # SQL migrations
└── __tests__/                         # Jest tests
```

---

## State Management

### Riverpod (Único patrón oficial)

La aplicación usa **exclusivamente Riverpod** para state management.

#### Tipos de Providers

```dart
// AsyncNotifier (estado asíncrono complejo)
class CartNotifier extends AutoDisposeAsyncNotifier<CartState> { ... }

// Provider (valores simples)
final authRepositoryProvider = Provider<AuthRepository>((ref) => getIt());

// StreamProvider (streams)
final filtersStreamProvider = StreamProvider<Map<String, dynamic>>(...);

// StateNotifier (estado síncrono)
class FilterNotifier extends StateNotifier<FilterState> { ... }
```

---

## Security Layer

### Implementación Actual

| Componente | Implementación |
|---|---|
| **Password Hashing** | bcrypt 12 rounds |
| **Token Auth** | HMAC SHA-256 signed JWT (custom, sin dependencia externa) |
| **Token TTL** | Access: 1h, Refresh: 7d |
| **Session Management** | In-memory con max 5 sesiones por usuario, cleanup automático |
| **Rate Limiting** | Global: 100 req/15min, Login: 5 req/15min, API: 500 req/15min |
| **CORS** | Configuración por entorno (producción: orígenes específicos) |
| **Headers** | Helmet (CSP, HSTS, X-Frame-Options, XSS, etc.) |
| **Input Validation** | Zod schemas para login, clientCode, vendorCode, productCode |
| **SQL Injection** | Detección de patrones SQL en query params y body |
| **Path Traversal** | Path sanitizer en `src/core/infrastructure/security/` |
| **Audit** | Middleware de auditoría (IP, usuario, acción, timestamp) |
| **Content-Type** | Validación estricta (solo JSON y multipart) |

### Nuevos Componentes V3 (1 Abril 2026)

- `backend/src/core/infrastructure/security/input-validator.js` - Validación centralizada con Zod
- `backend/src/core/infrastructure/security/path-sanitizer.js` - Protección contra directory traversal
- `backend/src/core/infrastructure/cache/response-cache.js` - Cache L1/L2 unificado
- `backend/src/core/infrastructure/database/db2-connection-pool.js` - Wrapper DDD para DB2

---

## Performance & Caching

### Estrategia de Cache

| Nivel | Tecnología | TTL | Uso |
|---|---|---|---|
| **L1** | In-memory Map | 5 min | Respuestas de API por proceso |
| **L2** | Redis | Configurable | Cache compartido entre procesos |
| **Preload** | Cache preloader | Startup | LACLAE + Metadata al iniciar |

### Optimizaciones Activas

- **Connection Pooling**: Pool DB2 con keepalive cada 2 min
- **Auto-recovery**: Recreación automática del pool ante errores de conexión
- **Response Coalescing**: Combina requests concurrentes idénticos
- **Compression**: gzip responses
- **Query Optimization**: Slow query detection y sugerencias de índices
- **Network Optimizer**: HTTP/2 hints, ETag, cache headers

---

## Memory & Offline

### Frontend Storage Strategy

| Storage | Uso |
|---|---|
| **Hive** | Caché de productos, pedidos pendientes, configuración |
| **SharedPreferences** | Flags, preferencias de usuario, última sesión |
| **Secure Storage** | Tokens JWT, credenciales |

### Offline Operations

- Pedidos pendientes guardados en Hive
- Sincronización al reconectar
- Cola de operaciones con reconciliación

---

## Flujos de Datos

### Flujo de Login (V3 DDD)

```
UI → AuthNotifier → LoginUseCase → Db2AuthRepository → DB2
                                    ↓
                            User Entity
                                    ↓
                        HMAC JWT (Access + Refresh)
                                    ↓
                              UI Response
```

### Flujo de Pedido

```
UI → CartNotifier → PedidosRepository → RemoteDatasource → POST /api/pedidos
                     ↓
              Hive (si offline) → Cola de sincronización
```

---

## Decisiones Técnicas

### ¿Por qué DDD en el backend?

**Problema anterior**: Lógica de negocio dispersa en routes y services sin estructura clara

**Solución**: Módulos DDD con domain/application/infrastructure separados

**Beneficios**:
- ✅ Domain puro (sin dependencias de Express)
- ✅ Testeable (mocks de repositories)
- ✅ Mantenible (cada módulo tiene responsabilidad clara)
- ✅ Escalable (nuevos módulos siguen el mismo patrón)

### ¿Por qué Riverpod en lugar de Provider + Bloc?

- ✅ Sin dependencias de BuildContext
- ✅ Compile-safe
- ✅ AutoDispose para limpieza automática
- ✅ AsyncValue para estados asíncronos

### ¿Por qué GetIt + Riverpod?

- **GetIt**: Para inyección de dependencias de servicios y repositories
- **Riverpod**: Para state management y DI de UI

---

## Migración de Legacy

### Archivos Legacy (pendientes de migrar)

| Archivo | Estado | Acción |
|---|---|---|
| `features/pedidos/providers/pedidos_provider.dart` | ⚠️ ChangeNotifier | Migrar a Riverpod |
| `core/providers/auth_provider.dart` | ⚠️ ChangeNotifier | Usar `src/presentation/providers/` |
| `core/providers/dashboard_provider.dart` | ⚠️ ChangeNotifier | Usar `src/presentation/providers/` |
| `backend/routes/` (legacy JS) | ⚠️ Sin DDD | Migrar a `backend/src/modules/` |
| `backend/services/` | ⚠️ Sin estructura | Migrar a módulos DDD |

---

## Referencias

- [Riverpod Documentation](https://riverpod.dev/)
- [Clean Architecture (Uncle Bob)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [DDD Starter Guide](https://github.com/ddd-by-examples/ddd-by-examples)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**Última actualización**: 1 Abril 2026
**Versión de la app**: 3.3.2+37
**Arquitectura**: Clean Architecture + DDD + Riverpod + V3 Integration
**Autor**: Equipo GMP - V3 Swarm Coordination
