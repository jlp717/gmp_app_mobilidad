# Plan: Rediseño completo de "Mis Pedidos"

## 1. Estados de pedido — Basados en el sistema real DB2

### Tablas del sistema real (DSEDAC)
| Tabla | Columna estado | Valores reales | Significado |
|-------|----------------|----------------|-------------|
| **CPC** (Cab.pedidos cliente) | `SITUACIONPEDIDO` (CHAR 1) | `A` (715,900) | Activo/Abierto |
| CPC | `CONFORMADOSN` (CHAR 1) | `S` (661,206) = Confirmado, ` ` (54,009) = No confirmado | Confirmación |
| CPC | `SITUACIONALBARAN` (CHAR 1) | `X` (691,792) = Sin albarán, `R` (22,877) = Parcialmente albaranado | Progreso albarán |
| **CAC** (Cab.albaranes cliente) | `SITUACIONALBARAN` (CHAR 1) | `A` (63,620) = Abierto, `F` (626,055) = Facturado, `X` (8,141) = Anulado | Estado albarán |
| CAC | `ESTADOENVIO` (CHAR 2) | `  ` = No enviado, `**` = Enviado | Estado envío |

### Ciclo de vida real del pedido
```
1. Pedido creado     → CPC: SITUACIONPEDIDO='A', CONFORMADOSN=' '
2. Pedido confirmado → CPC: CONFORMADOSN='S'
3. Pedido albaranado → Se genera CAC: SITUACIONALBARAN='A', CPC: SITUACIONALBARAN='R'
4. Albarán facturado → CAC: SITUACIONALBARAN='F'
5. Albarán anulado   → CAC: SITUACIONALBARAN='X'
```

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
| **Anular** | CONFIRMADO, ENVIADO, FACTURADO | Cambia estado a ANULADO |
| **Reenviar** | BORRADOR | Vuelve a intentar confirmación |
| **Exportar PDF** | Todos | Genera PDF del pedido |
| **Ver albarán** | ENVIADO, FACTURADO | Abre info del albarán vinculado en CAC |

### 3.5 Actualización dinámica
- Al confirmar un pedido → se actualiza la lista y KPIs automáticamente
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
**Respuesta**: totalOrders, totalAmount, totalBase, totalIva, avgMargin, avgTicket, byStatus, dailyTrend[], topClients[]

### 5.2 Reforzado: GET /orders
**Nuevos params**: `dateFrom`, `dateTo`, `search`, `minAmount`, `maxAmount`, `sortBy`, `sortOrder`
**Respuesta reforzada**: cada pedido incluye numeroPedidoFormatted, fechaFormatted, lineCount, base, iva, costo, vendedorCode, observaciones, tarifa, formaPago, origen

### 5.3 Reforzado: PUT /orders/:id/status
Valida transición, libera stock si anula, invalida caché

### 5.4 Nuevo: GET /orders/:id/albaran
Busca en CAC el albarán vinculado al pedido

---

## 6. Frontend — Archivos

### 6.1 Archivos a crear (6 nuevos)
| Archivo | Descripción |
|---------|-------------|
| `order_kpi_dashboard.dart` | Dashboard KPIs con 4 tarjetas, contadores por estado, gráfico de tendencia |
| `order_card.dart` | Card premium de pedido con gradientes por estado, info completa, swipe actions |
| `order_filters_bar.dart` | Barra de filtros completa: búsqueda, estado, fechas, importes, ordenación, presets |
| `order_empty_state.dart` | Estado vacío con ilustración, mensaje contextual según filtros activos, CTA |
| `order_status_badge.dart` | Widget reutilizable de badge de estado con color, icono y animación |
| `order_trend_chart.dart` | Mini gráfico de líneas para tendencia de 7 días (CustomPainter, sin dependencias externas) |

### 6.2 Archivos a modificar (4 existentes)
| Archivo | Cambios |
|---------|---------|
| `pedidos_page.dart` | Eliminar código antiguo de orders. Integrar nueva sección con widgets nuevos. |
| `pedidos_provider.dart` | Añadir: orderStats, isLoadingStats, loadOrderStats(), filtros avanzados, applyFilters() |
| `pedidos_service.dart` | Añadir: getOrderStats(), getOrderAlbaran(), OrderStats model, OrderSummary campos nuevos |
| `backend/routes/pedidos.js` | Nuevo GET /orders/stats, reforzar GET /orders, nuevo GET /orders/:id/albaran |
| `backend/services/pedidos.service.js` | Nueva getOrderStats(), reforzar getOrders(), nueva getOrderAlbaran() |

---

## 7. Principios de implementación

### Backend
- NUNCA inventar columnas DB2 — verificar siempre en el esquema real
- Consultas parametrizadas — nunca string concat
- Fallback seguro — si una tabla no existe, devolver [] o null con warning
- Logging por etapa — cada consulta con logger.info/error

### Frontend
- Código limpio — widgets pequeños, responsabilidades únicas
- Sin dependencias nuevas — gráfico custom con CustomPainter
- Responsive — usar Responsive helper existente
- Performance — ListView.builder, debounced search, paginación
- Error handling — try/catch en todas las llamadas API
- Consistencia — usar AppTheme existente

---

## 8. Criterios de aceptación

- [ ] Dashboard KPIs muestra datos correctos
- [ ] Filtros funcionan individualmente y combinados
- [ ] Búsqueda por texto encuentra por nº pedido, nombre cliente, código cliente
- [ ] Filtro de fecha funciona con ambos datepickers
- [ ] Presets de fecha funcionan correctamente
- [ ] Cards muestran toda la info del pedido
- [ ] Colores de estado coinciden con la paleta definida
- [ ] Swipe actions funcionan (duplicar, ver detalle)
- [ ] Anular pedido cambia estado correctamente
- [ ] Duplicar pedido clona líneas al carrito
- [ ] Pull-to-refresh recarga todo
- [ ] Estado vacío muestra mensaje contextual
- [ ] Loading states con skeleton loaders
- [ ] Responsive en móvil y tablet
- [ ] 0 errores en `flutter analyze`
- [ ] 0 errores en `node -c`
- [ ] Sin columnas DB2 inventadas
