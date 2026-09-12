# Cierre perfil COMERCIAL (isolated_test)

status: approved
date: 2026-09-11
playbook: BUILD
waiver_erp: Escrituras solo JAVIER.TEST_*. Cero DSEDAC/CPC/CAC/LQD/OPP.

## Contexto

Cierra el perfil COMERCIAL al 100 % en `isolated_test`. Reparto no se revierte.
Export ERP permanece apagado. Chip «Pendiente ERP» = pedido CONFIRMADO aún local.

## Requisitos EARS

### REQ-LIQ-05
WHEN el comercial pulsa Guardar en liquidación diaria
THE SYSTEM SHALL persistir ingreso banco + entregado en `JAVIER.TEST_LIQUIDACION_COMERCIAL`
AND THE SYSTEM SHALL NOT escribir `DSEDAC.LQD` ni ninguna tabla DSEDAC.

### REQ-LIQ-06
WHEN `REPARTO_TABLE_SET` no es `isolated_test`
THE SYSTEM SHALL rechazar la persistencia de liquidación con 409 `WRITES_TEST_ONLY`.

### REQ-DEV-04
WHEN el comercial registra «Devuelve» en TEST
THE SYSTEM SHALL insertar un documento overlay en `JAVIER.TEST_DEVOLUCIONES_COMERCIAL`
AND THE SYSTEM SHALL NOT mutar `DSED.LACLAE` ni `DSEDAC.CVC`/`CPC`.

### REQ-DEV-05
WHEN se lista el día
THE SYSTEM SHALL unir devoluciones ERP (`DSED.LACLAE`) con el overlay TEST
AND THE SYSTEM SHALL NO restar esas devoluciones de `LQD.IMPORTETOTALAINGRESAR` (sin doble resta).

### REQ-PED-01
WHEN un pedido se confirma con export ERP apagado
THE SYSTEM SHALL dejar el pedido en buffer TEST (`JAVIER.TEST_PEDIDOS_CAB`)
AND THE SYSTEM SHALL mostrar chip «Pendiente ERP»
AND THE SYSTEM SHALL NOT fingir albarán de almacén.

### REQ-COB-01
WHEN el comercial registra un cobro en isolated_test
THE SYSTEM SHALL insertar en `JAVIER.TEST_COBROS` (nunca DSEDAC.CRC/CVC).

### REQ-PERF-01
WHEN `GET /api/cobros/:cliente/pendientes` consulta deuda
THE SYSTEM SHALL leer `DSEDAC.CVC` (nunca `JAVIER.VISTA_DEUDA_BASE`)
AND THE SYSTEM SHALL usar SQL parametrizado
AND THE SYSTEM SHALL apuntar a p95 < 500 ms o una mejora sustancial respecto a ~7.4 s.

### REQ-PED-02
WHEN un pedido TEST se crea con descuento de línea o de pie
THE SYSTEM SHALL persistir `PEDIDOS_LIN.PORCENTAJEDESCUENTO` y `PEDIDOS_CAB.PORCENTAJEDESCUENTO1` (además de `DESCUENTO_LINEA` / `DESCUENTO_GLOBAL`)
AND THE SYSTEM SHALL devolver esos porcentajes en el detalle del pedido.

### REQ-DEV-06
WHEN el comercial pulsa Devuelve sobre una factura cobrada con pagaré (`DSEDAC.FPG.PAGARESN='S'` o código PG/P1)
THE SYSTEM SHALL registrar overlay TEST con `YA_COBRADA=1` e `IMPACTO_LQD=YA_COBRADOS`
AND THE SYSTEM SHALL NOT restar esa devolución de `DSEDAC.LQD.IMPORTETOTALAINGRESAR`
AND THE SYSTEM SHALL NOT tratarla como factura impagada a 30 días.
