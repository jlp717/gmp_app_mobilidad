# 🏗️ GMP MOVILIDAD - GUÍA DE IMPLEMENTACIÓN COMPLETA

## 📊 ESTADO DEL PROYECTO

### ✅ COMPLETADO (Infraestructura Core)

#### 1. Network Layer
- ✅ `network_info.dart` - Detección de conectividad offline-first
- ✅ `dio_client.dart` - Cliente HTTP con configuración enterprise
- ✅ `auth_interceptor.dart` - Inyección automática de tokens JWT
- ✅ `error_interceptor.dart` - Transformación de errores tipados
- ✅ `retry_interceptor.dart` - Retry automático con exponential backoff

#### 2. Database Layer (Drift + SQLite)
- ✅ `app_database.dart` - Configuración principal con migraciones
- ✅ **Tablas:**
  - `users_table.dart` - Usuarios autenticados
  - `clients_table.dart` - Clientes del rutero (completa)
  - `sales_table.dart` - Histórico de ventas con agregaciones
  - `products_table.dart` - Catálogo de productos
  - `documents_table.dart` - Vencimientos, cobros, pedidos
  - `sync_queue_table.dart` - Cola de sincronización offline-first
- ✅ **DAOs:**
  - `user_dao.dart` - Operaciones de usuarios
  - `client_dao.dart` - Operaciones de clientes (filtros, búsqueda)
  - `sales_dao.dart` - Operaciones de ventas (agregaciones, resúmenes)
  - `product_dao.dart` - Operaciones de productos
  - `document_dao.dart` - Operaciones de documentos
  - `sync_dao.dart` - Gestión de cola de sincronización

### 🔨 EN PROGRESO

Continuaré implementando en este orden:

1. **Theme & Constants** - Sistema de diseño Material 3
2. **Shared Widgets** - Componentes reutilizables
3. **Data Layer Features** - Models, DataSources, Repositories
4. **Login Module** - Mejorado con últim acceso y biometría
5. **Dashboard Module** - Pantalla principal con métricas
6. **Rutero Module** - Listado de clientes con filtros
7. **Client Detail Module** - Detalle completo con Google Maps
8. **Sales History Module** - Gráficas comparativas
9. **Tests** - Unitarios, Widgets, Integración

---

## 🚀 INSTALACIÓN Y SETUP

### Prerrequisitos

```bash
# Verificar versiones
flutter --version  # >= 3.0.0
dart --version     # >= 3.0.0

# Android SDK (para emulador)
# Android Studio instalado
# Android SDK API Level 21+
```

### Paso 1: Clonar e Instalar Dependencias

```bash
cd C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad

# Instalar dependencias
flutter pub get
```

### Paso 2: Generar Código (Drift, Injectable, Freezed)

```bash
# Generar código de base de datos, inyección de dependencias y modelos
flutter pub run build_runner build --delete-conflicting-outputs

# Si hay errores, usar watch mode para regenerar automáticamente
flutter pub run build_runner watch --delete-conflicting-outputs
```

**IMPORTANTE:** Este comando generará:
- `app_database.g.dart`
- `*_dao.g.dart` (para todos los DAOs)
- `injection_container.config.dart`
- Archivos `*.freezed.dart` y `*.g.dart` para modelos

### Paso 3: Configurar Emulador Android

#### Opción A: Android Studio

1. Abrir Android Studio
2. Tools → Device Manager
3. Create Device → Seleccionar "Pixel 7" (recomendado para tablet)
4. Seleccionar API Level 33 (Android 13)
5. Finish → Start emulator

#### Opción B: Línea de Comandos

```bash
# Listar emuladores disponibles
flutter emulators

# Crear emulador si no existe
flutter emulators --create --name gmp_tablet

# Iniciar emulador
flutter emulators --launch gmp_tablet
```

### Paso 4: Ejecutar la Aplicación

```bash
# Verificar que el dispositivo está conectado
flutter devices

# Ejecutar en modo debug (con hot reload)
flutter run

# Ejecutar en modo release (optimizado)
flutter run --release

# Ejecutar en dispositivo específico
flutter run -d <device_id>
```

---

## 🏗️ ARQUITECTURA DEL PROYECTO

### Estructura de Carpetas

```
lib/
├── core/                           # Infraestructura compartida
│   ├── network/                    # ✅ Conectividad y HTTP
│   │   ├── network_info.dart
│   │   ├── dio_client.dart
│   │   └── interceptors/
│   │       ├── auth_interceptor.dart
│   │       ├── error_interceptor.dart
│   │       └── retry_interceptor.dart
│   ├── database/                   # ✅ SQLite + Drift
│   │   ├── app_database.dart
│   │   ├── tables/                 # Definiciones de tablas
│   │   └── daos/                   # Data Access Objects
│   ├── di/                         # Dependency Injection
│   │   └── injection_container.dart
│   ├── error/                      # Manejo de errores
│   │   └── failures.dart
│   ├── theme/                      # 🔨 Sistema de diseño
│   ├── constants/                  # 🔨 Constantes globales
│   └── utils/                      # 🔨 Utilidades
├── features/                       # Módulos por funcionalidad
│   ├── authentication/             # ✅ Login/Logout (existente)
│   │   ├── domain/
│   │   ├── data/                   # 🔨 Implementar
│   │   └── presentation/
│   ├── dashboard/                  # 🔨 Pantalla principal
│   ├── rutero/                     # 🔨 Listado de clientes
│   ├── client_detail/              # 🔨 Detalle de cliente
│   └── sales_history/              # 🔨 Histórico con gráficas
└── shared/                         # Componentes compartidos
    ├── widgets/                    # 🔨 Widgets reutilizables
    └── utils/                      # 🔨 Helpers
```

### Capas de Clean Architecture

```
┌─────────────────────────────────────────────────────────┐
│ PRESENTATION LAYER (UI + BLoC/Cubit)                    │
│ - Widgets (pages, components)                           │
│ - BLoC/Cubit (state management)                         │
│ - States (inmutables, sealed classes)                   │
└─────────────────────────────────────────────────────────┘
                        ↓ Events/Methods
┌─────────────────────────────────────────────────────────┐
│ DOMAIN LAYER (Lógica de Negocio)                        │
│ - Entities (objetos de negocio puros)                   │
│ - Use Cases (casos de uso específicos)                  │
│ - Repository Contracts (interfaces abstractas)          │
└─────────────────────────────────────────────────────────┘
                        ↓ Abstraction
┌─────────────────────────────────────────────────────────┐
│ DATA LAYER (Implementación)                             │
│ - Models (serialización JSON, Drift)                    │
│ - Data Sources (Remote API, Local DB)                   │
│ - Repository Implementations                            │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 COMANDOS ÚTILES

### Desarrollo

```bash
# Hot reload automático
flutter run

# Limpiar build
flutter clean && flutter pub get

# Analizar código
flutter analyze

# Formatear código
dart format lib/ -l 80

# Ver logs detallados
flutter run -v
```

### Code Generation

```bash
# Generar código una vez
flutter pub run build_runner build --delete-conflicting-outputs

# Watch mode (regenera automáticamente)
flutter pub run build_runner watch

# Limpiar archivos generados
flutter pub run build_runner clean
```

### Testing

```bash
# Todos los tests
flutter test

# Tests con cobertura
flutter test --coverage

# Test específico
flutter test test/features/authentication/domain/usecases/login_user_test.dart

# Ver cobertura en HTML
genhtml coverage/lcov.info -o coverage/html
```

### Build Production

```bash
# APK (para distribución directa)
flutter build apk --release

# App Bundle (para Google Play Store)
flutter build appbundle --release

# Ver tamaño del build
flutter build apk --analyze-size
```

---

## 🎨 CONVENCIONES DE CÓDIGO

### Naming Conventions

```dart
// Clases: PascalCase
class UserRepository {}

// Variables y métodos: camelCase
final userName = 'John';
void getUserData() {}

// Constantes: lowerCamelCase
const primaryColor = Color(0xFF1976D2);

// Archivos: snake_case
user_repository.dart
auth_interceptor.dart

// Prefijos privados: underscore
class _PrivateClass {}
final _privateVariable = 0;
```

### Comentarios Documentación

```dart
/// [ClassName] - Descripción breve
///
/// PROPÓSITO:
/// - Explicación detallada
/// - Responsabilidades
///
/// EJEMPLO:
/// ```dart
/// final instance = ClassName();
/// ```
class ClassName {}
```

---

## 📱 DATOS DUMMY PARA TESTING

Los datos de ejemplo se cargarán automáticamente en la primera ejecución:

### Usuario Demo
- **Email:** demo@gmp.com
- **Password:** Demo123!

### Clientes de Ejemplo
- 10 clientes con diferentes estados (verde/rojo)
- Distribuidos en diferentes días de visita
- Con coordenadas GPS para testing de maps

### Ventas de Ejemplo
- Últimos 3 meses de ventas
- Distribuidas por semanas para gráficas
- Diferentes productos y clientes

---

## 🐛 TROUBLESHOOTING

### Error: "No suitable constructor found for type 'AppDatabase'"

**Solución:**
```bash
flutter pub run build_runner clean
flutter pub run build_runner build --delete-conflicting-outputs
```

### Error: "MissingPluginException"

**Solución:**
```bash
flutter clean
flutter pub get
# Reiniciar el emulador
flutter run
```

### Error: "Cannot resolve symbol Dio"

**Solución:**
```bash
flutter pub get
# Reiniciar IDE
# File → Invalidate Caches / Restart (Android Studio)
```

### Base de datos corrupta

**Solución:**
```bash
# Desinstalar app del emulador
flutter clean
flutter run
```

---

## 📚 PRÓXIMOS PASOS

Continuaré implementando en este orden:

1. ✅ Infraestructura Core (Network + Database) - **COMPLETADO**
2. 🔄 Theme & Design System
3. 🔄 Shared Widgets
4. 🔄 Data Layer completa (Models, DataSources, Repositories)
5. 🔄 Login mejorado (biometría, último acceso)
6. 🔄 Dashboard con métricas reales
7. 🔄 Rutero con filtros y búsqueda
8. 🔄 Detalle de cliente con Google Maps
9. 🔄 Histórico de ventas con gráficas
10. 🔄 Tests completos

---

## 📞 SOPORTE

Para cualquier duda o problema durante la implementación, revisa:
- Logs de Flutter: `flutter logs`
- Errores de compilación: `flutter analyze`
- Documentación de Drift: https://drift.simonbinder.eu/
- Documentación de BLoC: https://bloclibrary.dev/

**Estado actual:** Infraestructura base lista ✅ | Continuando con Features 🔄
