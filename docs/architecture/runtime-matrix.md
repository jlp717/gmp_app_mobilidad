# Matriz estática de runtime

Este artefacto se genera con `node backend/scripts/extract-runtime-matrix.cjs .` desde la raíz del repositorio. Lee archivos como texto y AST de TypeScript; no importa `backend/app.js`, no carga variables de entorno, ni abre red, DB2, Redis, listeners o jobs. Antes de cualquier lectura rechaza nombres protegidos (`.env*`, claves, tokens, credenciales y configuración MCP), rutas fuera de la raíz y enlaces simbólicos.

La comprobación aislada usa `node --test backend/scripts/tests/runtime-route-matrix.test.cjs`. Está fuera de `backend/__tests__` para que el runner Jest legacy no intente cargar una suite de `node:test`.

La salida distingue tres inventarios:

- `static-declared`: mounts de `backend/app.js`, routers y factories que el AST puede seguir.
- `consumer-declared`: llamadas Flutter literales, dinámicas o no soportadas; la salida dinámica contiene sólo localizador y razón, nunca el texto de la expresión o el cuerpo de un handler.
- `openapi-declared`: paths del contrato OpenAPI.

Los únicos modos soportados son `legacy` (`USE_TS_ROUTES=false`, `USE_DDD_ROUTES=false`) y `ddd` (`USE_TS_ROUTES=false`, `USE_DDD_ROUTES=true`). TypeScript routes está retirado por `backend/config/reparto-runtime.js`.

`potentialOverlaps`, `unresolved-factory`, `dynamic-mount-path` y condiciones desconocidas son hallazgos de inventario, no decisiones de propiedad ni vulnerabilidades. Las condiciones se serializan como árbol de `known-ddd`, `known-ts`, `not`, `and`, `or` o `unknown`, con localizador; nunca se publica su texto fuente ni literales. Esta matriz no es observación de runtime ni prueba autorización por objeto. FND-05 permanece pendiente de composición aislada y de la matriz SEC-03 de acción, objeto y rol.

## Composición raíz bajo dobles

`node --test backend/scripts/tests/runtime-app-composition.test.cjs` carga `backend/app.js` real con Express real, sin cargar `server.js`. El harness permite ejecutar solamente `app.js`, `config/reparto-runtime.js` y `config/g4-dsedac-erp-mapping.js`; cada import local restante se resuelve contra una allowlist cerrada de dobles etiquetados. Cualquier import local nuevo falla antes de ejecutarse.

La observación registra las llamadas raíz `app.use` y `app.get` por orden y referencia de función. Comprueba los guardas parentales de reparto, el único router financiero canónico, la autenticación DDD seguida de su fallback legacy, y la elección exclusiva de pedidos y cobros para cada modo. Los dobles no ejecutan handlers ni leaf routers. Por tanto, esta evidencia es `composition-observed-under-doubles`, no `runtimeObserved` y no certifica autorización por endpoint, método u objeto.

Antes de la carga el harness valida con `lstat` la raíz, ancestros y los tres módulos de producto permitidos; rechaza enlaces y cualquier nombre con prefijo `.env` (incluido `.envfoo`), claves, tokens o credenciales. La entrada es un selector cerrado: `app.js` o una fixture sintética enumerada. Bloquea imports de red, listeners, `fetch` y procesos síncronos/asíncronos. `loadComposedApp` devuelve un snapshot inerte tras restaurar siempre en `finally` el loader, caché de módulos afectada, instrumentación de Express, `process.env` y Sentry global; el consumidor no debe cerrar estado temporal. El runner no abre un puerto, no carga `.env`, no inicia DB2/Redis/correo/jobs y no ejecuta solicitudes HTTP.

Los fallbacks de `clients`, `commissions` y `products` permanecen intencionalmente pendientes de contratos leaf y de la matriz SEC-03. Los routers simulados sólo prueban que la composición de la raíz mantiene sus mounts y orden.
