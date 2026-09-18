# Baseline de pruebas

## FND-04 — reloj determinista de confirmaciones

La validación local de `occurredAt` usa un reloj UTC inyectable por instancia.
En producción, si no se proporciona, usa el reloj UTC real. El límite permanece
inclusivo: se acepta `now + 5 minutos` y se rechaza cualquier instante posterior.

Las pruebas cubren el límite exacto, un microsegundo posterior, un timestamp
offline histórico y los cambios horarios europeos de primavera y otoño mediante
instantes UTC. El reloj es sólo una dependencia de validación: no aparece en el
payload serializado ni en la huella material/idempotente.

## QA-04A / ARCH-04A — política de caché de promociones

La normalización CHAR(10) del cliente, la clave de caché PMR y la regla de no
reutilizar listas vacías viven en una política pura de dominio. Provider y banner
comparten esa política sin acoplarla a Flutter, Riverpod, API ni I/O. El banner
mantiene su dependencia del provider para cargar el pedido actual; no cambian su
TTL, carga ni renderizado.

## OPS-01A — transporte RUM acotado

El transporte RUM es best-effort y volátil: conserva como máximo 200 eventos
pendientes, mientras un lote separado de hasta 50 puede estar en vuelo. Los
fallos conservan el lote y los pendientes dentro de la retención reciente, pero
overflow, reset y cierre de proceso pueden perder eventos. Una respuesta perdida
después de la recepción puede producir un reintento duplicado.

## Caracterización adicional sin dispositivo ni servicios

El 18 de septiembre, Flutter ejecutó tres archivos existentes con `test --no-pub`, exit0, 20 pruebas en total. La separación de perfiles se mantiene:

- Comercial: seis pruebas de `test/features/liquidacion_comercial/domain/liquidacion_domain_test.dart` caracterizan parseo de importes, tolerancia y devoluciones ya cobradas. No certifican conciliación en el ERP.
- Reparto: cuatro pruebas de `test/features/repartidor/data/reparto_offline_capture_test.dart` y diez de `reparto_deferred_confirmation_test.dart` caracterizan captura offline, referencias de evidencia y huella material con stores/uploader sintéticos. No validan envío real, impresora ni experiencia móvil.

No se modificaron estos tests para obtener el resultado y no se agregan sus cifras a una supuesta cobertura global.
