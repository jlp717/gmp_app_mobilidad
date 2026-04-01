# 📋 PLAN MAESTRO - GMP App Movilidad

**Última actualización**: 1 de Abril de 2026  
**Versión actual**: 3.3.2+37  
**Estado general**: 🟡 En Migración Arquitectónica

---

## 🎯 Objetivos Estratégicos

1. **Migración a DDD**: Transicionar de arquitectura monolítica a Clean Architecture + DDD
2. **Deuda Técnica**: Eliminar código legacy, debug, y archivos temporales
3. **Calidad Senior**: Establecer patrones consistentes, type-safety, y testing
4. **Performance**: Optimizar caching, connection pooling, y respuesta API

---

## 📊 Estado Real del Proyecto

### ✅ Fase 1: Cimientos DDD (COMPLETADO - 100%)

| Componente | Estado | Archivos | Notas |
|------------|--------|----------|-------|
| **Entity Pattern** | ✅ Completo | `backend/src/core/domain/entity.js` | Base class para todas las entidades |
| **ValueObject Pattern** | ✅ Completo | `backend/src/core/domain/value-object.js` | Para objetos de valor inmutables |
| **Repository Interface** | ✅ Completo | `backend/src/core/domain/repository.js` | Interfaz base para repositorios |
| **UseCase Pattern** | ✅ Completo | `backend/src/core/application/use-case.js` | Base para casos de uso |
| **DB2 Connection Pool** | ✅ Completo | `backend/src/core/infrastructure/database/db2-connection-pool.js` | Pool con auto-recovery |
| **Response Cache L1/L2** | ✅ Completo | `backend/src/core/infrastructure/cache/response-cache.js` | Cache in-memory + Redis |
| **Input Validator (Zod)** | ✅ Completo | `backend/src/core/infrastructure/security/input-validator.js` | Validación centralizada |
| **Path Sanitizer** | ✅ Completo | `backend/src/core/infrastructure/security/path-sanitizer.js` | Protección directory traversal |

---

### 🟡 Fase 2: Módulos de Negocio DDD (EN PROGRESO - 20%)

#### Módulo Auth (✅ COMPLETO - 100%)

```
backend/src/modules/auth/
├── domain/
│   ├── user.js                    ✅ Entity User implementada
│   └── auth-repository.js         ✅ Interfaz de repositorio
├── application/
│   └── login-usecase.js           ✅ Caso de uso de login
└── infrastructure/
    └── db2-auth-repository.js     ✅ Implementación DB2
```

**Estado**: Funcional y testeado. Login con HMAC JWT, bcrypt 12 rounds, refresh token rotation.

---

#### Módulo Pedidos (⚠️ PARCIAL - 15%)

```
backend/src/modules/pedidos/
├── domain/
│   └── product.js                 ✅ Entity Product (cart, orderLine)
├── application/
│   ├── get-products-usecase.js    ❌ NO EXISTE
│   ├── create-order-usecase.js    ❌ NO EXISTE
│   ├── get-product-detail-usecase.js ❌ NO EXISTE
│   └── get-promotions-usecase.js  ❌ NO EXISTE
└── infrastructure/
    ├── db2-product-repository.js  ❌ NO EXISTE
    └── db2-order-repository.js    ❌ NO EXISTE
```

**Lo que falta**:
- [ ] Implementar `get-products-usecase.js` con validación de cliente obligatorio
- [ ] Implementar `create-order-usecase.js` con persistencia DB2
- [ ] Implementar `get-product-detail-usecase.js` con fallback a tarifa 1
- [ ] Implementar `get-promotions-usecase.js` con deduplicación global/cliente
- [ ] Implementar `db2-product-repository.js` con queries optimizados
- [ ] Implementar `db2-order-repository.js` para persistencia de pedidos

**Rutas legacy activas** (pendientes de migrar):
- `backend/routes/pedidos.js` — 450 líneas, sin DDD

---

#### Módulo Cobros (⚠️ PARCIAL - 10%)

```
backend/src/modules/cobros/
├── domain/
│   └── cobro.js                   ✅ Entity Cobro
├── application/
│   ├── get-cobros-usecase.js      ❌ NO EXISTE
│   ├── create-cobro-usecase.js    ❌ NO EXISTE
│   └── get-pending-cobros-usecase.js ❌ NO EXISTE
└── infrastructure/
    └── db2-cobro-repository.js    ❌ NO EXISTE
```

**Lo que falta**:
- [ ] Implementar casos de uso para obtención y creación de cobros
- [ ] Implementar repositorio DB2 con queries para CAC, CPC, formas de pago
- [ ] Migrar lógica de `backend/routes/cobros.js`

---

#### Módulo Entregas (⚠️ PARCIAL - 10%)

```
backend/src/modules/entregas/
├── domain/
│   └── albaran.js                 ✅ Entity AlbaranEntrega
├── application/
│   ├── get-albaranes-usecase.js   ❌ NO EXISTE
│   ├── get-albaran-detail-usecase.js ❌ NO EXISTE
│   └── update-delivery-status-usecase.js ❌ NO EXISTE
└── infrastructure/
    └── db2-albaran-repository.js  ❌ NO EXISTE
```

**Lo que falta**:
- [ ] Implementar casos de uso para listados y detalles de albaranes
- [ ] Implementar repositorio DB2 con queries para CPC, CAC, estados
- [ ] Migrar lógica de `backend/routes/entregas.js` (incluye fix de importes IVA)

---

#### Módulo Rutero (⚠️ PARCIAL - 10%)

```
backend/src/modules/rutero/
├── domain/
│   └── ruta-config.js             ✅ Entity RutaConfig
├── application/
│   ├── get-ruta-usecase.js        ❌ NO EXISTE
│   ├── update-ruta-usecase.js     ❌ NO EXISTE
│   ├── move-clients-usecase.js    ❌ NO EXISTE
│   └── get-kpis-usecase.js        ❌ NO EXISTE
└── infrastructure/
    └── db2-ruta-repository.js     ❌ NO EXISTE
```

**Lo que falta**:
- [ ] Implementar casos de uso para gestión de rutas (lunes-viernes, sábado)
- [ ] Implementar repositorio DB2 con queries para RUTERO_CONFIG, RUTERO_LOG
- [ ] Migrar lógica de `backend/routes/rutero.js`

---

### ❌ Fase 3: Migración de Legacy (NO INICIADO - 0%)

#### Routes Legacy (15 archivos JS — ~3,500 líneas)

| Ruta | Líneas | Complejidad | Prioridad | Estado |
|------|--------|-------------|-----------|--------|
| `auth.js` | 180 | Media | Alta | ⚠️ Pendiente (existe DDD en src/) |
| `pedidos.js` | 450 | Alta | Alta | ❌ Sin migrar |
| `cobros.js` | 320 | Alta | Media | ❌ Sin migrar |
| `entregas.js` | 380 | Alta | Alta | ❌ Sin migrar (tiene fix IVA pendiente) |
| `rutero.js` | 420 | Alta | Alta | ❌ Sin migrar |
| `dashboard.js` | 280 | Media | Media | ❌ Sin migrar |
| `clients.js` | 240 | Baja | Baja | ❌ Sin migrar |
| `commissions.js` | 190 | Media | Baja | ❌ Sin migrar |
| `objectives.js` | 150 | Baja | Baja | ❌ Sin migrar |
| `repartidor.js` | 290 | Media | Media | ❌ Sin migrar |
| `warehouse.js` | 210 | Media | Baja | ❌ Sin migrar |
| `manual-layout.js` | 140 | Baja | Baja | ❌ Sin migrar |
| `load-plan.js` | 180 | Media | Baja | ❌ Sin migrar |
| `chatbot.js` | 90 | Baja | Baja | ❌ Sin migrar |
| `kpi-alerts.js` | 120 | Media | Baja | ❌ Sin migrar |

**Total**: ~3,500 líneas de código legacy sin migrar a DDD TypeScript.

---

#### Services Legacy (20+ archivos JS — ~2,800 líneas)

| Service | Líneas | Responsabilidad | Estado |
|---------|--------|-----------------|--------|
| `pedidos.service.js` | 280 | Lógica de pedidos, promos, productos | ❌ Sin migrar |
| `cobros.service.js` | 220 | Lógica de cobros, repartidores | ❌ Sin migrar |
| `entregas.service.js` | 190 | Lógica de albaranes, entregas | ❌ Sin migrar |
| `rutero.service.js` | 240 | Lógica de rutas, organización | ❌ Sin migrar |
| `auth.service.js` | 150 | Autenticación legacy | ⚠️ Coexiste con DDD |
| `dashboard.service.js` | 180 | KPIs, métricas dashboard | ❌ Sin migrar |
| `clients.service.js` | 140 | Gestión de clientes | ❌ Sin migrar |
| `commissions.service.js` | 160 | Cálculo de comisiones | ❌ Sin migrar |
| `objectives.service.js` | 120 | Objetivos comerciales | ❌ Sin migrar |
| `repartidor.service.js` | 170 | Lógica de repartidor | ❌ Sin migrar |
| `warehouse.service.js` | 190 | Planificación de carga | ❌ Sin migrar |
| `image.service.js` | 80 | Servicio de imágenes | ❌ Sin migrar |
| `cache.service.js` | 110 | Cache manual | ⚠️ Reemplazado por response-cache.js |
| `db.service.js` | 90 | DB helper legacy | ⚠️ Reemplazado por db2-connection-pool.js |

**Total**: ~2,800 líneas de servicios legacy sin migrar a application layer DDD.

---

### ❌ Fase 4: Frontend Flutter (NO INICIADO - 0%)

#### ChangeNotifiers Legacy (pendientes de migrar a Riverpod)

| Provider | Líneas | Estado | Acción Requerida |
|----------|--------|--------|------------------|
| `auth_provider.dart` | 180 | ⚠️ ChangeNotifier | Migrar a `AuthNotifier extends AsyncNotifier` |
| `pedidos_provider.dart` | 420 | ⚠️ ChangeNotifier | Migrar a `PedidosNotifier extends AsyncNotifier` |
| `dashboard_provider.dart` | 290 | ⚠️ ChangeNotifier | Migrar a `DashboardNotifier extends AsyncNotifier` |
| `cobros_provider.dart` | 240 | ⚠️ ChangeNotifier | Migrar a `CobrosNotifier extends AsyncNotifier` |
| `entregas_provider.dart` | 210 | ⚠️ ChangeNotifier | Migrar a `EntregasNotifier extends AsyncNotifier` |
| `rutero_provider.dart` | 380 | ⚠️ ChangeNotifier | Migrar a `RuteroNotifier extends AsyncNotifier` |

**Total**: ~1,720 líneas de ChangeNotifiers legacy.

#### Storage Unification (Pendiente)

| Storage | Uso Actual | Estado |
|---------|------------|--------|
| **Hive** | Caché productos, pedidos pendientes | ⚠️ Sin unificar |
| **SharedPreferences** | Flags, preferencias, última sesión | ⚠️ Sin unificar |
| **Secure Storage** | Tokens JWT | ✅ Correcto |

**Lo que falta**:
- [ ] Crear `StorageService` unificado con interfaz clara
- [ ] Migrar todo Hive a una capa abstracta
- [ ] Migrar todo SharedPreferences a la misma capa
- [ ] Implementar estrategia de migración de datos

---

## 🎯 Roadmap de Implementación

### Sprint 1: Completar Módulo Pedidos DDD (Prioridad: ALTA)

**Objetivo**: Tener el flujo completo de pedidos migrado a DDD

**Tareas**:
1. [ ] `GetProductsUseCase` — Listar productos con cliente obligatorio
2. [ ] `GetProductDetailUseCase` — Detalle con fallback a tarifa 1
3. [ ] `GetPromotionsUseCase` — Promos globales + cliente, deduplicación
4. [ ] `CreateOrderUseCase` — Crear pedido con validación robusta
5. [ ] `Db2ProductRepository` — Implementación DB2 con connection pooling
6. [ ] `Db2OrderRepository` — Persistencia de pedidos
7. [ ] Tests unitarios para cada use case
8. [ ] Tests de integración con DB2 mock

**Criterio de Aceptación**:
- ✅ `GET /api/pedidos/products` sin clientCode → 400
- ✅ `GET /api/pedidos/products/:code` con fallo tarifa cliente → fallback a tarifa 1 (no 500)
- ✅ Promociones sin duplicados funcionales
- ✅ Pedido creado retorna ID y limpia carrito

---

### Sprint 2: Módulo Entregas DDD (Prioridad: ALTA)

**Objetivo**: Migrar listado y detalle de albaranes, fix de importes IVA

**Tareas**:
1. [ ] `GetAlbaranesUseCase` — Listado con filtros (fecha, cliente, estado)
2. [ ] `GetAlbaranDetailUseCase` — Detalle con líneas CPC
3. [ ] `UpdateDeliveryStatusUseCase` — Actualizar estado de entrega
4. [ ] `Db2AlbaranRepository` — Queries optimizados para CPC, CAC
5. [ ] **Fix crítico**: `CPC.IMPORTEBRUTO` → `CPC.IMPORTETOTAL` (línea 206 entregas.js)
6. [ ] Fix: deduplicación de albaranes incluye código de cliente
7. [ ] Tests unitarios y de integración

**Criterio de Aceptación**:
- ✅ Importes totales coinciden con realidad (sin bug de IVA)
- ✅ No hay albaranes duplicados en listado
- ✅ Estados de entrega se persisten correctamente

---

### Sprint 3: Módulo Cobros DDD (Prioridad: MEDIA)

**Objetivo**: Migrar gestión de cobros, repartidores, formas de pago

**Tareas**:
1. [ ] `GetCobrosUseCase` — Listado de cobros pendientes/histórico
2. [ ] `CreateCobroUseCase` — Registrar cobro con forma de pago
3. [ ] `GetRepartidorUseCase` — Datos de repartidor con firmas
4. [ ] `Db2CobroRepository` — Queries para CAC, CPC, formas de pago
5. [ ] Migrar lógica de firmas legacy (CACFIRMAS)
6. [ ] Tests unitarios y de integración

---

### Sprint 4: Módulo Rutero DDD (Prioridad: MEDIA)

**Objetivo**: Migrar gestión de rutas, organización, KPIs

**Tareas**:
1. [ ] `GetRutaUseCase` — Obtener ruta por día (lunes-sábado)
2. [ ] `UpdateRutaUseCase` — Actualizar orden de clientes
3. [ ] `MoveClientsUseCase` — Mover clientes entre días con bloqueos
4. [ ] `GetKpisUseCase` — KPIs de ruta (visitas, pedidos, cobertura)
5. [ ] `Db2RutaRepository` — Queries para RUTERO_CONFIG, RUTERO_LOG
6. [ ] Tests unitarios y de integración

---

### Sprint 5: Migración de Routes Legacy (Prioridad: BAJA)

**Objetivo**: Eliminar dependencia de `backend/routes/` legacy

**Estrategia**:
1. Migrar módulo por módulo (auth → pedidos → entregas → cobros → rutero)
2. Mantener compatibilidad hacia atrás durante migración
3. Tests de regresión para cada endpoint migrado
4. Eliminar archivo legacy solo después de verificar migración

---

### Sprint 6: Frontend Flutter Riverpod (Prioridad: MEDIA)

**Objetivo**: Migrar todos los ChangeNotifiers a Riverpod AsyncNotifier

**Estrategia**:
1. Módulo por módulo (auth → pedidos → entregas → cobros → rutero)
2. Mantener compatibilidad durante migración
3. Eliminar ChangeNotifier solo después de verificar Riverpod

---

### Sprint 7: Storage Unification (Prioridad: BAJA)

**Objetivo**: Unificar Hive + SharedPreferences en capa abstracta

**Entregables**:
- `StorageService` interface
- `HiveStorageAdapter` implementation
- `SharedPreferencesStorageAdapter` implementation
- Migración de datos existente

---

## 📈 Métricas de Progreso

| Fase | Progreso | Líneas Migradas | Líneas Totales | % Completado |
|------|----------|-----------------|----------------|--------------|
| **Fase 1: Cimientos DDD** | ✅ Completo | 850 | 850 | 100% |
| **Fase 2: Módulos DDD** | 🟡 En Progreso | 320 | 2,100 | 15% |
| **Fase 3: Migración Legacy** | ❌ No Iniciado | 0 | 6,300 | 0% |
| **Fase 4: Frontend Flutter** | ❌ No Iniciado | 0 | 1,720 | 0% |

**Total General**: 1,170 / 10,970 líneas (10.7% completado)

---

## 🚨 Riesgos y Dependencias

### Riesgos Técnicos

| Riesgo | Impacto | Probabilidad | Mitigación |
|--------|---------|--------------|------------|
| **DB2 connection inestable** | Alto | Media | Pool con keepalive + auto-recovery implementado |
| **Pérdida de datos en migración** | Crítico | Baja | Tests de regresión + rollback automático |
| **Regresión en funcionalidad legacy** | Alto | Media | Tests E2E antes de eliminar legacy |
| **Deuda técnica acumulada** | Medio | Alta | Sprints dedicados a refactorización |

### Dependencias Externas

| Dependencia | Estado | Impacto |
|-------------|--------|---------|
| **DB2 iSeries (GMP)** | ✅ Estable | Queries optimizados necesarios |
| **Redis cache** | ⚠️ No configurado en todos los entornos | Cache L2 no disponible en dev |
| **ODBC driver** | ✅ Funcional | Requiere keepalive cada 2 min |

---

## 📝 Decisiones Arquitectónicas

### Decisiones Tomadas

| Decisión | Fecha | Estado | Justificación |
|----------|-------|--------|---------------|
| **DDD como patrón principal** | Mar 2026 | ✅ Adoptado | Separación clara de responsabilidades, testeable |
| **Riverpod único para state** | Mar 2026 | ✅ Adoptado | Compile-safe, auto-dispose, sin BuildContext |
| **TypeScript para módulos nuevos** | Mar 2026 | ✅ Adoptado | Type-safety, mejor DX, menos errores runtime |
| **Cliente obligatorio para catálogo** | Mar 2026 | ✅ Adoptado | Precios/promos específicos por cliente |
| **Cache L1/L2 unificado** | Mar 2026 | ✅ Adoptado | Performance consistente, menos duplicación |

### Decisiones Pendientes

| Decisión | Prioridad | Impacto | Deadline |
|----------|-----------|---------|----------|
| **Estrategia de migración de rutas legacy** | Alta | Bloquea Sprint 5 | Q2 2026 |
| **Unificación de storage Flutter** | Media | Mejora mantenibilidad | Q2 2026 |
| **Testing framework para E2E** | Media | Calidad de regresión | Q2 2026 |

---

## 🔗 Referencias

- [ARQUITECTURA.md](./ARQUITECTURA.md) — Documentación técnica detallada
- [docs/archive/](./docs/archive/) — Documentación histórica preservada
- [Riverpod Documentation](https://riverpod.dev/)
- [DDD Starter Guide](https://github.com/ddd-by-examples/ddd-by-examples)

---

**Próxima revisión**: 8 de Abril de 2026  
**Responsable**: Equipo de Desarrollo GMP  
**Estado**: 🟡 En Migración Arquitectónica
