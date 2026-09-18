# Baseline de pruebas

## FND-04 — reloj determinista de confirmaciones

La validación local de `occurredAt` usa un reloj UTC inyectable por instancia.
En producción, si no se proporciona, usa el reloj UTC real. El límite permanece
inclusivo: se acepta `now + 5 minutos` y se rechaza cualquier instante posterior.

Las pruebas cubren el límite exacto, un microsegundo posterior, un timestamp
offline histórico y los cambios horarios europeos de primavera y otoño mediante
instantes UTC. El reloj es sólo una dependencia de validación: no aparece en el
payload serializado ni en la huella material/idempotente.
