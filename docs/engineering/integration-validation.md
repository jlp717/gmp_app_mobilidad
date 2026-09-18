# Integración de la base de profesionalización

Fecha: 2026-09-18. Estado: integración local verificada; publicación y CI remoto se registran por separado. Este informe no cierra las 57 tareas del plan ni autoriza producción.

## Referencias y resolución

- Base de la ejecución: `test@710fedec1bf3135443b546b3ea6cb78004f0a133`.
- Bundle propio revisado: `d156d56`, precedido por los commits de reloj, inventario, runner y limpieza registrados en [implementation-progress.md](implementation-progress.md).
- Cambios publicados de reparto incorporados: `be466bba8c010e25d0ee40b5ee45cc690ec06b44`, mediante merge normal.
- `AGENTS.md` y `pubspec.yaml` conservan exactamente el contenido de ese upstream. El checkout original queda fuera de esta integración.
- Único conflicto textual: `test/features/repartidor/data/reparto_confirmation_request_contract_test.dart`. Se conservaron ambos grupos de casos y se añadió el caso combinado de reloj local y preferencias de notificación.

El DTO conserva notificaciones en payload y huella material, observaciones no nulas y la propagación de preferencias durante la preparación persistente. El reloj inyectable sólo afecta la validación temporal: no entra en el payload ni en la huella. No se sustituyó ningún archivo completo por la versión de un solo lado.

## Evidencia del árbol integrado

| Comprobación | Resultado | Alcance |
|---|---|---|
| Jest con `jest.isolated.config.cjs`, Node 24.21.0 y dependencias físicas nuevas | Exit 0; 35 suites, 691 pruebas | Fuentes relevantes copiadas y cotejadas por SHA-256; guard de E/S activo. Dobles de infraestructura. |
| Flutter con `--no-pub`, contratos de reparto y widgets afectados más `test/core/telemetry` | Exit 0; 107 pruebas | Confirmación, journal, notificaciones, cobro, importes, layout y RUM. No dispositivo real. |
| Flutter adicional: modelo de albarán y UI de finanzas de reparto | Exit 0; 25 pruebas | Incluye reparación de tres fixtures y contrato de refresco diferido. |
| Pruebas Node de AST, toolchain, inputs CI, lifecycle y runner | Exit 0; 37 pasan, una omisión específica de POSIX | La omisión no se cuenta como prueba superada. |
| Composición real de `app.js` bajo dobles explícitos | Exit 0; 9 pruebas en ambos árboles | Instalación física y checkout con enlaces; incluye denegación y restauración. |
| `dart analyze lib --format machine` | Exit 0; 0 errores, 0 warnings, 6.535 infos | No se presenta el repositorio como libre de deuda de estilo/mantenimiento. |
| `flutter build web --release --no-pub` | Exit 0; 105 segundos | Build JavaScript. El dry-run de Wasm detecta dependencias incompatibles; no acredita móvil ni Wasm. |
| Revisión independiente | Dos dictámenes PASS y quorum determinista 2 | Unión de cambios, guards y regresiones; no auditoría completa de todos los endpoints. |
| Gate obligatorio de loop | WARN, exit 0 | `git diff --check` y scanner de cambios pasan; launchers Windows y políticas ignoradas no están resueltos por el wrapper. |

El carril Jest vigente se ejecuta desde `backend` con `npm run test:unit:isolated`. Las pruebas de composición se ejecutan desde la raíz con `node --test backend/scripts/tests/runtime-app-composition.test.cjs`. Deben usarse el runtime fijado y una instalación limpia en un directorio físico; no ejecutar `npm ci` a través de enlaces que apunten a otro checkout.

Los números anteriores describen conjuntos concretos que pueden solaparse con pruebas de paquetes anteriores. No expresan cobertura global, pruebas de carga ni seguridad integral.

## Defecto de integración encontrado y corregido

La suite de composición falló inicialmente en la instalación física: tres casos recibían `UNEXPECTED_LOCAL_IMPORT:index.js`. El harness rechazaba los paquetes precargados `cors`, `compression` y `express-rate-limit` porque su resolución física quedaba dentro de `backend/`, antes de llegar a la excepción de paquetes. Un enlace a dependencias fuera de ese directorio ocultaba el defecto.

La reparación permite exclusivamente los cuatro paquetes ya precargados (`express` incluido), solicitados desde el `app.js` canónico, antes de evaluar el rechazo de imports locales. Mantiene los bloqueos de módulos arbitrarios, otros padres, builtins, nombres protegidos y efectos externos. Dos regresiones fuerzan resolución física incluso en el checkout con enlaces y verifican los rechazos. La suite completa pasó en ambos árboles y fue repetida por los dos revisores. Reparación de integración: 1 de un máximo de 3; no reabre el ciclo cerrado del runner FND-03A.

La comprobación adicional de `test/models/albaran_entrega_test.dart` y `test/widget/repartidor_finanzas_ui_test.dart` detectó tres fallos de fixtures: sólo sustituían la instancia `forceRefresh:true`, mientras el primer render usa `false`. El HttpClient de Flutter Test interceptó los intentos no doblados; no se produjo tráfico externo real. Se corrigió exclusivamente el test con overrides de familia que verifican actor y fecha de sesión, manteniendo todas las expectativas de UI. Ahora comprueba la secuencia `false → true → false` al cumplirse los 12 segundos, la ausencia de refresco antes del plazo, el desmontaje y la ausencia de recarga forzada agregada. El comando conjunto pasó 25/25, exit 0. Reparación de integración 2 de 3; no se modifica producto para satisfacer una fixture obsoleta.

## Límites de entrega

Politec completo sigue sin PASS por el contrato textual de readiness y el scanner de fuentes grandes; véase [quality-gates.md](quality-gates.md). El gate de loop no sustituye los comandos explícitos anteriores. No se modifican los archivos protegidos de auth/DB, secretos, DB2, servicios, PM2 o producción. Faltan compatibilidad IBM i real, campo móvil, métricas de rendimiento, staging, CI remoto y decisiones registradas en [security-policy-decisions.md](../adr/security-policy-decisions.md).
