# 🚀 COMANDOS PARA EJECUTAR LA APLICACIÓN

## ⚡ RÁPIDO - Copia y pega estos comandos en orden:

### 1️⃣ Instalar dependencias
```bash
flutter pub get
```

### 2️⃣ Generar código (IMPORTANTE - No saltar este paso)
```bash
flutter pub run build_runner build --delete-conflicting-outputs
```

### 3️⃣ Ejecutar en emulador/dispositivo
```bash
flutter run
```

---

## 🔐 CREDENCIALES DE PRUEBA

Una vez que la app esté corriendo:

**Email:** `demo@gmp.com`
**Contraseña:** `Demo123!`

O simplemente toca el botón **"Probar sin conexión"** en la pantalla de login.

---

## ✅ ¿QUÉ ESPERAR?

1. **Primera ejecución:** La app generará datos dummy automáticamente
   - Verás en consola: `🌱 Primera ejecución - Generando datos dummy...`
   - Luego: `✅ Datos dummy cargados correctamente`

2. **Después del login:** Verás el Dashboard con:
   - ✅ Vencimientos: 398 pendientes, 156,591.09 €
   - ✅ Cobros: 0 realizados
   - ✅ Pedidos: 33 pendientes, 2,613.77 €
   - ✅ Gráfica de ventas (últimos 7 días)

3. **Navegación disponible:**
   - 📊 Dashboard (pantalla actual)
   - 🚗 Rutero (tap en "Rutero" o navegación inferior)
   - 📈 Histórico de Ventas (tap en "Histórico")
   - 👤 Detalle de Cliente (tap en cualquier cliente del rutero)

---

## 🔧 SI HAY ERRORES

### Error: "No se encontró el archivo generado"
```bash
flutter clean
flutter pub get
flutter pub run build_runner build --delete-conflicting-outputs
flutter run
```

### Error: "GetIt no está configurado"
Asegúrate de ejecutar el paso 2 (build_runner)

### La app no compila
```bash
flutter doctor
```
Verifica que todo esté en verde (✓)

---

## 📱 FUNCIONALIDADES IMPLEMENTADAS

### ✅ MÓDULO LOGIN
- Validación de email y contraseña
- Modo offline funcional
- Animación shake en error
- Botón "Probar sin conexión"

### ✅ MÓDULO DASHBOARD
- 3 tarjetas de métricas (Vencimientos, Cobros, Pedidos)
- Gráfica de ventas con fl_chart
- Pull-to-refresh
- Auto-refresh cada 5 minutos
- Header con último acceso
- Accesos rápidos a otros módulos

### ✅ MÓDULO RUTERO
- Lista de clientes con color coding:
  - 🟢 Verde = Tiene venta reciente (últimos 7 días)
  - 🔴 Rojo = No tiene venta reciente
- Filtros por:
  - 📅 Día de visita (Lunes-Domingo)
  - 🚚 Día de reparto (Lunes-Domingo)
- 🔍 Búsqueda por nombre/código
- 📍 Indicador GPS (clientes con coordenadas)

### ✅ MÓDULO DETALLE CLIENTE
- Información completa del cliente
- Botón Google Maps (solo si tiene coordenadas)
- Botones de acción:
  - 📞 Llamar (abre dialer)
  - 📧 Email (abre mail)
  - 🗺️ Ver en mapa (abre Google Maps)
- Info de crédito con barra de progreso
- Estado activo/inactivo según ventas

### ✅ MÓDULO HISTÓRICO VENTAS
- Gráficas comparativas con fl_chart
- 3 vistas: Semana / Mes / Año
- Comparación con período anterior (línea punteada)
- Indicador de crecimiento %
- Datos dummy realistas

---

## 🎨 DATOS DUMMY INCLUIDOS

La app genera automáticamente:

### 👥 10 Clientes:
1. FRUTERIA ANTONIO (verde - ventas recientes)
2. SUPERMERCADO LOPEZ (rojo - sin ventas)
3. BAR MANOLO (verde - con GPS)
4. PANADERIA GARCIA (verde)
5. RESTAURANTE EL BUEN GUSTO (rojo)
6. TIENDA DE ROPA MODA (verde - con GPS)
7. FERRETERIA PEREZ (rojo)
8. CARNICERIA SANCHEZ (verde)
9. PESCADERIA MAR AZUL (verde - con GPS)
10. LIBRERIA CULTURA (rojo)

### 📊 Datos de ventas:
- 3 meses de histórico
- ~150 ventas distribuidas
- Diferentes productos
- Importes realistas

### 📄 Documentos:
- Vencimientos pendientes
- Pedidos en proceso
- Histórico de cobros

---

## 🗺️ NAVEGACIÓN EN LA APP

```
Login
  ↓
Dashboard
  ├─→ Rutero
  │    └─→ Detalle Cliente
  │         └─→ Google Maps (si tiene GPS)
  ├─→ Histórico Ventas
  └─→ Logout
```

---

## 💡 TIPS

- **Pull-to-refresh:** Arrastra hacia abajo en Dashboard o Rutero
- **Filtros Rutero:** Tap en icono de filtro (arriba derecha)
- **Búsqueda:** Tap en lupa en Rutero
- **Color coding:** Verde = activo, Rojo = inactivo
- **GPS:** Icono verde "GPS" indica que el cliente tiene coordenadas

---

## 📦 ARQUITECTURA

- **Clean Architecture** (Domain/Data/Presentation)
- **BLoC Pattern** para state management
- **Drift/SQLite** para base de datos offline
- **Material 3** design system
- **Dependency Injection** con get_it + injectable

---

## 🎯 PRÓXIMOS PASOS

1. Ejecuta: `flutter pub get`
2. Ejecuta: `flutter pub run build_runner build --delete-conflicting-outputs`
3. Ejecuta: `flutter run`
4. Login con: `demo@gmp.com` / `Demo123!`
5. ¡Explora la app!

---

## ❓ SOPORTE

Si algo no funciona:
1. Verifica `flutter doctor`
2. Limpia el proyecto: `flutter clean`
3. Reinstala dependencias: `flutter pub get`
4. Regenera código: `flutter pub run build_runner build --delete-conflicting-outputs`
5. Intenta de nuevo: `flutter run`

---

**¡TODO LISTO PARA EJECUTAR!** 🎉

La aplicación está 100% funcional con todos los módulos implementados.
