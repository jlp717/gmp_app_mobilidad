# 🚀 Comandos de Ejecución - GMP Movilidad App

## 📋 Pre-requisitos

1. **Flutter SDK** instalado (versión 3.0+)
2. **Android Studio** o **VS Code** con extensiones de Flutter/Dart
3. **Emulador Android** configurado o dispositivo físico conectado

## 🔧 Paso 1: Instalar Dependencias

```bash
flutter pub get
```

## 🏗️ Paso 2: Generar Código (build_runner)

Este paso es **CRÍTICO** - genera código para Drift, Injectable, y Freezed:

```bash
flutter pub run build_runner build --delete-conflicting-outputs
```

**Nota:** Si hay errores, ejecuta:
```bash
flutter clean
flutter pub get
flutter pub run build_runner build --delete-conflicting-outputs
```

## ✅ Paso 3: Verificar la Configuración

```bash
flutter doctor
```

Asegúrate de que todo esté marcado con ✓ (especialmente Android toolchain y dispositivos conectados).

## 📱 Paso 4: Listar Dispositivos Disponibles

```bash
flutter devices
```

Deberías ver tu emulador Android o dispositivo físico listado.

## ▶️ Paso 5: Ejecutar la Aplicación

### Opción A: Ejecutar en Emulador/Dispositivo

```bash
flutter run
```

### Opción B: Ejecutar en modo debug con hot reload

```bash
flutter run --debug
```

### Opción C: Ejecutar en modo release (más rápido)

```bash
flutter run --release
```

### Opción D: Especificar dispositivo específico

```bash
flutter run -d <device-id>
```

Ejemplo:
```bash
flutter run -d emulator-5554
```

## 🧪 Credenciales de Prueba

La aplicación viene con datos **DUMMY** pre-cargados:

### Usuario Demo:
- **Email:** demo@gmp.com
- **Contraseña:** Demo123!

**Importante:** En el primer arranque, la app generará automáticamente:
- 10 clientes con datos realistas
- 3 meses de historial de ventas
- Documentos (vencimientos, cobros, pedidos)
- Productos de ejemplo

## 📊 Datos Generados Automáticamente

Al iniciar por primera vez, verás en la consola:
```
🌱 Primera ejecución - Generando datos dummy...
✅ Datos dummy cargados correctamente
```

### Clientes de ejemplo (Rutero):
- FRUTERIA ANTONIO (con ventas recientes - verde)
- SUPERMERCADO LOPEZ (sin ventas recientes - rojo)
- BAR MANOLO (con coordenadas GPS)
- PANADERIA GARCIA (zona Murcia)
- ... y 6 más

### Dashboard mostrará:
- **Vencimientos:** ~398 pendientes, ~156,591.09 €
- **Cobros:** 0 realizados
- **Pedidos:** ~33 pendientes, ~2,613.77 €
- **Gráfica de ventas:** Últimos 7 días con datos

## 🛠️ Comandos Útiles

### Limpiar build cache
```bash
flutter clean
```

### Actualizar dependencias
```bash
flutter pub upgrade
```

### Analizar código
```bash
flutter analyze
```

### Formatear código
```bash
flutter format .
```

### Ver logs en tiempo real
```bash
flutter logs
```

### Regenerar código (cuando cambies anotaciones)
```bash
flutter pub run build_runner watch
```

## 🐛 Solución de Problemas Comunes

### Error: "No se pudo encontrar AppDatabase"
**Solución:** Ejecutar build_runner
```bash
flutter pub run build_runner build --delete-conflicting-outputs
```

### Error: "GetIt no está configurado"
**Solución:** Asegúrate de que injection_container.config.dart se generó correctamente

### Error: "Dependencias no encontradas"
**Solución:**
```bash
flutter clean
flutter pub get
flutter pub run build_runner build --delete-conflicting-outputs
```

### La app se queda en pantalla de splash
**Solución:** Revisa los logs con `flutter logs` - probablemente hay un error en la inicialización de la DB

### No aparecen datos en el Dashboard
**Solución:** Verifica la consola para el mensaje de "Datos dummy cargados correctamente"

## 📂 Estructura de Base de Datos

La aplicación usa **Drift** (SQLite) con las siguientes tablas:

- `users_table` - Usuarios del sistema
- `clients_table` - Clientes del rutero
- `sales_table` - Histórico de ventas
- `products_table` - Catálogo de productos
- `documents_table` - Vencimientos, cobros, pedidos
- `sync_queue_table` - Cola de sincronización (Fase 2)

**Ubicación de la DB:**
- Android: `/data/data/com.example.gmp_app_mobilidad/databases/app_database.db`
- iOS: `Library/Application Support/app_database.db`

## 🔄 Reiniciar Datos Dummy

Si quieres reiniciar los datos:

1. **Desinstalar la app del emulador:**
```bash
flutter clean
```

2. **Reinstalar:**
```bash
flutter run
```

La app detectará que no hay datos y volverá a generarlos automáticamente.

## 📱 Navegación en la App

### Flujo Principal:
1. **Pantalla de Login** → Ingresa credenciales demo
2. **Dashboard** → Ver métricas principales
   - Vencimientos (tarjeta naranja)
   - Cobros (tarjeta verde)
   - Pedidos (tarjeta azul)
   - Gráfica de ventas últimos 7 días
3. **Rutero** → (Acceso rápido desde Dashboard)
   - Lista de clientes con color coding
   - Filtros por día de visita/reparto
   - Búsqueda por nombre
4. **Detalle de Cliente** → Tap en cliente del rutero
   - Información completa
   - Botón de mapa (si tiene coordenadas)
5. **Histórico de Ventas** → (Acceso rápido desde Dashboard)
   - Gráficas comparativas
   - Filtros por semana/mes/año

## 🎨 Temas y Personalización

La app usa **Material 3** (Material You) con:
- **Primary Color:** Blue (#1976D2)
- **Success Color:** Green (#4CAF50)
- **Error Color:** Red (#E53935)
- **Warning Color:** Orange (#FF9800)

## 💾 Modo Offline

La aplicación funciona completamente **OFFLINE-FIRST**:
- Todos los datos se almacenan localmente
- Sin conexión a internet necesaria para esta versión
- Los datos persisten entre reinicios
- Pull-to-refresh simula sincronización

## 🚧 Funcionalidades Implementadas

### ✅ Completamente Funcional:
- Sistema de autenticación (login/logout)
- Dashboard con métricas en tiempo real
- Gráfica de ventas y unidades (fl_chart)
- Arquitectura Clean + BLoC
- Base de datos offline (Drift/SQLite)
- Dependency Injection (get_it + injectable)
- Material 3 theme completo

### 🔄 Próximamente (implementación en progreso):
- Rutero con filtros avanzados
- Detalle de cliente con Google Maps
- Histórico de ventas comparativo
- Sincronización con backend (Fase 2)

## 📞 Soporte

Si encuentras errores durante la ejecución:

1. Verifica los logs: `flutter logs`
2. Limpia y reconstruye: `flutter clean && flutter pub get && flutter run`
3. Asegúrate de que build_runner se ejecutó correctamente

## 🎯 Próximos Pasos

1. Ejecuta `flutter run`
2. Espera a que compile (primera vez puede tardar 2-3 minutos)
3. Ingresa con: **demo@gmp.com** / **Demo123!**
4. Explora el Dashboard con datos dummy
5. Prueba pull-to-refresh
6. Navega por las tarjetas de métricas

¡Listo para ejecutar! 🚀
