# Presentación comerciales — pedidos, cobros, % mínimo

status: approved
date: 2026-09-21
playbook: BUILD
waiver_erp: Escrituras solo JAVIER.TEST_*. Cero DSEDAC/CPC/CAC/LQD/OPP/LAC.

## Contexto

HIT isolated_test para la presentación comercial. Deuda CVC viva (nunca VISTA_DEUDA_BASE). % mínimo = CLX.PORCENTAJECOBRORIGUROSO cuando COBRORIGUROSOSN='S', si no VDDX.PORCENTAJEMINIMOCOBRO.

## Requisitos EARS

### REQ-PROMO-01
WHEN un pedido se crea o confirma con líneas de regalo (`tipoLinea='G'` / `isAutoGift`) o una promo PMR 3+1 seleccionada cuyo umbral se cumple
THE SYSTEM SHALL persistir las líneas REGALO a precio 0
AND THE SYSTEM SHALL NOT sustituir ese 0 por tarifa/mínimo
AND THE SYSTEM SHALL dejar `PEDIDOS_CAB.IMPORTETOTAL` igual a la suma de `PEDIDOS_LIN.IMPORTEVENTA` (tras pie)
AND THE SYSTEM SHALL dejar el pedido CONFIRMADO LOCAL (TEST_PEDIDOS_*, sync LOCAL).

### REQ-COB-03
WHEN el comercial registra un cobro en isolated_test
THE SYSTEM SHALL insertar en JAVIER.TEST_COBROS
AND THE SYSTEM SHALL calcular pendiente = min(CVC.IMPORTEPENDIENTE, importe documento/vencimiento) menos cobros app
AND THE SYSTEM SHALL rechazar duplicado con 409 IDEMPOTENCY_CONFLICT (mismo token, payload distinto)
AND THE SYSTEM SHALL rechazar sobrecobro con 409 PAYMENT_EXCEEDS (equivalente OVERPAY_NOT_ALLOWED)
AND THE SYSTEM SHALL dejar el resto pendiente si el cobro es parcial.

### REQ-COB-04
WHEN el comercial guarda liquidación tras cobrar
THE SYSTEM SHALL persistir en JAVIER.TEST_LIQUIDACION_COMERCIAL
AND THE SYSTEM SHALL NOT escribir DSEDAC.LQD.

### REQ-PED-04
WHEN el comercial crea o confirma un pedido
THE SYSTEM SHALL leer QSYS2 + CLX/VDDX (no hardcode 30/100)
AND THE SYSTEM SHALL bloquear con 403 `MIN_COBRO_ORDER_BLOCKED` si el % cobrado de cartera CVC es menor que el mínimo (CLX si COBRORIGUROSOSN='S', si no VDDX)
AND THE SYSTEM SHALL mostrar el bloqueo en la UI de Pedidos.
