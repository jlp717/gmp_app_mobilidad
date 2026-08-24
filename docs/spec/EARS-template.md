# EARS Template

## WHEN / IF / WHILE / WHERE

```
WHEN <evento/condicion> THE system SHALL <respuesta observable>
IF <condicion> THEN THE system SHALL <respuesta>
WHILE <estado> THE system SHALL <respuesta>
WHERE <feature> THE system SHALL <respuesta>
```

Ejemplos gmp:
```
WHEN un repartidor confirma entrega THE system SHALL crear cobro pendiente idempotente y actualizar VISTA_DEUDA_BASE
IF autenticacion falla THEN THE system SHALL responder 401 con error tipado sin exponer detalle interno
WHILE offline THE system SHALL servir cache local y encolar escritura como borrador pendiente
```

Cada EARS mapea 1:1 a caso de test.
