# Límites de confianza y evidencia de seguridad

Modelo de trabajo SEC-01, pendiente de la matriz completa de endpoints y de las decisiones de `docs/adr/security-policy-decisions.md`. Baseline: `test@710fede`. Se conserva la distinción entre control observado, prueba con dobles, integración real y verificación en dispositivo. Ninguna combinación demuestra ausencia absoluta de vulnerabilidades.

## Activos y fronteras

| Activo / frontera | Riesgo principal | Control observado y verificación requerida |
|---|---|---|
| Credenciales → sesión | Suplantación, fuerza bruta, enumeración | Validación y limitadores existentes. Medir contrato, errores y rate limits sin credenciales reales. |
| Token → claims de API | Claims antiguos, cambio de sujeto/rol, sesión revocada | `verifyToken` exige firma, sid/sub/jti, versión canónica y sesión activa; producción requiere Redis. Probar fallos del store y que el handler no se alcanza. |
| Usuario → vendedor/flota/documento | Acceso a objetos ajenos pese a token válido | Scopes y guards existentes no sustituyen la matriz endpoint/acción/objeto. Probar A/B, ALL, equipo 80 y reparto por separado. |
| HTTP/TLS → móvil | Intercepción, downgrade, excepción debug en release | Resolver la política de transporte y probar handshakes. El comparador de pins aislado no demuestra enforcement. |
| Comando offline → confirmación | Repetición, cambio de payload, reloj incorrecto | Journal, fingerprints e idempotencia existentes; FND-04 mantiene contrato temporal. Probar conflictos, reintentos y recuperación sin perder evidencia. |
| API → DB2 | Inyección, escritura ERP no permitida, carrera monetaria | Binding obligatorio, destinos TEST y protecciones existentes. No modificar db.js; catálogo, locks, rollback y driver requieren pruebas autorizadas. |
| Commit → correo/WhatsApp/artefacto | Duplicados, destinatario erróneo, path traversal, fuga | Contratos de evidencia y outbox existentes requieren verificación de autorización y recuperación. En tests usar sink/dobles; nunca enviar documentos reales. |
| Caché → siguiente sesión/rol | Lectura cruzada o saldo obsoleto | Segmentación y exclusión financiera existentes. Probar cambios de usuario/rol y read-your-writes; conservar offline legítimo. |
| Repositorio/PR → CI | Inyección de scripts, dependencia comprometida, secretos en logs | Pines exactos y runner redactado; pendiente eliminar interpolaciones de eventos en código, revisar instalación y cobertura del scanner. |
| Telemetría → operador/tercero | Datos personales, tokens, firma o documentos en logs | Minimización y redacción por campo; no registrar cuerpos completos. Política de retención requiere decisión de negocio competente. |

## Contrato de pruebas de autorización

Para cada acción se registrarán identidad, rol/modo, scope firmado, objeto, resultado esperado y side effects permitidos. Los casos negativos deben comprobar tanto HTTP 401/403/404 según contrato como cero invocaciones al servicio/escritura. Un mock completo de `verifyToken` prueba la proyección de una ruta, no la autenticación.

Las sesiones tienen controles útiles que se preservan: revocación al cambiar claims, rotación compare-and-set, transición de rol y ausencia de fallback a memoria en producción. La prueba heredada de `/auth/validate` usa claimsVersion3 mientras el resolver canónico declara4; deberá usar la constante y mantenerse separada de las pruebas reales del middleware.

## Límites operativos

La suite hermética bloqueará red, procesos, drivers y cargadores de entorno antes de imports. Contratos HTTP con loopback, integración DB2 y pruebas móviles tendrán carriles separados con autorizaciones y evidencias propias. Un resultado unitario no habilita producción. Quedan fuera de esta ejecución la rotación de secretos, cambios de certificados reales, DDL/DML, pentest remoto y despliegue.
