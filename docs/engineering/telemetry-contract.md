# Contrato de telemetría RUM

La telemetría RUM es observabilidad best-effort y no participa en reglas de
negocio. No confirma una entrega ni debe bloquear una acción del usuario.

## Cliente

El cliente emite únicamente `screen`, `endpoint`, `method`, `status`, `t_req`,
`t_resp`, `t_parsed`, `t_render`, `bytes` y `net`. Los textos se reducen a las
categorías permitidas antes de retenerlos; las métricas son números finitos.
Los tiempos opcionales sin medida se omiten; `status` y `bytes` admiten `null`.
`rid` sólo se acepta en el servidor por compatibilidad con clientes anteriores
y se descarta antes de registrar. El transporte rechaza estructuras anidadas.
Al encolar, captura un mapa superficial
inmutable y entrega al sender una lista y mapas inmutables, de modo que mutaciones
posteriores del consumidor no alteran una solicitud.

La cola conserva hasta 200 eventos pendientes. Durante una solicitud puede haber
un lote independiente de hasta 50 eventos en vuelo. El transporte envía lotes
FIFO de hasta 50 y como máximo cuatro por flush.

La entrega es best-effort: overflow, `reset`, cierre de proceso o pérdida de red
pueden descartar eventos. Si el servidor recibe un lote pero la respuesta se
pierde, el reintento puede duplicarlo. No hay garantía exactly-once ni
at-least-once persistente.

## Servidor

`POST /api/telemetry/rum` acepta entre 1 y 50 eventos. `status` es un entero de
100 a 599 o `null`; `bytes` es un entero no negativo o `null`. Un payload fuera
del allowlist estricto devuelve `400 INVALID_RUM_PAYLOAD`. Los campos numéricos
usan semántica nullish para conservar `0` en los logs.

Las dimensiones textuales se agrupan antes de la cola y del logger; se pierde
detalle por operación deliberadamente. El UUID del servidor agrupa sólo un lote.

## Privacidad de dimensiones

Antes de retener y antes de registrar, endpoint, pantalla, método y red se
reducen a grupos fijos. Se pierde detalle deliberadamente por operación: nunca
se emiten segmentos, query, fragmentos, `rid`, usuario ni request ID del cliente.
El servidor crea un UUID por lote sólo para agrupar sus eventos. Los números son
controlados por el cliente y esta política no impide canales encubiertos ni
sanea otros logs del sistema.
