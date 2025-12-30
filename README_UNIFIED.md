# GMP App Unified - Aplicación de Movilidad Empresarial

## 📱 Descripción

Aplicación móvil empresarial unificada para **Granja Mari Pepa** que integra:
- Gestión de clientes y ruteros
- Histórico de ventas con gráficas avanzadas
- Sistema de cobros (Contado, Recibo, Transferencia, Pagaré, Presupuesto)
- Módulo de promociones simples y compuestas
- Visualización y descarga de fichas técnicas

## 🏗️ Arquitectura

```
Estructura del Proyecto:
├── gmp_app_unified/
│   ├── backend/              # API REST Node.js + Express + TypeScript
│   │   ├── src/
│   │   │   ├── config/       # Configuración (DB, env, Redis)
│   │   │   ├── controllers/  # Controladores HTTP
│   │   │   ├── middleware/   # Auth, validación, logging
│   │   │   ├── routes/       # Definición de rutas
│   │   │   ├── services/     # Lógica de negocio (ODBC a IBM i)
│   │   │   └── types/        # Definiciones TypeScript
│   │   └── package.json
│   │
│   └── CONFIGURACION.md      # Documentación de configuración
│
├── gmp_app_mobilidad/        # App Flutter (Clean Architecture)
│   ├── lib/
│   │   ├── core/             # Servicios core (DI, Network, Database)
│   │   │   ├── di/           # Inyección de dependencias (GetIt)
│   │   │   ├── network/      # Dio HTTP client + interceptors
│   │   │   ├── services/     # API Service, Sync Service
│   │   │   └── theme/        # Temas futuristas (dark/light)
│   │   │
│   │   ├── features/         # Módulos por funcionalidad
│   │   │   ├── authentication/
│   │   │   ├── dashboard/
│   │   │   ├── rutero/
│   │   │   ├── clientes/
│   │   │   ├── products/
│   │   │   ├── sales_history/
│   │   │   ├── promotions/
│   │   │   ├── pedidos/
│   │   │   └── estadisticas/
│   │   │
│   │   └── shared/           # Widgets y utils compartidos
│   │
│   ├── android/              # Configuración Android
│   ├── ios/                  # Configuración iOS
│   └── pubspec.yaml          # Dependencias Flutter
│
└── gmp_api_bridge/           # Bridge ODBC legacy (deprecated)
```

## 🔐 Seguridad

- **Autenticación**: JWT con access (15m) + refresh tokens (7d)
- **Contraseñas**: Hash bcrypt con 12 salt rounds
- **Protección brute force**: Bloqueo tras 5 intentos fallidos (30 min)
- **Validación**: express-validator para todos los inputs
- **Base de datos**: Consultas preparadas via ODBC
- **Almacenamiento seguro**: flutter_secure_storage para tokens

## 🚀 Inicio Rápido

### Backend (en gmp_app_unified/backend/)

```bash
cd gmp_app_unified/backend
npm install
cp .env.example .env
# Configurar variables ODBC_UID, ODBC_PWD, JWT secrets
npm run dev
```

El servidor arranca en `http://localhost:3001`

### Mobile Flutter (en gmp_app_mobilidad/)

```bash
cd gmp_app_mobilidad

# Obtener dependencias
flutter pub get

# Generar código (inyección de dependencias, freezed, etc.)
flutter pub run build_runner build --delete-conflicting-outputs

# Ejecutar en dispositivo conectado
flutter run

# O con variables de entorno personalizadas
flutter run --dart-define=API_BASE_URL=http://192.168.1.132:3001
```

### Configurar URL del Backend

En `gmp_app_mobilidad/lib/core/network/dio_client.dart`:
```dart
const String baseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://192.168.1.238:3001', // Tu IP local
);
```

## 📊 Características Principales

### Módulo de Autenticación (Flutter)
- Login con BLoC pattern
- Refresh tokens automáticos
- Biometría (huella, Face ID)
- Tema claro/oscuro

### Rutero Inteligente
- Mapa interactivo con Google Maps
- Filtro por día de semana
- Lista de clientes con distancia
- Estados: visitado, pendiente

### Histórico de Ventas
- Filtros por año, mes, semana
- Búsqueda por código/descripción
- Gráficas interactivas (fl_chart, syncfusion)
- Datos en € y unidades físicas

### Sistema de Cobros
- **Contado**: Pago inmediato en efectivo
- **Recibo**: Con número de recibo bancario
- **Transferencia**: Con número de operación
- **Pagaré**: Con fecha de vencimiento
- **Presupuesto**: Propuesta convertible a pedido

### Promociones
- Simples (descuentos directos)
- Compuestas (combos, packs)
- Control de vigencia
- Aplicación automática

## 🔧 Stack Tecnológico

### Backend
- Node.js 18+
- Express.js + TypeScript
- ODBC (IBM i / AS400)
- Redis (caching y sesiones)
- JWT + bcrypt

### Mobile (Flutter)
- Flutter 3.x / Dart 3.x
- flutter_bloc + provider (estado)
- GetIt + Injectable (DI)
- Dio (HTTP client)
- Drift (SQLite offline)
- fl_chart + syncfusion (gráficas)
- google_maps_flutter (mapas)

## 📝 Variables de Entorno

### Backend (.env)
```env
NODE_ENV=development
PORT=3001

# Base de datos IBM i
ODBC_UID=tu_usuario
ODBC_PWD=tu_password

# JWT Secrets (generados con: openssl rand -hex 32)
JWT_ACCESS_SECRET=tu-secret-de-32-chars-minimo
JWT_REFRESH_SECRET=tu-refresh-secret-de-32-chars

# Redis (opcional para caching)
REDIS_URL=redis://localhost:6379
```

### Flutter (dart-define)
```bash
# Ejecutar con configuración personalizada
flutter run \
  --dart-define=API_BASE_URL=http://192.168.1.132:3001 \
  --dart-define=ENABLE_LOGGING=true
```

## 📱 Ejecutar la App

### Requisitos
1. Flutter SDK 3.x instalado
2. Android Studio / Xcode configurado
3. Dispositivo Android/iOS conectado o emulador
4. Backend corriendo en red local

### Pasos
```bash
# 1. Verificar Flutter
flutter doctor

# 2. Ir al directorio de la app
cd gmp_app_mobilidad

# 3. Instalar dependencias
flutter pub get

# 4. Generar código
flutter pub run build_runner build

# 5. Ejecutar (dispositivo conectado)
flutter run
```

## 📄 Licencia

Propietario - Granja Mari Pepa © 2025
