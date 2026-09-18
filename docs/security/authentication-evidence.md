# Evidencia de autenticación aislada

El carril `npm run test:unit:isolated` ejecuta contratos directos sobre el middleware real de autenticación, el resolver de claims, el store de sesiones y el login handler con repositorios y Redis sintéticos. No abre listeners ni conecta DB2, Redis o correo.

Los contratos cubren firma inválida, expiración, identidad canónica `sid`/`sub`/`jti`, versión de claims vigente, revocación y el mapeo de dependencia de sesión no disponible. Cada rechazo comprueba que no se ejecuta `next`.

`/auth/validate` se inspecciona desde el router real y se invoca en memoria: su primer handler debe ser `verifyToken` real y sólo proyecta datos después de una sesión canónica activa. La prueba de proyección con versión `0` es deliberadamente directa; no declara que un token con versión histórica sea aceptado.

El store canónico en modo memoria no permite inyectar un fallo interno por su API pública. La prueba de 503 cubre el mapeo del error tipado de dependencia; la indisponibilidad real del store se cubre mediante sus dobles inyectados en `auth-claims-session-store.test.js`.

Verificación de integración el 18 de septiembre: 25 suites/476 pruebas pasan con las fuentes y configuración actualizadas en una instalación física de las dependencias nuevas, exit0. Las tres suites añadidas de autenticación aportan 60 pruebas dirigidas. El middleware y la configuración DB protegidos permanecen sin modificaciones.
