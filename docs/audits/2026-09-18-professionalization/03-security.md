# Seguridad verificable

## Qué significa seguro en este plan

El objetivo es reducir probabilidad e impacto de ataques, detectar abuso y recuperar el servicio. No existe garantía de resistencia ante cualquier atacante ni ausencia eterna de vulnerabilidades. La evidencia se liga a versión, configuración, entorno y fecha.

Se propone ASVS5.0.0 L2 como base de backend, con controles adicionales elegidos por riesgo, y MASVS/MASTG para móvil. Son marcos de verificación, no certificaciones obtenidas por usar este plan. Consultar [fuentes oficiales](10-sources.md).

## Activos, adversarios y fronteras

Activos prioritarios: sesiones/roles; clientes/contactos; dinero, deuda y cierres; DNI/firmas/fotos/ubicación; PDFs/recibos; credenciales de integraciones; disponibilidad DB2; historial de auditoría; artefactos de release y cadena de build.

Considerar al menos: atacante anónimo, usuario autenticado que intenta salir de su ámbito, dispositivo perdido/compartido, red hostil, dependencia/runner comprometido, input malicioso en PDF/CSV/IA, operador con permisos excesivos y error de configuración.

No asumir que una IP privada, User-Agent, menú oculto, firma móvil o cifrado local autorizan una operación de backend. La autorización debe aplicarse en cada objeto/acción y en cada job/herramienta que actúe en nombre de alguien.

## Matriz mínima de amenazas

| Amenaza | Control requerido | Prueba de aceptación | Paquetes |
|---|---|---|---|
| Acceso a documento de otro vendedor/repartidor | Policy objeto-acción con identidad verificada y repositorio scoped. | Matriz A/B, ALL/equipo, detalle/PDF/export/envío; side effect no llamado al denegar. | SEC-03 |
| Robo/replay de token | Claims/propósito/expiración/revocación/rotación y refresh atómico. | Token revocado, futuro, otro tipo/audiencia, refresh repetido/concurrente. | SEC-02 |
| Inyección SQL o schema no permitido | Valores bind; identificadores allowlist; mínimos grants. | Input hostil no modifica SQL, destino o conjunto de datos. | DATA-01 |
| Doble cobro o cierre tras timeout | Idempotencia persistida, clave de negocio y reconciliación. | Concurrencia, commit con respuesta perdida y replay tras reinicio. | FIN-03 |
| Cache entre usuarios o entornos | Clave con scope/versiones y lifecycle de sesión. | Dos usuarios/modos/entornos jamás comparten body, ETag o cola. | CACHE-01/02 |
| Ataque de archivo, traversal o documento remoto | Límites, tipos reales, root permitida y autorización previa. | MIME falso, tamaño/píxeles, ruta absoluta/../symlink, URL interna no autorizada. | SEC-10 |
| Abuso de PDF/email/IA/DB2 | Cuotas por operación, deadlines, concurrency y límites de payload. | Ráfaga produce429 antes de consumir proveedor/DB; libera recursos. | SEC-04/07 |
| Prompt injection | Tools con permisos propios, schemas y datos sin autoridad. | Texto recuperado no amplía scope, no ejecuta shell/SQL ni instruye efectos. | SEC-07 |
| PII en logs, exports o repo | Allowlist/redacción, acceso/retención y datos sintéticos. | Canary sintético ausente en sinks/artefactos públicos. | SEC-09/REP-02 |
| Intercepción/red TLS | Validación real de plataforma y política pinning exacta si se aprueba. | Certificados inválidos y pin incorrecto según ADR en dispositivo. | SEC-05 |
| Móvil comprometido o permisos excesivos | Mínimo permiso, almacenamiento seguro y scope local. | Release manifest, denegación/revocación, logout y dispositivo compartido. | SEC-06 |
| Supply chain/release adulterada | Locks, acciones fijadas, permisos CI, SBOM y artefacto firmado. | Build de PR no accede secretos; hash/firma/provenance verificables. | SEC-08/OPS-03 |
| Pérdida de datos o indisponibilidad | Backups/restore, límites, aislamiento, alertas y procedimientos. | Restore/game day aislados con RPO/RTO e invariantes comprobados. | OPS-02/04/07 |

## Hallazgo de TLS que necesita precisión

La implementación observada configura `HttpClient.badCertificateCallback`. Según la [documentación de Dart](https://api.dart.dev/dart-io/HttpClient/badCertificateCallback.html), ese callback decide sobre un certificado que no ha podido autenticarse con las raíces de confianza. Por ello no garantiza comparar el pin cuando la cadena ya es válida. Además, devolver true puede aceptar la conexión que falló validación.

No se ejecutó un MITM ni se probó un bypass en campo. La conclusión comprobada es que el mecanismo no sustenta el comentario de pinning adicional en todos los handshakes.

SEC-05 debe leer el ADR existente y decidir entre TLS de plataforma correctamente descrito o pinning real, viable con rotación. No se prescribe un interruptor remoto que desactive la confianza, ni se cambia un certificado/clave durante la auditoría.

## Auth e intocables

El MAC propio no prueba por sí mismo una vulnerabilidad. Sí exige un contrato explícito y revisión de claims/tiempo/propósito. Se conservan las sesiones activas/revocables y la compatibilidad de alias de vendedor. Ningún agente edita `backend/middleware/auth.js` ni `backend/config/db.js`: prepara evidencia, tests y propuesta; Javier aplica manualmente cualquier cambio.

Las mejoras de autorización de objetos y pruebas no necesitan esperar a una reescritura de autenticación. Así se evita convertir un bloque humano en una excusa para posponer todos los controles.

## Datos y comunicaciones

Separar datos de diagnóstico, trazabilidad financiera y evidencia de entrega. Definir para cada clase finalidad, propietario, quién accede, retención, formato y borrado. No establecer plazos legales inventados: la decisión se toma con negocio y responsable de privacidad.

El cifrado local ayuda ante acceso al almacenamiento, pero no corrige una autorización defectuosa ni un dispositivo activo bajo otro usuario. El logout/cambio de rol debe detener envíos, limpiar datos recuperables según política y conservar de forma protegida los comandos pendientes que deban reconciliarse.

Correo/WhatsApp/PDF requieren autorización del documento, destinatarios validados y trazabilidad. En TEST se construye to/cc completo y el transporte usa sink/allowlist. La prueba no contacta bandejas ERP ni números reales.

## Cadena de suministro y repositorio público

El repositorio es público. No subir logs, dumps, CSV de operación, adjuntos, capturas con PII, settings de usuario ni inventarios de rutas locales privadas. Los ejemplos deben ser sintéticos. Retirar un archivo de HEAD no borra su historia ni revoca un secreto.

Los secretos no se abren ni se copian para completar un plan. Si se descubre un valor real en una fuente permitida, parar su difusión, señalar ubicación/categoría y solicitar rotación humana mediante el procedimiento de incidente. No publicar la coincidencia ni reescribir historial sin autorización.

Un scanner sin hallazgos no verifica lógica de negocio ni garantiza seguridad. Se combinan SAST, SCA, secret scan redactado, tests negativos, revisión humana/independiente y pentest autorizado.

## Gates y alcance humano

Antes de staging: pruebas de auth/scope, input, datos/side effects, cache, SQL, logging y dependencia. Antes de producción: staging QA + AppSec + health, aprobación específica con TTL y postcheck.

Pentest/DAST/carga solo sobre entorno y cuentas expresamente autorizados. No usar el plan como permiso para probar producción. Las notificaciones a personas, cambios de reglas canónicas, secretos, grants DB2, DDL/DML, producción y borrado tienen autorización específica.

Una excepción de riesgo debe tener ID concreto, evidencia, alcance, compensación, responsable y vencimiento. No sirve una excepción global como “ignorar SAST hasta más adelante”. Los hallazgos de alto impacto reproducidos bloquean el alcance afectado hasta resolverlos.
