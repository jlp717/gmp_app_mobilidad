# GMP App Movilidad - Versión 2.0 🚀

## 🎨 Diseño Futurista Moderno

Esta versión V2 incluye un rediseño completo con:
- ✨ Glassmorphism y efectos neón
- 🎯 UX/UI optimizada para comerciales
- 📱 Diseño offline-first
- 🌈 Gradientes y micro-interacciones
- 📊 Gráficas interactivas

---

## 📋 Pantallas Completadas

### 1️⃣ Rutero Inteligente (`RuteroScreenV2`)
**Ubicación:** `lib/features/rutero/presentation/rutero_screen_v2.dart`

**Funcionalidades:**
- ✅ Calendario semanal/mensual interactivo
- ✅ Toggle entre "Día de Visita" y "Día de Reparto"
- ✅ Estadísticas del día (Completados, Pendientes, Ventas)
- ✅ Lista de clientes con tarjetas modernas
- ✅ Acciones rápidas: Llamar, Ubicación, Ver Detalles
- ✅ Estados visuales (Pendiente, Visitado, No Visitado)
- ✅ Badges VIP con gradientes especiales

---

### 2️⃣ Detalle de Cliente (`ClienteDetalleScreenV2`)
**Ubicación:** `lib/features/cliente_detalle/presentation/cliente_detalle_screen_v2.dart`

**Funcionalidades:**

#### Pestaña "Resumen"
- ✅ Gráfica de barras (Ventas € vs Unidades)
- ✅ 4 métricas principales: Ventas Totales, Unidades, Ticket Medio, Nº Pedidos
- ✅ Diseño con gradientes y colores diferenciados

#### Pestaña "Histórico"
- ✅ Filtros por Año y Mes
- ✅ Lista de productos comprados con:
  - Código + Nombre del producto
  - € Acumulados (columna izquierda)
  - Cajas Acumuladas (columna derecha)

#### Pestaña "Cobros"
- ✅ 4 tipos de cobro (tarjetas seleccionables):
  - Albarán (Contado)
  - Factura (Crédito)
  - Normal
  - Especial
- ✅ Lista de pedidos pendientes con:
  - Número de pedido
  - Fecha de vencimiento
  - Días restantes (con alerta si < 5 días)
  - Importe pendiente
- ✅ Total a cobrar en footer

**Botones de Acción:**
- ✅ "Hacer Pedido" → Navega a crear pedido
- ✅ "Presupuesto" → Navega a crear presupuesto
- ✅ "No Venta" → Diálogo con motivos predefinidos
- ✅ FAB "ESTAD." → Navega a Estadísticas & Productos

---

### 3️⃣ Estadísticas & Productos (`EstadisticasProductosScreenV2`)
**Ubicación:** `lib/features/estadisticas_productos/presentation/estadisticas_productos_screen_v2.dart`

**Funcionalidades:**

#### Pestaña "Artículos"
- ✅ Lista de productos YA comprados por el cliente
- ✅ Estadísticas por producto:
  - Unidades vendidas
  - Importe total
  - Última compra
  - Frecuencia de compra (Semanal/Mensual/Trimestral)
  - Tendencia (subiendo/bajando/estable con iconos)
- ✅ Filtros: Ordenar por ventas, nombre, precio
- ✅ Botón "Agregar al Pedido" por producto

#### Pestaña "Sugerencias"
- ✅ Productos NUEVOS recomendados
- ✅ Badge "NUEVO" destacado
- ✅ Razón de sugerencia ("Clientes similares compraron...")
- ✅ Precios con descuento si aplica
- ✅ Botón "Agregar al Pedido"

#### Pestaña "Promociones"
- ✅ Lista de promociones activas
- ✅ Información mostrada:
  - Nombre y descripción
  - Tipo (Simple, Compuesta)
  - Días restantes
  - Si se aplica automáticamente
- ✅ Alertas urgentes si quedan pocos días
- ✅ Diseño con gradientes de advertencia

**Iconos de Acción (Ojos):**
- ✅ Ojo A (Foto): Modal con imagen del producto
- ✅ Ojo B (Ficha): Descarga ficha técnica PDF

---

### 4️⃣ Gestión de Promociones (`PromotionCreationPageV2`)
**Ubicación:** `lib/features/promotions/presentation/pages/promotion_creation_page_v2.dart`

**Funcionalidades:**

#### Alcance
- ✅ "Para este Cliente" (si viene desde un cliente)
- ✅ "Para Todos"

#### Tipos de Promoción

**Simple (3x2, 2x1):**
- ✅ Configurar cantidad de compra
- ✅ Configurar cantidad a pagar
- ✅ Vista previa: "Lleva X y paga Y"

**Compuesta (Lleva X + Y gratis):**
- ✅ Selector de productos base (compra)
- ✅ Selector de productos gratis (regalo)
- ✅ Cantidades configurables
- ✅ Lista visual de productos agregados

#### Configuración
- ✅ Nombre y descripción
- ✅ Fechas (Desde/Hasta) con calendario nativo
- ✅ Aplicación automática (switch)
- ✅ Sistema de prioridades (1-5)

**Regla de Negocio:** ✅ Precio de promoción tiene prioridad sobre precio especial del cliente

---

### 5️⃣ Crear Pedido/Presupuesto (`CrearPedidoScreen`)
**Ubicación:** `lib/features/crear_pedido/presentation/crear_pedido_screen.dart`

**Funcionalidades:**
- ✅ 2 pestañas: Productos | Carrito
- ✅ Selector tipo: Pedido / Presupuesto
- ✅ Buscador de productos con filtros
- ✅ Filtro por categoría
- ✅ Filtro "Solo con stock"
- ✅ Agregar productos al carrito
- ✅ Modificar cantidades
- ✅ Eliminar items
- ✅ Cálculo automático:
  - Subtotal
  - Descuentos
  - IVA (21%)
  - Total
- ✅ Guardar pedido/presupuesto
- ✅ Diferencia: Presupuesto NO se sincroniza con almacén

---

## 🎨 Widgets Compartidos Mejorados

### `FuturisticTheme`
**Ubicación:** `lib/shared/widgets/futuristic_theme.dart`

**Nuevos colores:**
- `primaryNeon`, `secondaryNeon`, `accentNeon`
- `successNeon`, `warningNeon`, `errorNeon`, `infoNeon`
- `backgroundDark`, `surfaceDark`, `cardDark`, `cardLight`
- `textPrimary`, `textSecondary`, `textTertiary`, `textHint`

**Gradientes predefinidos:**
- `primaryGradient`, `neonGradient`, `accentGradient`
- `successGradient`, `warningGradient`, `cardGradient`
- `callGradient`, `locationGradient`, `orderGradient`, `vipGradient`

**Métodos útiles:**
- `getStatusColor(String status)`: Devuelve color según estado
- `getGradient(String type)`: Devuelve gradiente según tipo

### Widgets Nuevos

#### `NeonBadge`
```dart
NeonBadge(
  text: 'VIP',
  gradient: FuturisticTheme.vipGradient,
  icon: Icons.star,
  fontSize: 11,
)
```

#### `StatusChip`
```dart
StatusChip(
  text: 'Completado',
  status: 'completado',  // pendiente, completado, error
  icon: Icons.check_circle,
)
```

#### `StatCard`
```dart
StatCard(
  title: 'Ventas Totales',
  value: '12,450€',
  icon: Icons.euro,
  color: FuturisticTheme.successNeon,
  onTap: () {}, // Opcional
)
```

#### `ActionButton`
```dart
ActionButton(
  icon: Icons.phone,
  label: 'Llamar',
  color: FuturisticTheme.successNeon,
  onTap: () {},
  compact: true,
)
```

#### `FuturisticContainer`
```dart
FuturisticContainer(
  padding: EdgeInsets.all(16),
  gradient: FuturisticTheme.cardGradient,
  glowEffect: true,  // Añade brillo neón
  glowColor: FuturisticTheme.primaryNeon,
  child: YourWidget(),
)
```

#### `NeonButton`
```dart
NeonButton(
  text: 'Guardar',
  icon: Icons.save,
  gradient: FuturisticTheme.successGradient,
  onPressed: () {},
  height: 52,
)
```

#### `GlassmorphismContainer`
```dart
GlassmorphismContainer(
  padding: EdgeInsets.all(16),
  borderRadius: 16,
  opacity: 0.1,
  enableShadow: true,
  child: YourWidget(),
)
```

---

## 🚀 Cómo Probar la Aplicación

### Opción 1: Cambiar el main.dart

1. **Renombra el main.dart actual:**
   ```bash
   mv lib/main.dart lib/main_old.dart
   ```

2. **Renombra main_v2.dart a main.dart:**
   ```bash
   mv lib/main_v2.dart lib/main.dart
   ```

3. **Ejecuta la app:**
   ```bash
   flutter run
   ```

### Opción 2: Cambiar el entry point (Recomendado)

**Android** (`android/app/src/main/AndroidManifest.xml`):
```xml
<meta-data
    android:name="flutterEmbedding"
    android:value="2" />
<meta-data
    android:name="io.flutter.embedding.android.NormalTheme"
    android:resource="@style/NormalTheme" />
<!-- Añadir esta línea -->
<meta-data
    android:name="io.flutter.app.FlutterApplication"
    android:value="main_v2" />
```

**iOS** (`ios/Runner/Info.plist`):
```xml
<key>UIApplicationSupportsIndirectInputEvents</key>
<true/>
<!-- Añadir estas líneas -->
<key>FLTEngineDartEntrypoint</key>
<string>main_v2</string>
```

Luego ejecuta:
```bash
flutter run
```

---

## 📱 Flujo de Navegación

```
RuteroScreenV2 (Pantalla Inicial)
    ↓
    → ClienteDetalleScreenV2
        → Pestaña Resumen (gráficas)
        → Pestaña Histórico (productos comprados)
        → Pestaña Cobros (pendientes de pago)
        ↓
        → [Botón] Hacer Pedido → CrearPedidoScreen
        → [Botón] Presupuesto → CrearPedidoScreen (modo presupuesto)
        → [Botón] No Venta → Diálogo
        → [FAB] ESTAD. → EstadisticasProductosScreenV2
            → Pestaña Artículos (productos comprados)
            → Pestaña Sugerencias (productos nuevos)
            → Pestaña Promociones (activas)
            ↓
            → [Desde Promociones] → PromotionCreationPageV2
```

---

## 🔧 Comandos Útiles

### Instalar dependencias
```bash
flutter pub get
```

### Limpiar y reconstruir
```bash
flutter clean
flutter pub get
flutter run
```

### Compilar para Android
```bash
flutter build apk --release
```

### Compilar para iOS
```bash
flutter build ios --release
```

---

## 📊 Datos de Prueba

La aplicación viene con datos simulados para pruebas:

### Clientes de Prueba
1. **ACHUPALLAS ORTIZ MARIA MAGDALENA** (VIP)
   - Deuda: 293.10€
   - Estado: Pendiente

2. **GRUPO HOSTELERO HERMANOS GALLEGO**
   - Última venta: 850€
   - Estado: Visitado

3. **NICASERVICIOS JM,S.COOP.**
   - Deuda: 800€
   - Estado: No Visitado

4. **CAFETERIAS LAMERZU SLL**
   - Deuda: 450€
   - Estado: Pendiente

5. **PANADERIA LA LORQUINA, S.L.** (VIP)
   - Deuda: 1,200€
   - Estado: Pendiente

### Productos de Prueba
- Tornillo M8 x 100mm
- Pintura Plástica Blanca 15L
- Cable Eléctrico 2.5mm²
- Taladro Inalámbrico 18V
- Rodillo de Pintura Profesional

### Promociones de Prueba
- 3x2 en Tornillería
- Pack Pintura + Rodillo
- Black Friday Herramientas (15% desc.)

---

## ✅ Checklist de Funcionalidades

### Rutero Screen ✅
- [x] Calendario interactivo
- [x] Toggle Visitas/Repartos
- [x] Estadísticas del día
- [x] Lista de clientes
- [x] Llamar, Ubicación, Detalles

### Cliente Detalle ✅
- [x] 3 Pestañas (Resumen, Histórico, Cobros)
- [x] Gráfica de ventas
- [x] Histórico de productos
- [x] Gestión de cobros
- [x] Hacer Pedido/Presupuesto/No Venta
- [x] Acceso a ESTAD.

### Estadísticas & Productos ✅
- [x] 3 Pestañas (Artículos, Sugerencias, Promociones)
- [x] Estadísticas de productos
- [x] Tendencias y frecuencias
- [x] Iconos de acción (Foto, Ficha)
- [x] Agregar al pedido

### Gestión de Promociones ✅
- [x] Alcance (Cliente/Todos)
- [x] Tipo Simple (3x2)
- [x] Tipo Compuesta (X + Y)
- [x] Fechas y vigencia
- [x] Aplicación automática
- [x] Sistema de prioridades

### Crear Pedido ✅
- [x] Modo Pedido/Presupuesto
- [x] Búsqueda de productos
- [x] Filtros avanzados
- [x] Gestión de carrito
- [x] Cálculos automáticos
- [x] Guardar y sincronizar

---

## 🎨 Paleta de Colores

### Colores Principales
- **Primary Neon:** #00E5FF (Cyan brillante)
- **Secondary Neon:** #FF2E97 (Rosa fucsia)
- **Accent Neon:** #00FFA3 (Verde menta)

### Colores de Estado
- **Success:** #00FF99 (Verde éxito)
- **Warning:** #FFD600 (Amarillo advertencia)
- **Error:** #FF3D71 (Rojo error)
- **Info:** #00BFFF (Azul información)

### Fondos
- **Background Dark:** #0A0E27
- **Surface Dark:** #1A1F3A
- **Card Dark:** #252B48

---

## 📝 Notas Importantes

1. **Offline-First:** Todas las pantallas están preparadas para trabajar sin conexión
2. **Datos Simulados:** Los datos actuales son de prueba, listos para conectar con tu API
3. **Sincronización:** Los pedidos se marcan para sincronización, los presupuestos NO
4. **Promociones:** El sistema de prioridades permite resolver conflictos entre promociones
5. **Diseño Responsive:** Todas las pantallas están optimizadas para diferentes tamaños

---

## 🐛 Solución de Problemas

### Error: "No se puede realizar la llamada"
- Verifica permisos en AndroidManifest.xml:
```xml
<uses-permission android:name="android.permission.CALL_PHONE"/>
```

### Error: "No se puede abrir la ubicación"
- Asegúrate de tener Google Maps instalado en el dispositivo

### Pantalla en blanco
- Ejecuta: `flutter clean && flutter pub get && flutter run`

### Errores de compilación
- Verifica que todas las dependencias estén en pubspec.yaml
- Ejecuta: `flutter pub get`
- Si persiste: `flutter clean && flutter pub get`

---

## 📞 Soporte

Para cualquier duda o problema:
1. Revisa este README
2. Verifica los logs con: `flutter run --verbose`
3. Limpia y reconstruye: `flutter clean && flutter pub get`

---

**¡Listo para probar! 🚀**

La aplicación está completamente funcional y lista para ser probada en tu dispositivo móvil.
