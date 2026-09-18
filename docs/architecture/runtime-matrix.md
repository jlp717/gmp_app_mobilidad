# Matriz estática de runtime

Este artefacto se genera con `node backend/scripts/extract-runtime-matrix.cjs .` desde la raíz del repositorio. Lee archivos como texto y AST de TypeScript; no importa `backend/app.js`, no carga variables de entorno, ni abre red, DB2, Redis, listeners o jobs. Antes de cualquier lectura rechaza nombres protegidos (`.env*`, claves, tokens, credenciales y configuración MCP), rutas fuera de la raíz y enlaces simbólicos.

La comprobación aislada usa `node --test backend/scripts/tests/runtime-route-matrix.test.cjs`. Está fuera de `backend/__tests__` para que el runner Jest legacy no intente cargar una suite de `node:test`.

La salida distingue tres inventarios:

- `static-declared`: mounts de `backend/app.js`, routers y factories que el AST puede seguir.
- `consumer-declared`: llamadas Flutter literales, dinámicas o no soportadas; la salida dinámica contiene sólo localizador y razón, nunca el texto de la expresión o el cuerpo de un handler.
- `openapi-declared`: paths del contrato OpenAPI.

Los únicos modos soportados son `legacy` (`USE_TS_ROUTES=false`, `USE_DDD_ROUTES=false`) y `ddd` (`USE_TS_ROUTES=false`, `USE_DDD_ROUTES=true`). TypeScript routes está retirado por `backend/config/reparto-runtime.js`.

`potentialOverlaps`, `unresolved-factory`, `dynamic-mount-path` y condiciones desconocidas son hallazgos de inventario, no decisiones de propiedad ni vulnerabilidades. Las condiciones se serializan como árbol de `known-ddd`, `known-ts`, `not`, `and`, `or` o `unknown`, con localizador; nunca se publica su texto fuente ni literales. Esta matriz no es observación de runtime ni prueba autorización por objeto. FND-05 permanece pendiente de composición aislada y de la matriz SEC-03 de acción, objeto y rol.
