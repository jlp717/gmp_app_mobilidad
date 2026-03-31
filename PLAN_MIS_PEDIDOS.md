# Plan: Rediseño completo de "Mis Pedidos"

## Estado: ✅ IMPLEMENTADO + BUGS CORREGIDOS

---

## 1. Estados de pedido — Basados en el sistema real DB2

### Tablas del sistema real (DSEDAC)
| Tabla | Columna estado | Valores reales | Significado |
|-------|----------------|----------------|-------------|
| **CPC** (Cab.pedidos cliente) | `SITUACIONPEDIDO` (CHAR 1) | `A` (715,900) | Activo/Abierto |
| CPC | `CONFORMADOSN` (CHAR 1) | `S` (661,206) = Confirmado, ` ` (54,009) = No confirmado | Confirmación |
| CPC | `SITUACIONALBARAN` (CHAR 1) | `X` (691,792) = Sin albarán, `R` (22,877) = Parcialmente albaranado | Progreso albarán |
| **CAC** (Cab.albaranes cliente) | `SITUACIONALBARAN` (CHAR 1) | `A` (63,620) = Abierto, `F` (626,055) = Facturado, `X` (8,141) = Anulado | Estado albarán |
| CAC | `ESTADOENVIO` (CHAR 2) | `  ` = No enviado, `**` = Enviado | Estado envío |

### Estados de nuestra app (JAVIER.PEDIDOS_CAB — tabla nuestra)
| Estado | Color | HEX | Icono | Mapeo al sistema real |
|--------|-------|-----|-------|----------------------|
| `BORRADOR` | Naranja | `#F97316` | `edit_note` | Guardado local, no enviado a DB2 |
| `CONFIRMADO` | Azul | `#3B82F6` | `check_circle` | Enviado a DB2 (CPC creado, CONFORMADOSN='S') |
| `ENVIADO` | Verde | `#22C55E` | `local_shipping` | Albaranado (existe CAC con SITUACIONALBARAN='A') |
| `FACTURADO` | Púrpura | `#A855F7` | `receipt_long` | Albarán facturado (CAC con SITUACIONALBARAN='F') |
| `ANULADO` | Rojo | `#EF4444` | `cancel` | Cancelado/anulado |

### Transiciones de estado permitidas
```
BORRADOR   → CONFIRMADO (al confirmar pedido)
BORRADOR   → ANULADO (al cancelar borrador)
CONFIRMADO → ENVIADO (cuando se albarana en DB2)
CONFIRMADO → ANULADO (al anular pedido confirmado)
ENVIADO    → FACTURADO (cuando se factura en DB2)
ENVIADO    → ANULADO (al anular albarán)
FACTURADO  → ANULADO (al anular factura)
```

---

## 2. Estructura de la pestaña Pedidos

La pestaña Pedidos tendrá dos zonas:
1. **Zona superior**: Crear pedido (catálogo + carrito) — existente, sin cambios
2. **Zona inferior**: "Mis Pedidos" — completamente rediseñada

---

## 3. Funcionalidades completas

### 3.1 Dashboard KPIs (top)
- **4 tarjetas KPI principales**:
  - **Pedidos del mes** — con badge de tendencia vs mes anterior (↑↓%)
  - **Importe total del mes** — con tendencia %
  - **Margen medio (%)** — semáforo: verde ≥15%, naranja ≥5%, rojo <5%
  - **Ticket medio** — importe total / nº pedidos
- **Contadores por estado**: 5 badges clicables con conteo de cada estado
- **Mini gráfico de tendencia**: Línea de los últimos 7 días (pedidos + importe)
- **Top 5 clientes**: Ranking por importe del mes actual

### 3.2 Filtros avanzados

#### Filtros principales (siempre visibles)
| Filtro | Tipo | Descripción |
|--------|------|-------------|
| **Búsqueda** | TextField con debounce 300ms | Busca por nº pedido, nombre cliente, código cliente |
| **Estado** | Chips horizontales scrollables | Todos, Borrador, Confirmado, Enviado, Facturado, Anulado |
| **Fecha inicio** | DatePicker | Fecha desde (default: primer día del mes actual) |
| **Fecha fin** | DatePicker | Fecha hasta (default: hoy) |

#### Presets de fecha rápidos (chips sobre los datepickers)
- Hoy, Esta semana, Este mes, Mes anterior, Últimos 7 días, Últimos 30 días, Este año, Personalizado

#### Filtros secundarios (expandibles con botón "Más filtros")
| Filtro | Tipo | Descripción |
|--------|------|-------------|
| **Importe mínimo** | TextField numérico | Filtrar pedidos ≥ importe |
| **Importe máximo** | TextField numérico | Filtrar pedidos ≤ importe |
| **Cliente** | Dropdown searchable | Filtrar por cliente específico |
| **Nº líneas** | Range slider | Pedidos con entre X e Y líneas |
| **Margen mínimo** | TextField numérico | Pedidos con margen ≥ X% |
| **Ordenación** | Dropdown | Fecha (desc/asc), Importe (desc/asc), Cliente (A-Z), Nº Pedido |

### 3.3 Lista de pedidos rediseñada
- **Cards premium con gradiente** según estado del pedido
- **Info visible en cada card**: Nº pedido formateado (`M-2026-000042`), nombre y código del cliente, fecha (`DD/MM/YYYY HH:mm`), número de líneas, importe total, margen %, badge de estado con icono
- **Swipe actions**: izquierda = duplicar, derecha = ver detalle
- **Pull-to-refresh** con re-sync automático
- **Paginación virtual**: carga de 20 en 20 con infinite scroll
- **Skeleton loaders** mientras carga

### 3.4 Acciones rápidas por pedido
| Acción | Estados disponibles | Descripción |
|--------|-------------------|-------------|
| **Ver detalle** | Todos | Sheet expandible con líneas, totales, observaciones |
| **Duplicar al carrito** | Todos | Clona todas las líneas al carrito actual |
| **Confirmar** | BORRADOR | Carga en carrito para confirmar |
| **Eliminar** | BORRADOR | Borra el borrador |
| **Anular** | CONFIRMADO, ENVIADO, FACTURADO | Cambia estado a ANULADO |
| **Exportar PDF** | Todos | Genera PDF del pedido |
| **Ver albarán** | ENVIADO, FACTURADO | Abre info del albarán vinculado en CAC |

### 3.5 Actualización dinámica
- Al confirmar un pedido → se actualiza la lista y KPIs automáticamente + snackbar de éxito
- Al guardar borrador → aparece en sección borradores
- Al anular → se actualiza el badge de estado
- Pull-to-refresh recarga todo (KPIs + lista)
- Auto-sync cada 30 segundos cuando la pestaña está visible

---

## 4. Generación de identificadores

### Sistema de numeración (JAVIER.PEDIDOS_SEQ)
Ya existe la tabla `JAVIER.PEDIDOS_SEQ` con: `EJERCICIO` (NUMERIC 4), `ULTIMO_NUMERO` (NUMERIC 6)

### Formato del identificador
- **Número de pedido**: Secuencial por ejercicio, 6 dígitos (000001-999999)
- **Formato visual**: `M-{EJERCICIO}-{NUMERO}` (ej: `M-2026-000042`)
- **Serie**: configurable (default 'M' para móvil)

---

## 5. Backend — Endpoints

### 5.1 Nuevo: GET /orders/stats
**Query params**: `vendedorCodes` (requerido), `dateFrom`, `dateTo`

**Respuesta**:
```json
{
  "totalOrders": 45,
  "totalAmount": 12500.50,
  "totalBase": 10200.00,
  "totalIva": 2300.50,
  "avgMargin": 18.5,
  "avgTicket": 277.79,
  "byStatus": {
    "BORRADOR": 3,
    "CONFIRMADO": 30,
    "ENVIADO": 8,
    "FACTURADO": 2,
    "ANULADO": 2
  },
  "dailyTrend": [
    { "date": "2026-03-25", "orders": 5, "amount": 1200.00 },
    { "date": "2026-03-26", "orders": 3, "amount": 850.00 }
  ],
  "topClients": [
    { "code": "30887", "name": "CLIENTE EJEMPLO", "orders": 8, "amount": 3200.00 }
  ]
}
```

### 5.2 Reforzado: GET /orders
**Query params existentes**: `vendedorCodes`, `status`, `year`, `offset`, `limit`
**Nuevos query params**:
- `dateFrom` (YYYYMMDD) — Fecha desde
- `dateTo` (YYYYMMDD) — Fecha hasta
- `search` — Búsqueda por nº pedido, cliente
- `minAmount` — Importe mínimo
- `maxAmount` — Importe máximo
- `sortBy` — `fecha`, `importe`, `cliente`, `numero`
- `sortOrder` — `ASC`, `DESC`

### 5.3 Reforzado: PUT /orders/:id/status
**Body**: `{ "estado": "ANULADO" }`
- Valida transición de estado permitida
- Actualiza ESTADO en PEDIDOS_CAB
- Si se anula un CONFIRMADO → libera stock reservado
- Invalida caché de stats y lista

### 5.4 Nuevo: GET /orders/:id/albaran
- Busca en CAC el albarán vinculado al pedido
- Devuelve datos del albarán si existe

---

## 6. Frontend — Archivos

### 6.1 Archivos creados (6 nuevos)
| Archivo | Descripción |
|---------|-------------|
| `lib/features/pedidos/presentation/widgets/order_kpi_dashboard.dart` | Dashboard KPIs con 4 tarjetas, contadores por estado, gráfico de tendencia |
| `lib/features/pedidos/presentation/widgets/order_card.dart` | Card premium de pedido con gradientes por estado, info completa, acciones por estado |
| `lib/features/pedidos/presentation/widgets/order_filters_bar.dart` | Barra de filtros completa: búsqueda, estado, fechas, importes, ordenación, presets |
| `lib/features/pedidos/presentation/widgets/order_empty_state.dart` | Estado vacío con ilustración, mensaje contextual según filtros activos, CTA |
| `lib/features/pedidos/presentation/widgets/order_status_badge.dart` | Widget reutilizable de badge de estado con color, icono y animación |
| `lib/features/pedidos/presentation/widgets/order_trend_chart.dart` | Mini gráfico de líneas para tendencia de 7 días (CustomPainter, sin dependencias externas) |

### 6.2 Archivos modificados (4 existentes)
| Archivo | Cambios |
|---------|---------|
| `lib/features/pedidos/presentation/pages/pedidos_page.dart` | Eliminar código antiguo de orders. Integrar nueva sección con widgets nuevos. Añadir acciones para borradores (confirmar, eliminar). |
| `lib/features/pedidos/providers/pedidos_provider.dart` | Añadir: orderStats, isLoadingStats, loadOrderStats(), filtros avanzados, applyFilters() |
| `lib/features/pedidos/data/pedidos_service.dart` | Añadir: getOrderStats(), getOrderAlbaran(), OrderStats model, OrderSummary campos nuevos |
| `backend/routes/pedidos.js` | Nuevo GET /orders/stats, reforzar GET /orders, nuevo GET /orders/:id/albaran |
| `backend/services/pedidos.service.js` | Nueva getOrderStats(), reforzar getOrders(), nueva getOrderAlbaran() |

---

## 7. Principios de implementación

### Backend
- NUNCA inventar columnas DB2 — verificar siempre en el esquema real
- Consultas parametrizadas — nunca string concat
- Fallback seguro — si una tabla no existe, devolver [] o null con warning
- Logging por etapa — cada consulta con logger.info/error
- Limitar parámetros IN a 50 máximo para evitar error CWB0111 de DB2

### Frontend
- Código limpio — widgets pequeños, responsabilidades únicas
- Sin dependencias nuevas — gráfico custom con CustomPainter
- Responsive — usar Responsive helper existente
- Performance — ListView.builder, debounced search, paginación
- Error handling — try/catch en todas las llamadas API
- Consistencia — usar AppTheme existente

---

## 8. Criterios de aceptación

- [x] Dashboard KPIs muestra datos correctos
- [x] Filtros funcionan individualmente y combinados
- [x] Búsqueda por texto encuentra por nº pedido, nombre cliente, código cliente
- [x] Filtro de fecha funciona con ambos datepickers
- [x] Presets de fecha funcionan correctamente
- [x] Cards muestran toda la info del pedido
- [x] Colores de estado coinciden con la paleta definida
- [x] Acciones por estado: BORRADOR (Confirmar, Eliminar), CONFIRMADO+ (Anular, Duplicar), ENVIADO+ (Ver albarán)
- [x] Confirmar pedido muestra snackbar de éxito
- [x] Tras confirmar, la lista de pedidos y KPIs se actualizan
- [x] Duplicar pedido clona líneas al carrito
- [x] Pull-to-refresh recarga todo
- [x] Estado vacío muestra mensaje contextual
- [x] Loading states con skeleton loaders
- [x] Responsive en móvil y tablet
- [x] 0 errores en `flutter analyze`
- [x] 0 errores en `node -c`
- [x] Sin columnas DB2 inventadas

---

## 9. Bugs corregidos durante implementación

### Bug 1: PMRL1 parameter count mismatch
**Error**: `The number of parameter markers in the statement does not equal the number of bind values passed to the function`
**Causa**: `paramsPmr.push(today)` añadía un 4º parámetro pero la SQL solo tenía 3 `?`
**Fix**: Eliminado el push sobrante

### Bug 2: getOrders con 100+ vendedores excede límite DB2
**Error**: `CWB0111 - Los datos de entrada son demasiado grandes para el campo`
**Causa**: 100+ códigos de vendedor generaban `IN(?, ?, ...)` con demasiados parámetros para DB2 ODBC
**Fix**: Si hay >50 vendedores, se trata como ALL (sin filtro de vendedor)

### Bug 3: getOrderStats con mismo problema de vendedores
**Error**: Mismo que Bug 2
**Fix**: Mismo fix aplicado — >50 vendedores = ALL

### Bug 4: KPIs cargando infinito (404 en /orders/stats)
**Error**: `GET /api/pedidos/orders/stats → 404`
**Causa**: La ruta estaba registrada como `/stats` pero el frontend llamaba `/orders/stats`
**Fix**: Cambiada la ruta de `/stats` a `/orders/stats` en pedidos.js

### Bug 5: Confirmar pedido sin feedback visual
**Error**: Al confirmar pedido no se mostraba snackbar ni se actualizaba la lista de pedidos
**Causa**: `_onConfirm` y `_showOrderPreview` no recargaban la lista de pedidos ni los KPIs tras confirmar
**Fix**: Añadido `provider.loadOrders()` + `provider.loadOrderStats()` + snackbar de éxito en ambos métodos

### Bug 6: Borradores sin acciones en "Mis Pedidos"
**Error**: Los pedidos en estado BORRADOR no tenían acciones para confirmar o eliminar
**Causa**: `OrderCard` no tenía callbacks para acciones de borrador
**Fix**: Añadidos `onResend` y `onDelete` en `OrderCard`, con métodos `_confirmBorrador` y `_deleteBorrador` en `pedidos_page.dart`

---

## 10. Resumen de cambios

### Backend
- `backend/services/pedidos.service.js`: 3 funciones nuevas/reforzadas
- `backend/routes/pedidos.js`: 2 endpoints nuevos, 1 reforzado, 1 ruta corregida

### Frontend
- 6 widgets nuevos creados
- 4 archivos existentes modificados
- 3880 → 2763 líneas en pedidos_page.dart (1117 líneas menos)
- 0 errores en flutter analyze
- 0 errores en node -c

---

## 11. Flujo completo de pedido verificado

```
1. Usuario selecciona cliente
2. Busca y añade productos al carrito
3. Pulsa "Confirmar pedido" → Preview sheet
4. Pulsa "CONFIRMAR PEDIDO" en el preview
5. Backend: Crea pedido (BORRADOR) → Confirma (CONFIRMADO)
6. Frontend: Muestra snackbar "Pedido #XXX confirmado correctamente"
7. Frontend: Limpia carrito
8. Frontend: Recarga KPIs + lista de pedidos
9. Usuario va a "Mis Pedidos" → Ve el pedido como CONFIRMADO
10. Usuario puede: Ver detalle, Duplicar, Anular, Ver albarán

Para borradores:
1. Usuario guarda pedido como borrador
2. Va a "Mis Pedidos" → Ve el borrador con estado BORRADOR
3. Puede: Confirmar (carga en carrito) o Eliminar
4. Al confirmar → carga en carrito → confirma desde carrito
5. Al eliminar → borra de la DB → actualiza lista
```
