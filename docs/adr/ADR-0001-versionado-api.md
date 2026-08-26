# ADR-0001: Versionado de la API por URI

- Estado: Aceptado
- Fecha: 2026-08-26

## Contexto

La API Express actual publica contratos bajo `/api` sin versión explícita. Cambiar esos contratos en sitio rompería clientes móviles desplegados.

## Decisión

Endpoints nuevos usarán `/api/v1`. Endpoints actuales sin prefijo de versión permanecen bajo `/api` como **legacy congelado**: solo correcciones compatibles, seguridad y operación; no se añaden cambios incompatibles.

Una retirada seguirá este proceso:

1. Anunciar alternativa y migración.
2. Marcar endpoint con `X-Deprecated: true`, `Deprecation` y `Sunset: <fecha HTTP>`.
3. Mantener mínimo 90 días entre anuncio y `Sunset`.
4. Eliminar después de `Sunset`, tras verificar que clientes soportados ya migraron.

## Consecuencias

- Clientes actuales mantienen compatibilidad.
- Cambios incompatibles exigen ruta versionada nueva.
- Toda deprecación queda observable por cabeceras y tiene ventana mínima de migración.
