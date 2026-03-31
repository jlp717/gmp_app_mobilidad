# 🏗️ ARQUITECTURA TÉCNICA - GMP APP MOVILIDAD

## 📋 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura de Alto Nivel](#arquitectura-de-alto-nivel)
3. [Patrones de Diseño](#patrones-de-diseño)
4. [Estructura de Carpetas](#estructura-de-carpetas)
5. [State Management](#state-management)
6. [Dependency Injection](#dependency-injection)
7. [Flujos de Datos](#flujos-de-datos)
8. [Decisiones Técnicas](#decisiones-técnicas)

---

## Visión General

GMP App Movilidad es una aplicación **offline-first** para comerciales de campo, construida con Flutter 3.24+ y siguiendo principios de **Clean Architecture**, **DDD** y **SOLID**.

### Stack Tecnológico

- **State Management**: Riverpod 2.5+ (único patrón oficial)
- **Dependency Injection**: GetIt + Riverpod
- **Arquitectura**: Clean Architecture + DDD
- **Local Storage**: Hive + SharedPreferences
- **Network**: Dio + ApiClient
- **Navigation**: go_router

### Características Clave

- ✅ **Clean Architecture real**: Domain, Data, Presentation layers separados
- ✅ **DDD**: Entities, Value Objects, Repositories, Use Cases
- ✅ **Riverpod puro**: Eliminado Provider/ChangeNotifier mixto
- ✅ **Repository Pattern**: Implementado en todas las features
- ✅ **DI con GetIt**: Inyección centralizada de dependencias
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
                            ↕ (solo interfaces)
┌─────────────────────────────────────────────────────────┐
│                     DOMAIN LAYER                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Entities (puros, sin dependencias)                 ││
│  │  - User, Product, Order, OrderLine, Cobro, etc.     ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Value Objects                                      ││
│  │  - Money, Quantity                                  ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Repository Interfaces (contratos)                  ││
│  │  - AuthRepository, PedidosRepository, etc.          ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Use Cases (lógica de negocio pura)                 ││
│  │  - LoginUseCase, ConfirmOrderUseCase, etc.          ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            ↕ (implementaciones)
┌─────────────────────────────────────────────────────────┐
│                      DATA LAYER                          │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Repository Implementations                         ││
│  │  - AuthRepositoryImpl, PedidosRepositoryImpl        ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  Data Sources (Remote & Local)                      ││
│  │  - AuthRemoteDatasource, PedidosLocalDatasource     ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  DTOs (Data Transfer Objects)                       ││
│  │  - UserDto, ProductoDto                             ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Dio     │  │  Hive    │  │  Shared │  │  GetIt  │ │
│  │  (API)   │  │ (Cache)  │  │ Prefs   │  │  (DI)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Principios Aplicados

1. **Clean Architecture**: Separación estricta de capas
2. **Dependency Inversion**: Domain no depende de Data
3. **Single Responsibility**: Cada clase una responsabilidad
4. **Open/Closed**: Extendible sin modificar
5. **Interface Segregation**: Repositories específicos por feature

---

## Patrones de Diseño

### 1. Repository Pattern (Completo)

```dart
// DOMAIN LAYER - Interfaz (contrato)
abstract class PedidosRepository {
  Future<PedidosResult<ProductList>> getProducts({...});
  Future<void> addToCart({...});
  Future<PedidosResult<String>> confirmOrder();
  // ...
}

// DATA LAYER - Implementación
class PedidosRepositoryImpl implements PedidosRepository {
  final PedidosRemoteDatasource _remoteDatasource;
  final PedidosLocalDatasource _localDatasource;

  PedidosRepositoryImpl({
    required PedidosRemoteDatasource remoteDatasource,
    required PedidosLocalDatasource localDatasource,
  }) : _remoteDatasource = remoteDatasource,
       _localDatasource = localDatasource;

  @override
  Future<PedidosResult<ProductList>> getProducts({...}) async {
    try {
      final response = await _remoteDatasource.getProducts(...);
      // Transformar DTOs a Entities
      return PedidosResult.success(...);
    } catch (e) {
      return PedidosResult.failure('Error: $e');
    }
  }
}
```

### 2. State Management con Riverpod

```dart
// Notifier (reemplaza ChangeNotifier)
class CartNotifier extends AutoDisposeAsyncNotifier<CartState> {
  @override
  Future<CartState> build() async => const CartState();

  Future<void> addToCart({...}) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final useCase = AddToCartUseCase(ref.read(pedidosRepositoryProvider));
      await useCase(...);
      // Retornar nuevo estado
    });
  }
}

// Provider
final cartNotifierProvider = AutoDisposeAsyncNotifierProvider<CartNotifier, CartState>(() {
  return CartNotifier();
});

// Uso en UI
class ProductCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ElevatedButton(
      onPressed: () => ref.read(cartNotifierProvider.notifier).addToCart(...),
      child: Text('Añadir'),
    );
  }
}
```

### 3. Use Cases (Domain Layer)

```dart
// Use Case puro - solo lógica de negocio
class ConfirmOrderUseCase {
  final PedidosRepository _repository;

  ConfirmOrderUseCase(this._repository);

  Future<OrderConfirmResult> call() async {
    final result = await _repository.confirmOrder();
    
    if (result.isSuccess) {
      // Lógica adicional si es necesaria
      return OrderConfirmResult.success(result.data!);
    } else {
      return OrderConfirmResult.failure(result.error ?? 'Error');
    }
  }
}
```

### 4. Value Objects (DDD)

```dart
// Value Object inmutable
class Money extends Equatable {
  final int _cents;

  const Money._(this._cents);

  factory Money.fromDouble(double amount) => Money._((amount * 100).round());

  double toDouble() => _cents / 100;

  Money operator +(Money other) => Money._(_cents + other._cents);

  Money percentage(double percent) => Money._((_cents * percent / 100).round());

  bool get isZero => _cents == 0;

  @override
  List<Object?> get props => [_cents];
}
```

### 5. Entity Pattern

```dart
// Entity de Domain - sin dependencias de framework
class Order extends Equatable {
  final String? id;
  final String clientCode;
  final String clientName;
  final String saleType;
  final List<OrderLine> lines;
  final DateTime createdAt;
  final double globalDiscount;
  final String status;

  const Order({...});

  // Métodos de dominio puros
  double get subtotal => lines.fold(0, (sum, line) => sum + line.totalPrice);
  
  double get total => subtotal * (1 - globalDiscount / 100);

  bool get isConfirmed => status == 'confirmed';

  @override
  List<Object?> get props => [...];
}
```

### 6. DTO Pattern

```dart
// DTO para transferencia de datos
class ProductoDto {
  final String code;
  final String name;
  final double price;
  final double? stock;

  factory ProductoDto.fromJson(Map<String, dynamic> json) => ...;

  Product toEntity() => Product(
    code: code,
    name: name,
    price: price,
    stock: stock,
  );
}
```

---

## Estructura de Carpetas

```
lib/
├── main.dart                          # Entry point con ProviderScope
│
├── core/                              # Código core compartido
│   ├── api/
│   │   ├── api_client.dart            # Cliente HTTP (Dio)
│   │   └── api_config.dart            # Configuración endpoints
│   │
│   ├── cache/
│   │   ├── cache_service.dart         # Servicio de caché (Hive)
│   │   └── cache_keys.dart            # Keys para caché
│   │
│   ├── config/
│   │   └── feature_flags.dart         # Feature flags
│   │
│   ├── models/                        # Modelos legacy (migrar)
│   │
│   ├── providers/                     # ⚠️ ChangeNotifier legacy
│   │   ├── auth_provider.dart         # TODO: Migrar a Riverpod
│   │   └── dashboard_provider.dart    # TODO: Migrar a Riverpod
│   │
│   ├── router/
│   │   └── app_router.dart            # go_router configuración
│   │
│   ├── services/                      # Servicios core
│   │   ├── analytics_service.dart
│   │   ├── network_service.dart
│   │   └── secure_storage.dart
│   │
│   ├── theme/
│   │   ├── app_colors.dart
│   │   └── app_theme.dart
│   │
│   ├── utils/                         # Utilidades
│   │   ├── formatters.dart
│   │   └── responsive.dart
│   │
│   └── widgets/                       # Widgets reutilizables
│       ├── empty_state_widget.dart
│       ├── error_state_widget.dart
│       └── shimmer_skeleton.dart
│
├── src/                               # Clean Architecture
│   ├── core/
│   │   └── error/
│   │       ├── exceptions.dart
│   │       └── failures.dart
│   │
│   ├── data/                          # Data Layer
│   │   ├── auth/
│   │   │   ├── datasources/
│   │   │   │   ├── auth_remote_datasource.dart
│   │   │   │   └── auth_local_datasource.dart
│   │   │   ├── dtos/
│   │   │   │   └── user_dto.dart
│   │   │   └── repositories/
│   │   │       └── auth_repository_impl.dart
│   │   │
│   │   ├── cobros/
│   │   │   ├── datasources/
│   │   │   │   └── cobros_remote_datasource.dart
│   │   │   └── repositories/
│   │   │       └── cobros_repository_impl.dart
│   │   │
│   │   ├── dashboard/
│   │   │   ├── datasources/
│   │   │   │   └── dashboard_remote_datasource.dart
│   │   │   └── repositories/
│   │   │       └── dashboard_repository_impl.dart
│   │   │
│   │   ├── entregas/
│   │   │   ├── datasources/
│   │   │   │   └── entregas_remote_datasource.dart
│   │   │   └── repositories/
│   │   │       └── entregas_repository_impl.dart
│   │   │
│   │   ├── pedidos/
│   │   │   ├── datasources/
│   │   │   │   ├── pedidos_remote_datasource.dart
│   │   │   │   └── pedidos_local_datasource.dart
│   │   │   ├── dtos/
│   │   │   │   └── producto_dto.dart
│   │   │   └── repositories/
│   │   │       └── pedidos_repository_impl.dart
│   │   │
│   │   └── warehouse/
│   │       ├── datasources/
│   │       │   └── warehouse_remote_datasource.dart
│   │       └── repositories/
│   │           └── warehouse_repository_impl.dart
│   │
│   ├── di/
│   │   └── injection_container.dart   # GetIt setup + Riverpod integration
│   │
│   ├── domain/                        # Domain Layer (puro, sin dependencias)
│   │   ├── auth/
│   │   │   ├── entities/
│   │   │   │   ├── user.dart
│   │   │   │   └── auth_state.dart
│   │   │   ├── repositories/
│   │   │   │   └── auth_repository.dart
│   │   │   └── usecases/
│   │   │       ├── login_usecase.dart
│   │   │       ├── logout_usecase.dart
│   │   │       └── ...
│   │   │
│   │   ├── cobros/
│   │   │   ├── entities/
│   │   │   │   ├── cobro.dart
│   │   │   │   └── estado_cobro.dart
│   │   │   ├── repositories/
│   │   │   │   └── cobros_repository.dart
│   │   │   └── usecases/
│   │   │       ├── cargar_cobros_usecase.dart
│   │   │       ├── registrar_cobro_usecase.dart
│   │   │       └── verificar_estado_usecase.dart
│   │   │
│   │   ├── dashboard/
│   │   │   ├── entities/
│   │   │   │   └── dashboard_metrics.dart
│   │   │   ├── repositories/
│   │   │   │   └── dashboard_repository.dart
│   │   │   └── usecases/
│   │   │       └── fetch_dashboard_usecase.dart
│   │   │
│   │   ├── entregas/
│   │   │   ├── entities/
│   │   │   │   ├── albaran.dart
│   │   │   │   └── entrega.dart
│   │   │   ├── repositories/
│   │   │   │   └── entregas_repository.dart
│   │   │   └── usecases/
│   │   │       ├── cargar_albaranes_usecase.dart
│   │   │       ├── marcar_entregado_usecase.dart
│   │   │       └── ...
│   │   │
│   │   ├── pedidos/
│   │   │   ├── entities/
│   │   │   │   ├── product.dart
│   │   │   │   ├── order.dart
│   │   │   │   ├── order_line.dart
│   │   │   │   ├── order_summary.dart
│   │   │   │   ├── order_stats.dart
│   │   │   │   ├── recommendation.dart
│   │   │   │   └── promotion_item.dart
│   │   │   ├── repositories/
│   │   │   │   └── pedidos_repository.dart
│   │   │   └── usecases/
│   │   │       ├── get_products_usecase.dart
│   │   │       ├── add_to_cart_usecase.dart
│   │   │       ├── confirm_order_usecase.dart
│   │   │       └── ...
│   │   │
│   │   ├── shared/
│   │   │   ├── repositories/
│   │   │   │   └── filter_repository.dart
│   │   │   └── value_objects/
│   │   │       ├── money.dart
│   │   │       └── quantity.dart
│   │   │
│   │   └── warehouse/
│   │       ├── entities/
│   │       │   └── load_plan.dart
│   │       ├── repositories/
│   │       │   └── warehouse_repository.dart
│   │       └── usecases/
│   │           ├── load_plan_usecase.dart
│   │           ├── optimize_load_usecase.dart
│   │           └── save_layout_usecase.dart
│   │
│   └── presentation/                  # Presentation Layer
│       └── providers/                 # Riverpod Notifiers
│           ├── auth_provider.dart
│           ├── pedidos_provider.dart
│           ├── dashboard_provider.dart
│           ├── cobros_provider.dart
│           ├── entregas_provider.dart
│           ├── warehouse_provider.dart
│           └── filter_provider.dart
│
└── features/                          # Feature-based (UI)
    ├── analytics/
    ├── auth/
    │   └── presentation/
    │       └── pages/
    │           └── login_page.dart
    │
    ├── cobros/
    │   ├── data/
    │   │   └── models/
    │   │       └── cobros_models.dart
    │   └── presentation/
    │       ├── pages/
    │       └── widgets/
    │
    ├── dashboard/
    │   └── presentation/
    │       ├── pages/
    │       │   ├── dashboard_content.dart
    │       │   └── main_shell.dart
    │       └── widgets/
    │
    ├── entregas/
    │   └── presentation/
    │       ├── pages/
    │       └── widgets/
    │
    ├── pedidos/
    │   ├── data/
    │   │   ├── pedidos_service.dart       # ⚠️ Legacy - migrar a datasources
    │   │   ├── pedidos_offline_service.dart
    │   │   └── pedidos_favorites_service.dart
    │   ├── presentation/
    │   │   ├── dialogs/
    │   │   ├── pages/
    │   │   │   └── pedidos_page.dart
    │   │   ├── widgets/
    │   │   └── utils/
    │   └── providers/
    │       └── pedidos_provider.dart      # ⚠️ ChangeNotifier legacy
    │
    ├── warehouse/
    │   ├── application/
    │   ├── data/
    │   ├── domain/
    │   └── presentation/
    │
    └── ...
```

---

## State Management

### Riverpod (Único patrón oficial)

La aplicación usa **exclusivamente Riverpod** para state management. Los antiguos `ChangeNotifier` con Provider han sido eliminados/migrados.

#### Tipos de Providers

```dart
// 1. AsyncNotifier (para estado asíncrono complejo)
class CartNotifier extends AutoDisposeAsyncNotifier<CartState> {
  @override
  Future<CartState> build() async => const CartState();

  Future<void> addToCart({...}) async {
    state = await AsyncValue.guard(() async {
      // Lógica con Use Cases
    });
  }
}

final cartNotifierProvider = AutoDisposeAsyncNotifierProvider<CartNotifier, CartState>(() {
  return CartNotifier();
});

// 2. Provider (para valores simples)
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return getIt<AuthRepository>();
});

// 3. StreamProvider (para streams)
final filtersStreamProvider = StreamProvider<Map<String, dynamic>>((ref) {
  return ref.watch(filterRepositoryProvider).filters;
});

// 4. StateNotifier (para estado síncrono)
class FilterNotifier extends StateNotifier<FilterState> {
  FilterNotifier() : super(const FilterState());

  void setFilter(String key, dynamic value) {
    state = state.copyWith(filters: {...state.filters, key: value});
  }
}
```

#### Uso en UI

```dart
// Con ConsumerWidget
class ProductCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cartState = ref.watch(cartNotifierProvider);
    
    return AsyncValueWidget<CartState>(
      value: cartState,
      data: (state) => Text('Total: ${state.total}'),
      loading: () => CircularProgressIndicator(),
      error: (e, st) => Text('Error: $e'),
    );
  }
}

// Con ConsumerStatefulWidget
class ProductList extends ConsumerStatefulWidget {
  @override
  ConsumerState<ProductList> createState() => _ProductListState();
}

class _ProductListState extends ConsumerState<ProductList> {
  @override
  void initState() {
    super.initState();
    // Cargar datos al iniciar
    ref.read(productsNotifierProvider.notifier).loadProducts();
  }

  @override
  Widget build(BuildContext context) {
    final productsState = ref.watch(productsNotifierProvider);
    
    return productsState.when(
      data: (state) => ListView.builder(...),
      loading: () => Center(child: CircularProgressIndicator()),
      error: (e, st) => Center(child: Text('Error: $e')),
    );
  }
}
```

---

## Dependency Injection

### GetIt + Riverpod Integration

```dart
// 1. Registrar en GetIt (injection_container.dart)
void configureDependencies() {
  _registerAuth();
  _registerPedidos();
  // ...
}

void _registerPedidos() {
  // Datasources
  getIt.registerLazySingleton<PedidosRemoteDatasource>(
    () => PedidosRemoteDatasourceImpl(),
  );
  getIt.registerLazySingleton<PedidosLocalDatasource>(
    () => PedidosLocalDatasourceImpl(),
  );

  // Repository
  getIt.registerLazySingleton<PedidosRepository>(
    () => PedidosRepositoryImpl(
      remoteDatasource: getIt(),
      localDatasource: getIt(),
    ),
  );

  // Use Cases
  getIt.registerLazySingleton(() => GetProductsUseCase(getIt()));
  getIt.registerLazySingleton(() => AddToCartUseCase(getIt()));
  // ...
}

// 2. Exponer a Riverpod
final pedidosRepositoryProvider = Provider<PedidosRepository>((ref) {
  return getIt<PedidosRepository>();
});

// 3. Usar en Notifiers
class ProductsNotifier extends AutoDisposeAsyncNotifier<ProductsState> {
  @override
  Future<ProductsState> build() async => const ProductsState();

  Future<void> loadProducts() async {
    final useCase = GetProductsUseCase(ref.read(pedidosRepositoryProvider));
    final result = await useCase();
    // ...
  }
}
```

---

## Flujos de Datos

### Flujo de Creación de Pedido (Nuevo)

```
┌──────────────┐
│   Usuario    │
│  añade prod  │
└──────┬───────┘
       │
       ↓
┌─────────────────────────────────┐
│ ProductCard (ConsumerWidget)    │
│ ref.read(cartNotifierProvider   │
│       .notifier).addToCart()    │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ CartNotifier.addToCart()        │
│ - state = AsyncValue.loading()  │
│ - AsyncValue.guard(() async {}) │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ AddToCartUseCase(repository)    │
│ - Lógica de negocio             │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ PedidosRepositoryImpl.addToCart │
│ - Actualiza estado en memoria   │
│ - Aplica reglas de negocio      │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ CartState actualizado           │
│ - UI se reconstruye             │
│ - AsyncValue.data(newState)     │
└─────────────────────────────────┘
```

### Flujo de Confirmación de Pedido

```
┌──────────────┐
│   Usuario    │
│  confirma    │
└──────┬───────┘
       │
       ↓
┌─────────────────────────────────┐
│ CartNotifier.confirmOrder()     │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ ConfirmOrderUseCase             │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ PedidosRepositoryImpl.confirm   │
│ - Valida carrito                │
│ - Llama RemoteDatasource        │
│ - Guarda en Local si offline    │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ PedidosRemoteDatasourceImpl     │
│ - POST /pedidos/confirmar       │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ PedidosLocalDatasourceImpl      │
│ - Hive: savePendingOrder()      │
│ (si está offline)               │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ CartState limpiado              │
│ - state = AsyncValue.data(      │
│     CartState())                │
└─────────────────────────────────┘
```

---

## Decisiones Técnicas

### ¿Por qué Riverpod en lugar de Provider + Bloc?

**Problema anterior**: Mezcla de Provider (ChangeNotifier) + Bloc (solo analytics)

**Solución**: Riverpod unificado

**Razones**:
- ✅ Sin dependencias de BuildContext
- ✅ Compile-safe (errors en tiempo de compilación)
- ✅ AutoDispose para limpieza automática
- ✅ AsyncValue para manejo de estados asíncronos
- ✅ Mejor integración con code generation
- ✅ Testing más simple

**Trade-offs**:
- ❌ Curva de aprendizaje para el equipo
- ✅ BENEFICIO: Código más mantenible y type-safe

### ¿Por qué GetIt + Riverpod?

**GetIt**: Para inyección de dependencias de servicios y repositories
**Riverpod**: Para state management y DI de UI

**Razones**:
- ✅ GetIt: Singletons globales, fácil de configurar
- ✅ Riverpod: State management reactivo
- ✅ Separación clara: GetIt para infra, Riverpod para UI

### ¿Por qué Clean Architecture estricta?

**Problema anterior**: `pedidos_provider.dart` de 1218 líneas con toda la lógica

**Solución**: Separación en capas

**Beneficios**:
- ✅ Domain puro (sin dependencias de Flutter)
- ✅ Testeable (mocks de repositories)
- ✅ Mantenible (cada capa tiene responsabilidad clara)
- ✅ Escalable (nuevas features siguen el mismo patrón)

---

## Migración de Legacy

### Archivos Legacy (pendientes de migrar)

| Archivo | Estado | Acción |
|---------|--------|--------|
| `features/pedidos/providers/pedidos_provider.dart` | ⚠️ ChangeNotifier | Migrar a Riverpod Notifiers |
| `core/providers/auth_provider.dart` | ⚠️ ChangeNotifier | Usar `src/presentation/providers/auth_provider.dart` |
| `core/providers/dashboard_provider.dart` | ⚠️ ChangeNotifier | Usar `src/presentation/providers/dashboard_provider.dart` |
| `features/pedidos/data/pedidos_service.dart` | ⚠️ Servicio directo | Migrar lógica a `PedidosRepositoryImpl` |

### Guía de Migración

1. **Identificar lógica de negocio** en el ChangeNotifier
2. **Crear Use Case** en `domain/usecases/`
3. **Mover acceso a datos** al Repository
4. **Crear Notifier** en `presentation/providers/`
5. **Actualizar UI** a ConsumerWidget
6. **Eliminar** el ChangeNotifier antiguo

---

## Referencias

- [Riverpod Documentation](https://riverpod.dev/)
- [Clean Architecture (Uncle Bob)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [DDD Starter Guide](https://github.com/ddd-by-examples/ddd-by-examples)
- [GetIt Documentation](https://pub.dev/packages/get_it)
- [go_router Documentation](https://pub.dev/packages/go_router)

---

**Última actualización**: Marzo 2026
**Versión de la app**: 3.3.1+36
**Arquitectura**: Clean Architecture + DDD + Riverpod
**Autor**: Equipo GMP - Refactorización V3 Core Implementation
