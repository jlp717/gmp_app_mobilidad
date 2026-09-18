# Decisiones pendientes para seguridad y reproducción

Estado: propuesta concreta, no aplicada. Fecha: 2026-09-18. Estas decisiones cambian compatibilidad o reglas canónicas y necesitan respuesta de Javier. No autorizan producción, acceso a claves, DB2 ni cambios a los dos archivos intocables.

## 1. Transporte de las aplicaciones publicadas

Situación observada: `ApiClient` comprueba pins desde `HttpClient.badCertificateCallback`. Dart llama a ese callback cuando falla la confianza de la cadena; no aplica el pin a todas las conexiones válidas. Además, la configuración Android principal y `ApiConfig` permiten HTTP para una IP LAN, también en release. La revisión es estática; no demuestra una explotación ni el estado de una instalación concreta.

Propuesta recomendada: exigir HTTPS en release, confiar en la validación del sistema y, cuando se habilite pinning nativo con material de rotación aprobado, exigir también coincidencia del pin. Un pin nunca permitirá aceptar una cadena inválida. La excepción HTTP se limitará a debug y loopback/emulador; web documentará la confianza del navegador. Ninguna release que dependa hoy de HTTP LAN se promocionará sin preparar su endpoint HTTPS.

Archivos afectados tras aprobación: `lib/core/api/api_config.dart`, `lib/core/api/api_client.dart`, `lib/core/security/certificate_pinning.dart`, configuración XML Android main/debug y tests de política. No se fijarán certificados ni valores de pins inventados. El mecanismo de pinning debe probarse con handshake nativo; los mocks no acreditan su eficacia.

Aceptación: cadena válida/pin correcto acepta; válida/pin incorrecto rechaza; inválida rechaza incluso con pin coincidente; pin requerido ausente bloquea; debug local no se cuela en release. Pruebas de rotación activo/sucesor y revisión de Android/iOS antes de distribuir. Si falta un entorno o dispositivo, el gate correspondiente continúa pendiente.

Fuente: [semántica oficial de badCertificateCallback](https://api.dart.dev/dart-io/HttpClient/badCertificateCallback.html).

## 2. Perfil financiero sin alcance de vendedores

Situación observada: `resolveVendorScope` permite ALL o códigos solicitados si el perfil financiero tiene `visibleCodes` vacío. El resolver canónico de claims exige actualmente un conjunto no vacío; por tanto, no se ha demostrado un acceso explotable mediante un login canónico. Sigue existiendo una interpretación permisiva de un estado inválido en una capa posterior.

Propuesta recomendada: un perfil financiero sin alcance firmado obtiene `empty_scope`/403. Se conservan el ALL eficiente del jefe con catálogo de veinte o más vendedores, el alcance del equipo 80 y el vendedor propio comercial. Un catálogo de DB temporalmente vacío no elimina los códigos firmados ni fuerza expandir ALL a una lista larga.

Archivos afectados: `backend/middleware/vendor-scope.js` y pruebas de scope/dashboard; ninguna edición de `backend/middleware/auth.js`. Antes de aplicar, confirmar que no existe un perfil de negocio legítimo cuyo conjunto vacío signifique acceso global. Tests: ALL, vendedor explícito, mezcla propia/ajena, líder 80 y jefe con catálogo amplio; toda denegación debe impedir llamar al servicio.

## 3. Gobernanza reproducible desde Git

Situación observada: AGENTS exige reglas, memoria, sincronizador y políticas que el bloque final de `.gitignore` excluye. Un checkout limpio no puede reproducir esas comprobaciones. La decisión de septiembre contradice la especificación de agosto; no se decide por antigüedad ni se publica el árbol local completo.

Propuesta recomendada: versionar un kernel mínimo revisado y sus herramientas deterministas; conservar ignorados estado, credenciales, caches, instalaciones y material personal. Preparar una allowlist exacta y revisar contenido antes de añadirlo. Actualizar las referencias de AGENTS y los workflows para que cada entrada requerida exista o se genere de forma documentada. No ejecutar `git add -f` de árboles de asistentes completos.

La aprobación de esta política permitiría preparar el lote mínimo; no aprueba automáticamente todo archivo local ni su publicación. La regla canónica de AGENTS exige confirmar cambios permanentes antes de editarla. Los gates con entradas ausentes seguirán mostrando WARN/BLOCKED mientras se resuelve.

## Independencia de las decisiones

Cada decisión puede aceptarse o modificarse por separado. Mientras están pendientes, se pueden completar refactors que preservan comportamiento, pruebas aisladas y controles de CI. El estado de estas propuestas nunca se usará como un gate de aprobación de producción.
