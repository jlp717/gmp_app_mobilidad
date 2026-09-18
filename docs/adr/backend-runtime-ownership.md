# ADR: propiedad de composición del runtime backend

## Estado

Aceptado para el slice FND-05B tras dos revisiones independientes. Siete pruebas de composición y ocho del inventario AST pasan con Node 24. La aceptación se limita al contrato bajo dobles descrito aquí.

## Decisión

La composición de `backend/app.js` se prueba mediante un harness de registro hermético. Ejecuta solamente el módulo de composición y la configuración pura de selección de rutas. Express es real para preservar su semántica de registro, mientras que cada dependencia de infraestructura y cada router leaf es un doble explícito y etiquetado.

El loader rechaza cualquier import local no declarado y bloquea módulos que puedan abrir red, listeners, `fetch` o procesos. La entrada no es una ruta libre: sólo puede ser `app.js` o una fixture sintética enumerada. Antes de importar valida con `lstat` la raíz, sus ancestros y los módulos de producto permitidos; enlaces y nombres protegidos fallan cerrados. El harness no importa `backend/server.js`, no carga archivos de entorno y no invoca handlers registrados. Captura identidad y orden de los mounts raíz para legacy y DDD; el modo TypeScript retirado debe fallar antes de infraestructura.

## Consecuencias

La prueba cubre guardas parentales, selección de familia, fallbacks y duplicación de mounts de composición. `loadComposedApp` restaura siempre su estado temporal antes de devolver el snapshot; el llamador no recibe una operación de cierre. No acredita las rutas internas de un router simulado ni la autorización de un recurso concreto. Esa evidencia sigue en contratos por router y en SEC-03. Los cambios de importación de app.js deben actualizar deliberadamente la allowlist, para que la prueba falle de forma visible antes de ejecutar una dependencia nueva.
