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

## Publicación y primera ejecución remota

La rama se publicó con hooks normales y SHA remoto comprobado `01f22117bddab1d54fe54b2c539ad25e6522510f`. El [PR 42](https://github.com/jlp717/gmp_app_mobilidad/pull/42) está en borrador contra `test`; no hay merge ni despliegue.

En [Foundations 35348409972](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35348409972), el job Linux pasó completo, incluidos instalación, pruebas aisladas, composición y carga nativa sin conexión DB2. Windows falló en una fixture que intentaba insertar un segundo job buscando LF sobre fuente CRLF. La reparación ejecuta las cinco negativas en ambos formatos y exige mutación efectiva. La suite local sigue con nueve casos, ahora cubriendo ambas terminaciones.

El workflow `quality-gates.yml` quedó con `env:` raíz nulo tras centralizar versiones. Se retira ese bloque y el checker pasa a rechazar `env` no mapping en raíz, job y step, sin mostrar sus valores. La [referencia oficial de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#env) define ese campo como mapa. Siete pruebas del checker pasan; esto no pretende validar todo el esquema de Actions. Ambas reparaciones tienen dos revisiones independientes. La nueva ejecución remota se evalúa por su SHA, sin reutilizar un PASS anterior para cambios posteriores.

## Correcciones de CI posteriores

[Foundations 35349381150](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35349381150), correspondiente a `6861581bc299b3d89960d18f45b6b06a00f6b256`, pasó en Windows y Linux. Incluye las 691 pruebas aisladas, los guards, composición y carga de módulos nativos sin conexión DB2. Ese PASS corresponde a ese SHA; los cambios posteriores requieren su propia ejecución.

El canario de aislamiento se descubría también mediante el glob de Jest heredado, sin su entorno de bloqueo. Ahora ese carril excluye exclusivamente `tests/fixtures/hermetic/`; el canario permanece en la lista aislada explícita. Además, falla antes de cualquier import cuando falta el marcador del guard. Una prueba VM verifica cero imports y cuatro pruebas de lifecycle pasan. Los listados de ambos carriles confirman la selección correcta sin ejecutar las suites heredadas localmente. La batería aislada sigue pasando 35 suites y 691 pruebas. Dos revisores independientes aceptan el cambio. El job de lint instala también las dependencias declaradas en raíz, necesarias para su configuración ESLint, con scripts de instalación desactivados en ese paso.

La documentación OpenAPI tenía un ejemplo de login incompatible con su propio schema y un `nullable` redundante en OpenAPI 3.1. Se corrigen únicamente el ejemplo ficticio y ese atributo; se conservan campos obligatorios, `oneOf` objeto/null y seguridad. El endpoint de notificaciones ya estaba documentado y montado: faltaba su archivo en el inventario del test, que ahora se incorpora. Los dos tests estáticos de contrato/calidad pasan bajo el entorno hermético, con los cuatro tests de runtime expresamente fuera de esa ejecución. No se presenta esta comprobación como prueba HTTP ni como ejecución local de Spectral; el workflow remoto mantiene ambas comprobaciones completas.

En `59ad12a`, [Foundations](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35350805876) volvió a pasar en ambos sistemas y el lint backend pasó. [API Docs](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35350805871) pasó los contratos completos; reveló tres warnings históricos de Spectral y drift de Postman. La segunda reparación añade el contacto institucional observado, documenta el éxito condicional y la idempotencia del traslado de día, y mantiene su 503 por defecto. El POST `/pedidos/confirm` retirado conserva 410: una excepción Spectral limitada a esa operación queda ligada a una prueba del callback real extraído por AST, sin importar drivers ni arrancar HTTP. No se inventa un éxito para esa operación. El mecanismo de excepción sigue la [documentación oficial de Spectral](https://github.com/stoplightio/spectral/blob/develop/docs/guides/4d-overrides.md).

Spectral 6.16.3, instalado separadamente sin scripts, ahora termina con exit 0 y cero warnings. Los tests estáticos pasan 3/3 bajo el guard; cuatro runtime permanecen fuera de esa ejecución local. Postman incorpora las operaciones existentes de notificaciones y sugerencia de receptor, además de la clave idempotente de traslado: dos regeneraciones producen SHA-256 idéntico `3dd9ad5f59a5d130e2de509c63561158ad495e6e911ee6dc7adbc175dc4432df`. No se modifica el generador ni se activa ninguna capacidad DB2.

La comparación del carril Jest antiguo contra `test@be466bba` detectó una nueva suite fallida por dos literales de montaje obsoletos, y aserciones de RUM incompatibles con la privacidad implementada. Esos contratos ahora exigen el orden autenticación → guard financiero → invalidación → router, UUID de servidor y ausencia de identidad/correlación crudas. El test de duración usa dos lecturas de reloj concretas y comprueba acumulación exacta, sin esperas. Tres casos pasan bajo el entorno hermético; cuatro pruebas existentes del handler RUM también pasan. Las pruebas HTTP antiguas se dejan para CI remoto; los restantes fallos heredados no se presentan como solucionados.

## Reparación de CI Flutter y recuperación de comprobante

El paquete `tool/gmp_custom_lints` tiene su propio `pubspec.yaml` y lockfile. Ambos workflows Flutter preparan ese paquete con `dart pub get --enforce-lockfile`; el análisis de `tool/` sigue activo y los cambios bajo ese directorio o el workflow `flutter-ci.yml` disparan el carril correspondiente. No se actualiza el lockfile de la aplicación ni se relajan lints.

La liquidación cuyo ledger actual responde `CLOSED` permanece de solo lectura. Si la pantalla todavía no tiene el resultado local, un repartidor individual puede confirmar «Recuperar comprobante». Esa operación reutiliza el token de cierre estable, no crea ingreso bancario y envía `sendEmails:false`; el backend devuelve el replay inmutable antes de escrituras. Al recuperar el resultado, quedan disponibles las acciones PDF existentes. Cancelación o error conservan el estado cerrado y la opción de reintento, sin movimientos ni correo.
