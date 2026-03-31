## Plan Cerrado: Pedidos (Cliente Obligatorio, Precios/Stock BD, Promos Robustas)

### Resumen
- Fuente de verdad fijada: **BD actual** (decisión tomada).
- Flujo obligatorio: **sin cliente no hay catálogo/precios/promos/detalle** (decisión tomada).
- Promociones: incluir **globales + cliente**, con deduplicación y reglas por artículo (decisión tomada).
- Cambio de cliente con carrito: **confirmar y vaciar** para evitar mezcla de tarifas/clientes (decisión tomada).
- Fecha de referencia para validación numérica: **31/03/2026**.

### Cambios de API e Interfaces
- `GET /api/pedidos/products` en [pedidos.js](/c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/routes/pedidos.js):
  - Requerirá `clientCode` (400 si falta), para hacer efectivo el bloqueo total.
- `GET /api/pedidos/promotions`:
  - Requerirá `clientCode` y devolverá promos de ámbito global + cliente.
- Payload de promociones (backend):
  - Añadir campos por línea desde PMPL1: `minUnits`, `minBoxes`, `maxUnits`, `maxBoxes`.
  - Añadir `scope` (`global`/`client`) y `canonicalPromoId` para dedupe estable.
- `getProductDetail` en [pedidos.service.js](/c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/backend/services/pedidos.service.js):
  - Mantener `codigoTarifaCliente` + `precioTarifaCliente` como precio operativo.
  - Mantener precio histórico separado (`precioClienteHist`), sin mezclarlo con tarifa activa.

### Cambios de Implementación
- Backend
  - Endurecer validación de cliente en productos/promos.
  - Reforzar `getProductDetail` con logging por etapa SQL (base/tarifas/stock/histórico/tarifa cliente) y fallback seguro a tarifa `1` si falla lookup de tarifa cliente, evitando 500.
  - Corregir causa de `42S22` en despliegue con trazabilidad completa (estado SQL + sentencia + etapa).
  - En promociones:
    - Consultar PMRL1 con `(CODIGOCLIENTE = '' OR CODIGOCLIENTE = :cliente)`.
    - Resolver conflictos global/cliente priorizando cliente.
    - Usar PMPL1 para límites reales por artículo y deduplicar por `canonicalPromoId + artículo`.
- Flutter
  - En [pedidos_provider.dart](/c:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad/lib/features/pedidos/providers/pedidos_provider.dart):
    - Si no hay cliente: no cargar productos, no cargar promos, limpiar estado visible de catálogo.
    - Al cambiar cliente con líneas: diálogo de confirmación, vaciar carrito/promos/cachés de producto.
  - Endurecer guards de código artículo vacío antes de llamar detalle o imagen (`/products//image`).
  - Ajustar presentación de producto:
    - No redondear `U/C` a entero cuando es decimal.
    - Etiquetar precios explícitamente (`€/cj`, `€/kg`, etc.) sin mezclar tarifa activa con histórico.
  - Rediseñar detalle de promoción para flujo robusto:
    - Cabecera de regla (`min`, `regalo`, `acumulable`).
    - Lista de artículos afectados con límites PMPL1 visibles.
    - Selección de regalo bloqueada por elegibilidad global y límites por artículo.
    - Validación fuerte antes de confirmar (nunca superar cupos).

### Plan de Pruebas
- Backend
  1. `GET /api/pedidos/products` sin `clientCode` -> 400.
  2. `GET /api/pedidos/products` con cliente válido -> 200 y precio operativo por tarifa cliente.
  3. `GET /api/pedidos/products/:code` no debe devolver 500 ante fallo lookup tarifa cliente (fallback a tarifa 1 + warning log).
  4. Promos para cliente con global+cliente: sin duplicados funcionales por promoción.
- Flutter
  1. Sin cliente: pantalla bloqueada completa (sin catálogo ni acciones de producto).
  2. Cambio de cliente con carrito: confirmación y vaciado correcto.
  3. Guard de código vacío: no se dispara `/products/` ni `/products//image`.
  4. Detalle promo: cálculo de elegibilidad y límites PMPL1 correcto.
- Validación funcional con los 3 artículos de referencia y cliente `4300010363`:
  - Confirmar que precios/stock mostrados salen de BD actual (no de fórmula legacy no trazable).

### Supuestos y decisiones por defecto
- Se toma como verdad operativa la BD actual (no “paridad visual Android”).
- Las diferencias Android no reproducibles (precio mínimo/stock) se tratan como **lógica legacy pendiente de traza**, no como base de cálculo actual.
- Si luego quieres paridad exacta Android, el siguiente paso será capturar respuesta real de su endpoint legacy para mapear fórmula cerrada.
