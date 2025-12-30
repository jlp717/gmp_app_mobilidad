# 🚀 GUÍA DE CONFIGURACIÓN - GMP App Unified

## 📋 Estructura del Proyecto

```
📂 Repositorios/
├── 📂 gmp_app_unified/
│   └── 📂 backend/          ← API REST (Node.js + TypeScript + ODBC)
│
└── 📂 gmp_app_mobilidad/    ← App Flutter (Clean Architecture)
```

---

## 🔧 PASO 1: Configurar el Backend

### Requisitos Previos
- **Node.js 18+** (LTS recomendado)
- **npm 9+**
- **Driver ODBC IBM i Access** configurado en Windows
- Redis (opcional, para caching)

### 1.1 Instalar Dependencias

```powershell
cd gmp_app_unified\backend
npm install
```

### 1.2 Crear Archivo de Variables de Entorno

Crear archivo `.env` en `gmp_app_unified/backend/`:

```env
# Entorno
NODE_ENV=development
PORT=3001

# Base de datos IBM i (ODBC)
ODBC_UID=tu_usuario_ibm_i
ODBC_PWD=tu_password_ibm_i

# JWT Secrets (generar con: openssl rand -hex 32)
JWT_ACCESS_SECRET=tu-clave-secreta-minimo-32-caracteres-aqui
JWT_REFRESH_SECRET=otra-clave-secreta-diferente-para-refresh

# Expiración de tokens
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Redis (opcional)
REDIS_URL=redis://localhost:6379

# CORS - permitir cualquier origen en desarrollo
CORS_ORIGINS=*

# Logging
LOG_LEVEL=debug
```

### 1.3 Verificar DSN ODBC

El backend usa el DSN `GMP` configurado en Windows ODBC:

1. Abrir **Panel de Control** → **Herramientas administrativas**
2. Abrir **Orígenes de datos ODBC (64-bit)**
3. En pestaña **DSN de sistema**, verificar que existe `GMP` apuntando a `192.168.1.22`

### 1.4 Ejecutar el Backend

```powershell
cd gmp_app_unified\backend
npm run dev
```

✅ El servidor arranca en: `http://localhost:3001`

### 1.5 Verificar Funcionamiento

Abrir en navegador: `http://localhost:3001/health`

Respuesta esperada:
```json
{
  "status": "ok",
  "timestamp": "2025-01-XX...",
  "environment": "development"
}
```

---

## 📱 PASO 2: Configurar la App Flutter

### Requisitos Previos
- **Flutter SDK 3.x** instalado
- **Android Studio** con SDK configurado
- Dispositivo Android conectado por USB (con depuración USB activa)

### 2.1 Verificar Flutter

```powershell
flutter doctor
```

Debe mostrar ✓ en Flutter, Android toolchain, y Connected device.

### 2.2 Configurar URL del Backend

Editar `gmp_app_mobilidad\lib\core\network\dio_client.dart`:

```dart
const String baseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://TU_IP_LOCAL:3001', // ← Cambiar aquí
);
```

**Importante**: Usar tu IP local de red (ej: `192.168.1.132`), NO `localhost`

Para ver tu IP:
```powershell
ipconfig
# Buscar "Dirección IPv4" en tu adaptador de red
```

### 2.3 Instalar Dependencias

```powershell
cd gmp_app_mobilidad
flutter pub get
```

### 2.4 Generar Código (Inyección de Dependencias)

```powershell
flutter pub run build_runner build --delete-conflicting-outputs
```

Esto genera:
- `lib/core/di/injection_container.config.dart`
- Modelos freezed
- Adaptadores de base de datos

### 2.5 Ejecutar la App

Con dispositivo Android conectado:

```powershell
flutter run
```

O con URL personalizada:

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.1.238:3001
```

---

## 🔌 Endpoints de la API

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/health` | GET | Estado del servidor |
| `/api/auth/login` | POST | Login (email + password) |
| `/api/auth/refresh` | POST | Refrescar token |
| `/api/auth/me` | GET | Usuario actual |
| `/api/clientes` | GET | Lista de clientes |
| `/api/clientes/:codigo` | GET | Detalle de cliente |
| `/api/productos` | GET | Lista de productos |
| `/api/rutero` | GET | Rutero del día |
| `/api/rutero/semana` | GET | Rutero de la semana |
| `/api/ventas/historico` | GET | Histórico de ventas |
| `/api/ventas/estadisticas` | GET | Estadísticas para gráficas |
| `/api/cobros` | GET | Cobros pendientes |
| `/api/cobros/contado` | POST | Registrar cobro contado |
| `/api/cobros/recibo` | POST | Registrar cobro con recibo |
| `/api/cobros/transferencia` | POST | Registrar cobro transferencia |
| `/api/cobros/pagare` | POST | Registrar cobro pagaré |
| `/api/cobros/presupuesto` | POST | Crear presupuesto |
| `/api/promociones` | GET | Promociones activas |

---

## 🐛 Solución de Problemas

### Error: "ODBC connection failed"
1. Verificar que el DSN `GMP` existe en ODBC de 64-bit
2. Comprobar credenciales en `.env`
3. Verificar conectividad al servidor `192.168.1.22`

### Error: "Connection refused" desde Flutter
- Verificar que el backend está corriendo
- Usar IP local, no `localhost`
- Verificar que el firewall permite el puerto 3001

### Error: "flutter pub run build_runner build" falla
```powershell
flutter clean
flutter pub get
flutter pub run build_runner build --delete-conflicting-outputs
```

### La app no muestra datos
1. Verificar en el terminal del backend que recibe peticiones
2. Revisar que la URL en `dio_client.dart` es correcta
3. Verificar que el dispositivo y PC están en la misma red

---

## 📲 Comandos Útiles

### Backend
```powershell
# Desarrollo
npm run dev

# Producción
npm run build
npm start

# Linting
npm run lint
```

### Flutter
```powershell
# Ejecutar app
flutter run

# Hot reload (mientras corre)
r

# Hot restart
R

# Build APK
flutter build apk --release

# Limpiar proyecto
flutter clean
```

---

## 📞 Resumen Rápido

1. **Backend**:
   ```powershell
   cd gmp_app_unified\backend
   npm install
   # Crear .env con ODBC_UID y ODBC_PWD
   npm run dev
   ```

2. **Flutter**:
   ```powershell
   cd gmp_app_mobilidad
   flutter pub get
   flutter pub run build_runner build --delete-conflicting-outputs
   # Editar dio_client.dart con tu IP local
   flutter run
   ```

¡Listo! La app debería conectarse al backend y mostrar datos reales del IBM i.
