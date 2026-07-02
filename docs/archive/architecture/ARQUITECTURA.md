# 🏗️ ARQUITECTURA TÉCNICA - GMP APP MOVILIDAD

**Última actualización**: 1 de Abril de 2026  
**Versión de la app**: 3.3.2+37  
**Estado de Arquitectura**: 🟡 En Migración (10.7% completado)

---

## 📋 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Estado de la Arquitectura](#estado-de-la-arquitectura)
3. [Arquitectura de Alto Nivel](#arquitectura-de-alto-nivel)
4. [Backend DDD Architecture](#backend-ddd-architecture)
5. [Módulos Implementados](#módulos-implementados)
6. [Código Legacy Pendiente](#código-legacy-pendiente)
7. [Frontend Architecture](#frontend-architecture)
8. [Security Layer](#security-layer)
9. [Performance & Caching](#performance--caching)
10. [Flujos de Datos](#flujos-de-datos)
11. [Decisiones Arquitectónicas](#decisiones-arquitectónicas)
12. [Roadmap de Migración](#roadmap-de-migración)

---

## Visión General

GMP App Movilidad es una aplicación **offline-first** para comerciales de campo, construida con **Flutter 3.24+** y **Node.js** backend con **DB2/ODBC**.

La arquitectura actual está en **transición** de un diseño monolítico hacia **Clean Architecture + DDD**.

### Estado Actual

| Dimensión | Estado | Progreso |
|-----------|--------|----------|
| **Backend DDD** | 🟡 En Progreso | 15% (solo auth completo) |
| **Frontend Riverpod** | 🔴 Pendiente | 0% (aún usa ChangeNotifier) |
| **Security** | ✅ Completo | 100% |
| **Performance** | ✅ Completo | 100% |
| **Testing** | 🔴 Pendiente | <5% |

---

## Estado de la Arquitectura

### ✅ Componentes Completados (Fase 1)

```
backend/src/core/
├── domain/
│   ├── entity.js                    ✅ Base class para entidades DDD
│   ├── value-object.js              ✅ Base class para objetos de valor
│   └── repository.js                ✅ Interfaz base para repositorios
├── application/
│   └── use-case.js                  ✅ Base class para casos de uso
├── infrastructure/
│   ├── database/
│   │   └── db2-connection-pool.js   ✅ Pool con keepalive + auto-recovery
│   ├── cache/
│   │   └── response-cache.js        ✅ Cache L1/L2 unificado
│   └── security/
│       ├── input-validator.js       ✅ Validación Zod centralizada
│       └── path-sanitizer.js        ✅ Protección directory traversal
└── shared/
    └── middleware/
        └── index.js                 ✅ Middleware compartido
```

### 🟡 Componentes Parciales (Fase 2)

```
backend/src/modules/
├── auth/              ✅ COMPLETO (100%)
│   ├── domain/
│   │   ├── user.js                ✅ Entity User
│   │   └── auth-repository.js     ✅ Interfaz
│   ├── application/
│   │   └── login-usecase.js       ✅ Caso de uso
│   └── infrastructure/
│       └── db2-auth-repository.js ✅ Implementación DB2
│
├── pedidos/           ⚠️ PARCIAL (15%)
│   ├── domain/
│   │   └── product.js             ✅ Entity Product
│   ├── application/
│   │   └── (vacío)                ❌ Faltan use cases
│   └── infrastructure/
│       └── (vacío)                ❌ Faltan repositories
│
├── cobros/            ⚠️ PARCIAL (10%)
│   ├── domain/
│   │   └── cobro.js               ✅ Entity Cobro
│   ├── application/
│   │   └── (vacío)                ❌ Faltan use cases
│   └── infrastructure/
│       └── (vacío)                ❌ Faltan repositories
│
├── entregas/          ⚠️ PARCIAL (10%)
│   ├── domain/
│   │   └── albaran.js             ✅ Entity AlbaranEntrega
│   ├── application/
│   │   └── (vacío)                ❌ Faltan use cases
│   └── infrastructure/
│       └── (vacío)                ❌ Faltan repositories
│
└── rutero/            ⚠️ PARCIAL (10%)
    ├── domain/
    │   └── ruta-config.js         ✅ Entity RutaConfig
    ├── application/
    │   └── (vacío)                ❌ Faltan use cases
    └── infrastructure/
        └── (vacío)                ❌ Faltan repositories
```

### ❌ Componentes No Iniciados (Fase 3+)

| Componente | Ubicación Actual | Destino DDD | Estado |
|------------|------------------|-------------|--------|
| **Routes Legacy** | `backend/routes/` (15 archivos) | `backend/src/modules/*/infrastructure/controllers/` | ❌ Sin migrar |
| **Services Legacy** | `backend/services/` (20+ archivos) | `backend/src/modules/*/application/` | ❌ Sin migrar |
| **ChangeNotifiers** | `lib/core/providers/` (6 archivos) | `lib/features/*/providers/*_notifier.dart` | ❌ Sin migrar |
| **Storage Mixto** | Hive + SharedPreferences | `lib/core/storage/` unificado | ❌ Sin migrar |

---

## Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────┐
│                   PRESENTATION LAYER                     │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Flutter Widgets (ConsumerWidget, HookConsumerWidget)││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  State Providers (Riverpod + ChangeNotifier Legacy) ││
│  │  - AuthNotifier (✅ Riverpod)                       ││
│  │  - PedidosNotifier (⚠️ ChangeNotifier)              ││
│  │  - DashboardNotifier (⚠️ ChangeNotifier)            ││
│  │  - CobrosNotifier (⚠️ ChangeNotifier)               ││
│  │  - EntregasNotifier (⚠️ ChangeNotifier)             ││
│  │  - RuteroNotifier (⚠️ ChangeNotifier)               ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            ↕ (HTTP/Dio)
┌─────────────────────────────────────────────────────────┐
│                  BACKEND API (Express)                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Middleware Stack                                   ││
│  │  - helmet, cors, rate-limit, compression            ││
│  │  - auth-middleware (HMAC JWT)                       ││
│  │  - audit-middleware (IP, user, action)              ││
│  │  - input-validation (Zod schemas)                   ││
│  │  - sql-injection-detection                          ││
│  │  - path-traversal-protection                        ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  DDD Modules (TypeScript) - 15% completado          ││
│  │  - auth (✅ completo)                               ││
│  │  - pedidos (⚠️ domain solo)                         ││
│  │  - cobros (⚠️ domain solo)                          ││
│  │  - entregas (⚠️ domain solo)                        ││
│  │  - rutero (⚠️ domain solo)                          ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Legacy Routes (JavaScript) - 85% activo            ││
│  │  - 15 archivos, ~3,500 líneas                       ││
│  │  - Auth, pedidos, cobros, entregas, rutero, etc.    ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Core Infrastructure                                ││
│  │  - DB2 Connection Pool (keepalive 2min)             ││
│  │  - Response Cache L1/L2                             ││
│  │  - Security (input-validator, path-sanitizer)       ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            ↕ (ODBC)
┌─────────────────────────────────────────────────────────┐
│                    DATABASE (DB2 iSeries)                │
│  Schema JAVIER:                                          │
│  - APP_USUARIOS (usuarios, roles, permisos)             │
│  - LACLAE (líneas de ventas, clientes, vendedores)      │
│  - CAC (cabeceras de albarán/factura)                   │
│  - CPC (líneas de albarán)                              │
│  - CACFIRMAS (firmas digitales de clientes)             │
│  - RUTERO_CONFIG (rutas por día)                        │
│  - RUTERO_LOG (histórico de cambios)                    │
│  - DELIVERY_STATUS (estados de entrega)                 │
│  - PMRL1/PMPL1 (promociones)                            │
│  └─────────────────────────────────────────────────────┘│
```

---

## Backend DDD Architecture

### Patrones DDD Implementados

#### Entity Pattern ✅

```javascript
// backend/src/core/domain/entity.js
class Entity {
  constructor(id) {
    if (new.target === Entity) {
      throw new TypeError('Cannot construct Entity instances directly');
    }
    this._id = id;
    this._domainEvents = [];
  }

  get id() { return this._id; }
  
  equals(other) {
    if (!other || !(other instanceof Entity)) return false;
    return this._id === other.id;
  }

  addDomainEvent(event) { this._domainEvents.push(event); }
  getUncommittedEvents() { return [...this._domainEvents]; }
  markEventsAsCommitted() { this._domainEvents = []; }
}
```

**Entidades del Dominio**:

| Entidad | Módulo | Estado | Archivo |
|---------|--------|--------|---------|
| `User` | auth | ✅ | `backend/src/modules/auth/domain/user.js` |
| `Product`, `Cart`, `OrderLine` | pedidos | ✅ | `backend/src/modules/pedidos/domain/product.js` |
| `Cobro` | cobros | ✅ | `backend/src/modules/cobros/domain/cobro.js` |
| `AlbaranEntrega` | entregas | ✅ | `backend/src/modules/entregas/domain/albaran.js` |
| `RutaConfig` | rutero | ✅ | `backend/src/modules/rutero/domain/ruta-config.js` |

---

#### Repository Pattern ✅

```javascript
// backend/src/core/domain/repository.js
class Repository {
  constructor(dataSource) {
    if (new.target === Repository) {
      throw new TypeError('Cannot construct Repository instances directly');
    }
  }

  async findById(id) { throw new Error('Not implemented'); }
  async findAll() { throw new Error('Not implemented'); }
  async save(entity) { throw new Error('Not implemented'); }
  async delete(id) { throw new Error('Not implemented'); }
}
```

**Repositorios Implementados**:

| Repositorio | Módulo | Estado | Archivo |
|-------------|--------|--------|---------|
| `AuthRepository` (interface) | auth | ✅ | `backend/src/modules/auth/domain/auth-repository.js` |
| `Db2AuthRepository` (impl) | auth | ✅ | `backend/src/modules/auth/infrastructure/db2-auth-repository.js` |
| `ProductRepository` (interface) | pedidos | ❌ | No existe |
| `Db2ProductRepository` (impl) | pedidos | ❌ | No existe |
| `OrderRepository` (interface) | pedidos | ❌ | No existe |
| `Db2OrderRepository` (impl) | pedidos | ❌ | No existe |

---

#### Use Case Pattern ✅

```javascript
// backend/src/core/application/use-case.js
class UseCase {
  constructor() {
    if (new.target === UseCase) {
      throw new TypeError('Cannot construct UseCase instances directly');
    }
  }

  async execute(params) {
    throw new Error('Not implemented');
  }
}
```

**Casos de Uso Implementados**:

| Use Case | Módulo | Estado | Archivo |
|----------|--------|--------|---------|
| `LoginUseCase` | auth | ✅ | `backend/src/modules/auth/application/login-usecase.js` |
| `GetProductsUseCase` | pedidos | ❌ | No existe |
| `CreateOrderUseCase` | pedidos | ❌ | No existe |
| `GetAlbaranesUseCase` | entregas | ❌ | No existe |
| `GetCobrosUseCase` | cobros | ❌ | No existe |
| `GetRutaUseCase` | rutero | ❌ | No existe |

---

## Módulos Implementados

### Módulo Auth (✅ COMPLETO)

**Responsabilidad**: Autenticación de usuarios con HMAC JWT

**Flujo**:
```
POST /api/auth/login
    ↓
LoginUseCase.execute({ username, password, ip, userAgent })
    ↓
1. Validate input (Zod schema)
2. Load User via AuthRepository
3. Verify password (bcrypt 12 rounds)
4. Generate HMAC JWT (access + refresh)
5. Store session (in-memory, max 5 per user)
6. Return { accessToken, refreshToken, user }
```

**Archivos**:
- `backend/src/modules/auth/domain/user.js` — Entity User
- `backend/src/modules/auth/domain/auth-repository.js` — Interfaz
- `backend/src/modules/auth/application/login-usecase.js` — Caso de uso
- `backend/src/modules/auth/infrastructure/db2-auth-repository.js` — Implementación DB2

**Security Features**:
- ✅ bcrypt 12 rounds para hashing
- ✅ HMAC SHA-256 signed JWT (custom, sin dependencia externa)
- ✅ Access token TTL: 1h, Refresh token TTL: 7d
- ✅ Refresh token rotation
- ✅ Máximo 5 sesiones activas por usuario
- ✅ Session cleanup automático

---

### Módulo Pedidos (⚠️ PARCIAL)

**Responsabilidad**: Catálogo de productos, carrito, pedidos, promociones

**Estado Actual**:
- ✅ Entity `Product`, `Cart`, `OrderLine` definidas
- ❌ Sin casos de uso implementados
- ❌ Sin repositorios DB2
- ⚠️ Routes legacy activas (`backend/routes/pedidos.js`)

**Lo que falta implementar**:
```
backend/src/modules/pedidos/
├── application/
│   ├── get-products-usecase.js         ❌ Con validación cliente obligatorio
│   ├── get-product-detail-usecase.js   ❌ Con fallback a tarifa 1
│   ├── get-promotions-usecase.js       ❌ Con deduplicación global/cliente
│   └── create-order-usecase.js         ❌ Con persistencia DB2
└── infrastructure/
    ├── db2-product-repository.js       ❌ Queries optimizados
    └── db2-order-repository.js         ❌ Persistencia de pedidos
```

**Rutas legacy activas** (pendientes de eliminar):
- `GET /api/pedidos/products` — Requiere `clientCode` (400 si falta)
- `GET /api/pedidos/products/:code` — Detalle con fallback a tarifa 1
- `GET /api/pedidos/promotions` — Promos globales + cliente
- `POST /api/pedidos/create` — Crear pedido

---

### Módulo Cobros (⚠️ PARCIAL)

**Responsabilidad**: Gestión de cobros, repartidores, formas de pago

**Estado Actual**:
- ✅ Entity `Cobro` definida
- ❌ Sin casos de uso implementados
- ❌ Sin repositorios DB2
- ⚠️ Routes legacy activas (`backend/routes/cobros.js`)

---

### Módulo Entregas (⚠️ PARCIAL)

**Responsabilidad**: Listado y detalle de albaranes, estados de entrega

**Estado Actual**:
- ✅ Entity `AlbaranEntrega` definida
- ❌ Sin casos de uso implementados
- ❌ Sin repositorios DB2
- ⚠️ Routes legacy activas (`backend/routes/entregas.js`)

**Bug Crítico Pendiente**:
```javascript
// backend/routes/entregas.js línea 206
// BUG: Usa CPC.IMPORTEBRUTO en lugar de CPC.IMPORTETOTAL
const sql = `SELECT CPC.IMPORTEBRUTO, ...`;  // ❌ Incorrecto
// FIX: 
const sql = `SELECT CPC.IMPORTETOTAL, ...`;  // ✅ Correcto
```

---

### Módulo Rutero (⚠️ PARCIAL)

**Responsabilidad**: Organización de rutas, clientes por día, KPIs

**Estado Actual**:
- ✅ Entity `RutaConfig` definida
- ❌ Sin casos de uso implementados
- ❌ Sin repositorios DB2
- ⚠️ Routes legacy activas (`backend/routes/rutero.js`)

---

## Código Legacy Pendiente

### Routes Legacy (15 archivos JS — ~3,500 líneas)

| Ruta | Líneas | Complejidad | Prioridad | Acción |
|------|--------|-------------|-----------|--------|
| `auth.js` | 180 | Media | Alta | ⚠️ Coexiste con DDD |
| `pedidos.js` | 450 | Alta | Alta | ❌ Migrar |
| `cobros.js` | 320 | Alta | Media | ❌ Migrar |
| `entregas.js` | 380 | Alta | Alta | ❌ Migrar (fix IVA) |
| `rutero.js` | 420 | Alta | Alta | ❌ Migrar |
| `dashboard.js` | 280 | Media | Media | ❌ Migrar |
| `clients.js` | 240 | Baja | Baja | ❌ Migrar |
| `commissions.js` | 190 | Media | Baja | ❌ Migrar |
| `objectives.js` | 150 | Baja | Baja | ❌ Migrar |
| `repartidor.js` | 290 | Media | Media | ❌ Migrar |
| `warehouse.js` | 210 | Media | Baja | ❌ Migrar |
| `manual-layout.js` | 140 | Baja | Baja | ❌ Migrar |
| `load-plan.js` | 180 | Media | Baja | ❌ Migrar |
| `chatbot.js` | 90 | Baja | Baja | ❌ Migrar |
| `kpi-alerts.js` | 120 | Media | Baja | ❌ Migrar |

**Estrategia de Migración**:
1. Implementar módulo DDD completo
2. Tests unitarios + integración
3. Cambiar endpoint para usar DDD
4. Verificar con tests E2E
5. Eliminar archivo legacy

---

### Services Legacy (20+ archivos JS — ~2,800 líneas)

| Service | Líneas | Responsabilidad | Estado |
|---------|--------|-----------------|--------|
| `pedidos.service.js` | 280 | Productos, promos, pedidos | ❌ Migrar a application layer |
| `cobros.service.js` | 220 | Cobros, repartidores | ❌ Migrar |
| `entregas.service.js` | 190 | Albaranes, entregas | ❌ Migrar |
| `rutero.service.js` | 240 | Rutas, organización | ❌ Migrar |
| `auth.service.js` | 150 | Auth legacy | ⚠️ Coexiste con DDD |
| `dashboard.service.js` | 180 | KPIs, métricas | ❌ Migrar |
| `clients.service.js` | 140 | Clientes | ❌ Migrar |
| `commissions.service.js` | 160 | Comisiones | ❌ Migrar |
| `objectives.service.js` | 120 | Objetivos | ❌ Migrar |
| `repartidor.service.js` | 170 | Repartidor | ❌ Migrar |
| `warehouse.service.js` | 190 | Load planning | ❌ Migrar |
| `image.service.js` | 80 | Imágenes | ❌ Migrar |
| `cache.service.js` | 110 | Cache manual | ⚠️ Reemplazado |
| `db.service.js` | 90 | DB helper | ⚠️ Reemplazado |

---

## Frontend Architecture

### State Management (⚠️ Mixto)

| Provider | Tipo | Líneas | Estado | Acción |
|----------|------|--------|--------|--------|
| `AuthNotifier` | Riverpod AsyncNotifier | 180 | ✅ Completo | Ninguna |
| `pedidos_provider.dart` | ChangeNotifier | 420 | ⚠️ Legacy | Migrar a AsyncNotifier |
| `dashboard_provider.dart` | ChangeNotifier | 290 | ⚠️ Legacy | Migrar |
| `cobros_provider.dart` | ChangeNotifier | 240 | ⚠️ Legacy | Migrar |
| `entregas_provider.dart` | ChangeNotifier | 210 | ⚠️ Legacy | Migrar |
| `rutero_provider.dart` | ChangeNotifier | 380 | ⚠️ Legacy | Migrar |

### Storage (⚠️ Sin Unificar)

| Storage | Uso | Estado |
|---------|-----|--------|
| **Hive** | Caché productos, pedidos pendientes | ⚠️ Sin unificar |
| **SharedPreferences** | Flags, preferencias, última sesión | ⚠️ Sin unificar |
| **Secure Storage** | Tokens JWT | ✅ Correcto |

**Arquitectura Objetivo**:
```
lib/core/storage/
├── storage-service.ts           ✅ Interfaz unificada
├── hive-storage-adapter.ts      ⚠️ Pendiente
├── shared-preferences-adapter.ts ⚠️ Pendiente
└── secure-storage-adapter.ts    ✅ Implementado
```

---

## Security Layer

### Implementación Actual

| Componente | Implementación | Estado |
|------------|----------------|--------|
| **Password Hashing** | bcrypt 12 rounds | ✅ |
| **Token Auth** | HMAC SHA-256 signed JWT | ✅ |
| **Token TTL** | Access: 1h, Refresh: 7d | ✅ |
| **Session Management** | In-memory, max 5 sesiones | ✅ |
| **Rate Limiting** | Global: 100/15min, Login: 5/15min | ✅ |
| **CORS** | Configuración por entorno | ✅ |
| **Headers** | Helmet (CSP, HSTS, X-Frame-Options) | ✅ |
| **Input Validation** | Zod schemas | ✅ |
| **SQL Injection** | Detección de patrones | ✅ |
| **Path Traversal** | Path sanitizer | ✅ |
| **Audit** | Middleware de auditoría | ✅ |
| **Content-Type** | Validación estricta | ✅ |

### Componentes V3

| Componente | Archivo | Estado |
|------------|---------|--------|
| `input-validator.js` | `backend/src/core/infrastructure/security/` | ✅ |
| `path-sanitizer.js` | `backend/src/core/infrastructure/security/` | ✅ |

---

## Performance & Caching

### Estrategia de Cache

| Nivel | Tecnología | TTL | Uso |
|-------|------------|-----|-----|
| **L1** | In-memory Map | 5 min | Respuestas API por proceso |
| **L2** | Redis | Configurable | Cache compartido (⚠️ no en dev) |
| **Preload** | Cache preloader | Startup | LACLAE + Metadata |

### Optimizaciones Activas

| Optimización | Estado | Descripción |
|--------------|--------|-------------|
| **Connection Pooling** | ✅ | Pool DB2 con keepalive cada 2 min |
| **Auto-recovery** | ✅ | Recreación automática ante errores |
| **Response Coalescing** | ✅ | Combina requests concurrentes |
| **Compression** | ✅ | gzip responses |
| **Slow Query Detection** | ✅ | Detección y sugerencias de índices |

### Componentes V3

| Componente | Archivo | Estado |
|------------|---------|--------|
| `response-cache.js` | `backend/src/core/infrastructure/cache/` | ✅ |
| `db2-connection-pool.js` | `backend/src/core/infrastructure/database/` | ✅ |

---

## Flujos de Datos

### Flujo de Login (DDD Implementado)

```
┌─────────┐
│   UI    │
│ (Flutter)│
└────┬────┘
     │ POST /api/auth/login
     ↓
┌─────────────────────────────────┐
│  LoginUseCase.execute()         │
│  1. Validate (Zod)              │
│  2. AuthRepository.findByCode() │
│  3. Verify password (bcrypt)    │
│  4. Generate HMAC JWT           │
│  5. Store session               │
└────────┬────────────────────────┘
         │
         ↓
┌─────────────────────────────────┐
│  Db2AuthRepository              │
│  SELECT * FROM APP_USUARIOS     │
│  WHERE CODIGOUSUARIO = ?        │
└────────┬────────────────────────┘
         │
         ↓
┌─────────────────────────────────┐
│  DB2 (Schema JAVIER)            │
│  APP_USUARIOS table             │
└─────────────────────────────────┘
```

### Flujo de Pedido (Legacy → Futuro DDD)

```
┌─────────┐
│   UI    │
│ (Flutter)│
└────┬────┘
     │ POST /api/pedidos/create
     ↓
┌─────────────────────────────────┐
│  Legacy: pedidos.service.js     │ ⚠️ PENDIENTE MIGRAR
│  - Validate client              │
│  - Check stock                  │
│  - Apply promos                 │
│  - Insert CPC                   │
└────────┬────────────────────────┘
         │
         ↓
┌─────────────────────────────────┐
│  DB2 (Schema JAVIER)            │
│  CPC, CAC tables                │
└─────────────────────────────────┘
```

---

## Decisiones Arquitectónicas

### Decisiones Tomadas

| Decisión | Fecha | Estado | Justificación |
|----------|-------|--------|---------------|
| **DDD como patrón principal** | Mar 2026 | ✅ Adoptado | Separación clara, testeable, mantenible |
| **Riverpod único para state** | Mar 2026 | ✅ Adoptado | Compile-safe, auto-dispose |
| **TypeScript para módulos nuevos** | Mar 2026 | ✅ Adoptado | Type-safety, mejor DX |
| **Cliente obligatorio para catálogo** | Mar 2026 | ✅ Adoptado | Precios/promos específicos |
| **Cache L1/L2 unificado** | Mar 2026 | ✅ Adoptado | Performance consistente |
| **HMAC JWT custom** | Mar 2026 | ✅ Adoptado | Sin dependencias externas |

### Decisiones Pendientes

| Decisión | Prioridad | Impacto | Deadline |
|----------|-----------|---------|----------|
| **Estrategia de migración legacy** | Alta | Bloquea progreso | Q2 2026 |
| **Unificación de storage Flutter** | Media | Mantenibilidad | Q2 2026 |
| **Testing framework E2E** | Media | Calidad | Q2 2026 |
| **Redis en todos los entornos** | Baja | Performance | Q2 2026 |

---

## Roadmap de Migración

### Q2 2026 (Abril - Junio)

| Sprint | Objetivo | Entregables |
|--------|----------|-------------|
| **Sprint 1** | Módulo Pedidos DDD | Use cases + repositories |
| **Sprint 2** | Módulo Entregas DDD | Fix IVA + migración |
| **Sprint 3** | Módulo Cobros DDD | Use cases + repositories |
| **Sprint 4** | Módulo Rutero DDD | Use cases + repositories |
| **Sprint 5** | Migración Routes | 50% routes migradas |
| **Sprint 6** | Frontend Riverpod | 50% ChangeNotifiers migrados |

---

## Referencias

- [PLAN.md](./PLAN.md) — Plan maestro con roadmap detallado
- [docs/archive/](./docs/archive/) — Documentación histórica
- [Riverpod Documentation](https://riverpod.dev/)
- [DDD Starter Guide](https://github.com/ddd-by-examples/ddd-by-examples)
- [Clean Architecture (Uncle Bob)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

---

**Documento mantenido por**: Equipo GMP — V3 Swarm Coordination  
**Próxima revisión**: 8 de Abril de 2026
