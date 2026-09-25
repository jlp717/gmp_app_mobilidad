# REQ-18 — Ventana edición/borrado CONFIRMADO: decisión BORRADOR-only

Fecha: 2026-09-24. Spec: `.cline/state/specs/tanda3-bolsa-comercial.ears.md`.

## Verificación QSYS2 (sesión actual, DSN GMP)

- `JAVIER.PEDIDOS_CAB`: NO existe columna de fecha/hora de confirmación
  (búsqueda `%CONFIRM%` vacía). Solo `CREATED_AT` (creación) y `UPDATED_AT`
  (cualquier update: no sirve como ancla de "60 min desde confirmación").
- `JAVIER.REPARTIDOR_ENTREGAS`: sin columnas de enlace a pedido
  (es por orden de preparación: `EJERCICIOORDENPREPARACION`,
  `NUMEROORDENPREPARACION`, sin `PEDIDO_ID`). No hay join verificado
  pedido → entrega/ruta/albarán.
- `JAVIER.MOVIMIENTOS_BOLSA`: `SALDO_ANTERIOR`/`SALDO_POSTERIOR` +
  `IDEMPOTENCY_KEY` verificados (soportan REQ-15 sin cambios DDL).

## Decisión

Ventana 1 h sobre CONFIRMADO **NO implementada**: faltan las dos precondiciones
que la propia spec exige (ancla temporal fiable + check "sin albarán/ruta").
Implementarla con `UPDATED_AT` como proxy sería mentir: cualquier edición
posterior resetearía la ventana y un pedido con camión ya cargado podría
revertirse con bolsa recalculada tarde (doble conteo, reserva liberada tarde).

## Alternativa aplicada (segura)

- Backend sin cambios: `cancelOrder` sigue BORRADOR-only, CONFIRMADO → 409
  `PEDIDO_MANAGED_BY_ERP` (`backend/services/pedidos/index.js:5030-5113`).
- App: `OrderCard` muestra "Solicitar anulación" en CONFIRMADO con diálogo
  que indica pedirlo al jefe de ventas con la serie completa
  (`lib/features/pedidos/presentation/widgets/order_card.dart`).
- Reversión bolsa: no aplica (no hay auto-anulación de CONFIRMADO, luego no
  hay movimiento inverso que escribir; si el jefe anula vía ERP, el ledger
  existente queda intacto y trazable).

## Para reabrir la ventana (requisitos)

1. Columna `CONFIRMED_AT` (o auditoría de transición BORRADOR→CONFIRMADO)
   en `PEDIDOS_CAB` vía DDL aprobado por Javier.
2. Join verificado pedido → entrega/rutero/albarán (FK o tabla puente).
3. Auditoría quién/cuándo/antes/después + reversión inversa idempotente +
   tests jest de ventana/fuera-ventana/con-albarán (criterios spec).
4. Decisión explícita de Javier (este documento es la pregunta formal).

## Decisión final senior (2026-09-24)

BORRADOR editable/eliminable por comercial; CONFIRMADO solo botón
"Solicitar anulación" (con motivo + referencia serie completa
`numeroPedidoFormatted`) hacia jefe de ventas/ADMIN. Sin ventana 1 h de
auto-edición en CONFIRMADO, sin DDL, sin nuevos permisos.

Justificación least-privilege:

- Sin `CONFIRMED_AT` ni join pedido→entrega verificado (QSYS2 sesión
  actual): ventana con `UPDATED_AT` como proxy miente y resetea con
  cualquier edición posterior.
- Evita doble conteo bolsa/stock: reversión tardía libera reserva tarde
  y recalcula bolsa fuera de tiempo; `MOVIMIENTOS_BOLSA` queda trazable
  sin inverso fantasma.
- Camión cargado / ruta asignada: CONFIRMADO lo gestiona ERP; mutar
  desde móvil rompe fuente verdad operativa.
- Acciones maliciosas/accidentales: comercial no muta CONFIRMADO;
  anulación solo vía jefe/ADMIN con motivo auditado.
- UX un tap sin fricción: `OrderCard` informa y pide referencia completa,
  no muta nada.

Reapertura ventana solo con DDL futura (`CONFIRMED_AT` + join entrega +
auditoría + tests) si Javier la autoriza explícito.
