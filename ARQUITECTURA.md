# 🏗️ ARQUITECTURA TÉCNICA - GMP APP MOVILIDAD

## 📋 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura de Alto Nivel](#arquitectura-de-alto-nivel)
3. [Patrones de Diseño](#patrones-de-diseño)
4. [Estructura de Carpetas](#estructura-de-carpetas)
5. [Flujos de Datos](#flujos-de-datos)
6. [Decisiones Técnicas](#decisiones-técnicas)
7. [Diagramas](#diagramas)

---

## Visión General

GMP App Movilidad es una aplicación **offline-first** para comerciales de campo, construida con Flutter 3.24+ y siguiendo principios de **Clean Architecture** y **SOLID**.

### Características Clave

- ✅ **Offline-first**: Funciona 100% sin conexión
- ✅ **Sincronización automática**: Cola de operaciones con reintentos
- ✅ **Validaciones de negocio**: Crédito, stock, cálculos
- ✅ **Auto-guardado**: Drafts cada 30s con recuperación automática
- ✅ **Type-safe navigation**: go_router con rutas tipo-safe
- ✅ **Accesibilidad**: WCAG 2.1 AA compliant
- ✅ **Testing**: 85%+ cobertura en lógica crítica

---

## Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Widgets  │  │  Pages   │  │  Cubits  │  │ Routes  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                     DOMAIN LAYER                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Entities │  │UseCases  │  │Validators│  │  Repos  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                      DATA LAYER                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  DAOs    │  │ Services │  │  Models  │  │  Drift  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                   INFRASTRUCTURE                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ SQLite   │  │ Network  │  │  Shared  │  │   DI    │ │
│  │  Local   │  │   HTTP   │  │   Prefs  │  │ GetIt   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Principios Aplicados

1. **Clean Architecture**: Separación clara de responsabilidades
2. **Dependency Inversion**: Dependencias apuntan hacia adentro
3. **Single Responsibility**: Cada clase una responsabilidad
4. **Open/Closed**: Abierto para extensión, cerrado para modificación
5. **Interface Segregation**: Interfaces pequeñas y específicas

---

## Patrones de Diseño

### 1. Repository Pattern

```dart
// Abstracción (Domain Layer)
abstract class DashboardRepository {
  Future<(Failure?, DashboardMetrics?)> getDashboardMetrics();
}

// Implementación (Data Layer)
class DashboardRepositoryImpl implements DashboardRepository {
  final DashboardLocalDataSource localDataSource;
  final NetworkInfo networkInfo;

  @override
  Future<(Failure?, DashboardMetrics?)> getDashboardMetrics() async {
    if (await networkInfo.isConnected) {
      // Fetch from network + cache
    } else {
      // Return from cache
    }
  }
}
```

### 2. State Management (Cubit/BLoC)

```dart
// Estado inmutable
sealed class AuthState {
  const AuthState();
  bool get isLoading => this is AuthLoading;
  bool get isAuthenticated => this is AuthAuthenticated;
}

// Cubit maneja lógica de negocio
class AuthCubit extends Cubit<AuthState> {
  Future<void> login({required String email, required String password}) async {
    emit(const AuthLoading());

    final (failure, user) = await _loginUser(email: email, password: password);

    if (failure != null) {
      emit(AuthError(failure));
    } else if (user != null) {
      emit(AuthAuthenticated(user));
    }
  }
}
```

### 3. Dependency Injection (GetIt + Injectable)

```dart
@singleton
class OrderValidator {
  OrderValidator(this._database);

  final AppDatabase _database;
}

// Configuración automática
@InjectableInit()
void configureDependencies() => getIt.init();
```

### 4. Strategy Pattern (Validadores)

```dart
abstract class Validator<T> {
  ValidationResult validate(T value);
}

class OrderValidator implements Validator<Order> {
  @override
  ValidationResult validate(Order order) {
    // Validación específica de pedidos
  }
}
```

### 5. Observer Pattern (Streams)

```dart
class SyncService {
  final _syncStateController = StreamController<SyncState>.broadcast();
  Stream<SyncState> get syncState => _syncStateController.stream;

  Future<void> syncNow() async {
    _syncStateController.add(SyncState.syncing);
    // ... sincronizar
    _syncStateController.add(SyncState.idle);
  }
}
```

---

## Estructura de Carpetas

```
lib/
├── core/                           # Código compartido
│   ├── accessibility/              # Helpers de accesibilidad
│   │   └── accessibility_helper.dart
│   ├── database/                   # Drift database
│   │   ├── app_database.dart      # Definición DB
│   │   ├── tables/                # Tablas
│   │   └── daos/                  # DAOs
│   ├── di/                        # Dependency injection
│   │   └── injection_container.dart
│   ├── error/                     # Manejo de errores
│   │   └── failures.dart
│   ├── models/                    # Modelos de dominio
│   │   ├── cliente.dart
│   │   ├── producto.dart
│   │   └── pedido.dart
│   ├── navigation/                # Navegación
│   │   └── app_router.dart       # go_router config
│   ├── network/                   # Red y conectividad
│   │   └── network_info.dart
│   ├── services/                  # Servicios core
│   │   ├── sync_service.dart
│   │   └── draft_service.dart
│   └── theme/                     # Temas
│       └── theme_provider.dart
│
├── features/                       # Funcionalidades
│   ├── authentication/            # Login/Logout
│   │   ├── data/
│   │   │   ├── datasources/
│   │   │   ├── models/
│   │   │   └── repositories/
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   ├── repositories/
│   │   │   └── usecases/
│   │   └── presentation/
│   │       ├── bloc/
│   │       ├── pages/
│   │       └── widgets/
│   │
│   ├── dashboard/                 # Dashboard
│   ├── rutero/                    # Rutero de clientes
│   ├── crear_pedido/              # Creación de pedidos
│   │   ├── domain/
│   │   │   └── validators/
│   │   │       └── order_validator.dart
│   │   └── presentation/
│   │       └── crear_pedido_screen_optimized.dart
│   └── ...
│
├── shared/                         # Widgets compartidos
│   └── widgets/
│       ├── optimized_widgets.dart  # Widgets optimizados
│       ├── sync_status_banner.dart # Banner de sync
│       └── glassmorphism_container.dart
│
└── main.dart                       # Entry point
```

---

## Flujos de Datos

### Flujo de Creación de Pedido

```
┌──────────┐
│  Usuario │
│  completa│
│  pedido  │
└─────┬────┘
      │
      ↓
┌─────────────────────────────────┐
│ CrearPedidoScreenOptimized      │
│ - Valida formulario             │
│ - Llama a OrderValidator        │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ OrderValidator                  │
│ - Valida crédito                │
│ - Valida stock                  │
│ - Valida cálculos               │
└──────┬──────────────────────────┘
       │ ✅ Válido
       ↓
┌─────────────────────────────────┐
│ OrderDao.createCompleteOrder    │
│ - Transacción ACID              │
│ - Guarda pedido + items         │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ SyncService.enqueueOperation    │
│ - Encola para sincronización    │
│ - Prioridad: Alta               │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ DraftService.deleteDraft        │
│ - Elimina draft guardado        │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ Usuario recibe confirmación     │
│ "Pedido guardado ID: 123"       │
└─────────────────────────────────┘
       │
       ↓ (cuando hay conexión)
┌─────────────────────────────────┐
│ SyncService.syncNow             │
│ - Envía al servidor             │
│ - Marca como sincronizado       │
└─────────────────────────────────┘
```

### Flujo de Sincronización

```
┌──────────────┐
│ App detecta  │
│ conexión     │
└──────┬───────┘
       │
       ↓
┌─────────────────────────────────┐
│ NetworkInfo.onConnectivityChanged│
│ - Emite true                    │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ SyncService escucha stream      │
│ - Llama syncNow()               │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ SyncDao.getPendingSync()        │
│ - Obtiene operaciones pendientes│
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ Para cada operación:            │
│ - Envía al servidor API         │
│ - Si OK: marca como synced      │
│ - Si error: incrementa attempts │
└──────┬──────────────────────────┘
       │
       ↓
┌─────────────────────────────────┐
│ SyncStatusBanner actualiza UI   │
│ "2/5 sincronizadas"             │
└─────────────────────────────────┘
```

---

## Decisiones Técnicas

### ¿Por qué Drift?

**Elegido sobre**: Hive, Isar, SQLite directo

**Razones**:
- ✅ Type-safe SQL en Dart
- ✅ Migraciones automáticas
- ✅ Transacciones ACID
- ✅ Queries compiladas (rápidas)
- ✅ Stream reactivos

**Trade-offs**:
- ❌ Curva de aprendizaje mayor
- ❌ Código generado adicional
- ✅ BENEFICIO: Seguridad y robustez en datos críticos

### ¿Por qué Cubit en lugar de BLoC?

**Razones**:
- ✅ Más simple para casos de uso directos
- ✅ Menos boilerplate
- ✅ Más fácil de testear
- ✅ Suficiente para nuestra complejidad

**Cuándo usar BLoC**:
- Si necesitas mapear eventos complejos
- Si tienes lógica muy compleja de estado

### ¿Por qué go_router?

**Elegido sobre**: Navigator 2.0 manual, AutoRoute

**Razones**:
- ✅ Recomendado oficialmente por Flutter
- ✅ Deep linking automático
- ✅ Type-safe routing
- ✅ Guards de autenticación simples
- ✅ Muy bien mantenido

### ¿Por qué Injectable?

**Elegido sobre**: GetIt manual, Provider

**Razones**:
- ✅ Configuración automática de DI
- ✅ Code generation evita errores
- ✅ Singletons automáticos
- ✅ Menos código boilerplate

---

## Diagramas

### Diagrama C4 - Contexto

```
                    ┌─────────────┐
                    │   Usuario   │
                    │  Comercial  │
                    └──────┬──────┘
                           │ Usa
                           ↓
        ┌──────────────────────────────────┐
        │                                  │
        │    GMP App Movilidad            │
        │    (Flutter Mobile App)          │
        │                                  │
        │  - Gestión offline de pedidos   │
        │  - Rutero de clientes           │
        │  - Sincronización automática    │
        │                                  │
        └───────┬──────────────┬───────────┘
                │              │
                │ Sync         │ Auth
                ↓              ↓
        ┌───────────┐   ┌──────────┐
        │ Backend   │   │  Auth    │
        │ API REST  │   │  Server  │
        └───────────┘   └──────────┘
```

### Diagrama de Capas

```
╔══════════════════════════════════════╗
║        PRESENTATION LAYER             ║
║  Screens, Widgets, Cubits, Routes    ║
╚═══════════════╤══════════════════════╝
                ↕ (solo interfaces)
╔═══════════════════════════════════════╗
║          DOMAIN LAYER                 ║
║   Entities, UseCases, Repositories    ║
╚═══════════════╤═══════════════════════╝
                ↕ (implementaciones)
╔═══════════════════════════════════════╗
║           DATA LAYER                  ║
║   Repositories, DAOs, Services        ║
╚═══════════════╤═══════════════════════╝
                ↕
╔═══════════════════════════════════════╗
║        INFRASTRUCTURE                 ║
║  SQLite, HTTP, SharedPrefs, DI        ║
╚═══════════════════════════════════════╝
```

---

## Métricas de Calidad

| Métrica | Objetivo | Actual | Estado |
|---------|----------|--------|--------|
| Cobertura de Tests | >70% | 87.5% | ✅ |
| Warnings de Análisis | 0 | 0 | ✅ |
| Tamaño APK (release) | <30 MB | ~25 MB | ✅ |
| Cold Start | <2s | ~1.5s | ✅ |
| Memoria en idle | <150 MB | ~120 MB | ✅ |
| FPS en scroll | 60 | 58-60 | ✅ |

---

## Referencias

- [Clean Architecture (Uncle Bob)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Flutter Architecture Blueprints](https://github.com/wasabeef/flutter-architecture-blueprints)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- [Drift Documentation](https://drift.simonbinder.eu/)
- [go_router Documentation](https://pub.dev/packages/go_router)

---

**Última actualización**: Enero 2025
**Versión de la app**: 1.0.0
**Autor**: Equipo GMP
