# Plan maestro de profesionalización GMP

**Entrega: auditoría y plan de implementación; no implementación ni despliegue.** Fecha: 18-09-2026. Referencia: rama `test`, HEAD auditado `0e3912abda4f27c261449440a4f52752429e96b7`, más cambios locales concurrentes que se han preservado.

El objetivo es transformar una aplicación funcional en un producto mantenible, seguro, medible y operable. La estrategia es conservar las garantías que ya funcionan, cubrirlas con pruebas y migrar por dominios pequeños. No se propone una reescritura integral ni una migración tecnológica por estética.

Este paquete contiene **57 tareas ejecutables**, **63 hechos trazables**, un inventario recursivo y criterios de cierre. Cada tarea indica dependencias, archivos existentes/propuestos, requisito EARS, pasos ordenados, aceptación, reversión y autorizaciones. Los estados del backlog son TODO: escribir un plan no completa sus tareas.

## Lectura y ejecución

| Documento | Propósito |
|---|---|
| [01 — Evidencia](01-audit-evidence.md) | Qué se observó y qué queda sin demostrar. |
| [02 — Arquitectura y decisiones](02-architecture.md) | Destino, límites y estrategia de migración. |
| [03 — Seguridad](03-security.md) | Amenazas, controles, pruebas negativas y límites humanos. |
| [04 — Datos, caché y rendimiento](04-data-cache-performance.md) | Invariantes, frescura, carga y mediciones. |
| [05 — Backlog completo](05-implementation-backlog.md) | Instrucciones detalladas de las 57 tareas y orden calculado. |
| [06 — Verificación y release](06-verification-release.md) | Comandos existentes/propuestos, matrices y gates. |
| [07 — Inventario y limpieza](07-repository-cleanup.md) | Tratamiento de todos los árboles y limpieza segura. |
| [08 — Instrucciones para otra IA](08-executor.md) | Protocolo listo para copiar y ejecutar por tarea. |
| [09 — Verificación de esta entrega](09-verification-report.md) | Resultados reales, limitaciones y publicación. |
| [10 — Fuentes oficiales](10-sources.md) | Documentación externa comprobada durante la auditoría. |

Datos para herramientas: [backlog.json](backlog.json), [evidence.json](evidence.json), [inventory-summary.json](inventory-summary.json). Validador del plan: [validate-plan.py](validate-plan.py).

## Diagnóstico principal

1. **La calidad automática no es aún una única señal fiable.** Hay versiones Flutter distintas, controles tolerados con `continue-on-error`/`|| true`, un placeholder de cobertura y Jest con salida forzada. El gate de la skill no resolvió lanzadores Windows. Hay que estabilizar medición y gates antes del refactor amplio.
2. **Existen varias implementaciones backend y capas de caché superpuestas.** Primero se cartografía el runtime real y se prueba paridad; después se consolida por dominio. Un flag puede cambiar el código que se ejecuta.
3. **Dinero y evidencia merecen su propio contrato.** Confirmación y liquidación ya tienen mecanismos transaccionales e idempotentes valiosos. Se conservarán, extendiendo pruebas de concurrencia, recuperación y recibos.
4. **La seguridad debe verificarse por amenaza.** Hay ownership, sesiones revocables, cifrado y límites. También permisos Android amplios, límites de IA por formalizar y una garantía de pinning incorrectamente descrita en el código. No se ha demostrado explotación ni se ha hecho pentest.
5. **Observabilidad y operación tienen huecos concretos.** Archivos de Prometheus/Tempo/Grafana/k6 casi vacíos no prueban un sistema operativo de métricas, carga o recuperación.
6. **La limpieza exige clasificar, no borrar masivamente.** La carpeta física contiene dependencias, builds, Git, herramientas y estado local. El repositorio público requiere un tratamiento distinto de los datos privados.
7. **Hay deuda documental y de gobernanza.** README no describe fielmente el arranque actual; decisiones de versionado del kernel de agentes se contradicen entre documentos y fechas. Resolver intención antes de modificar ignores.

## Evidencia de alcance

El censo recorrió **35.371 directorios y 220.997 archivos físicos**, con **2.070 archivos rastreados por Git**. Se registraron 31 archivos protegidos solo por metadatos y 29 enlaces/reparse points sin seguir sus destinos. No hubo errores de acceso en el recorrido.

Se inspeccionó contenido de código/configuración por riesgo en cinco áreas, con agentes de solo lectura. Esto **no significa que se hayan leído todas las líneas de todos los archivos**, ni auditado semánticamente cada dependencia instalada. Los inventarios completos locales quedan fuera de Git porque el repositorio es público; el anexo publicado conserva paths aprobados y agregados del resto.

El working tree pasó de 29 a 35 archivos ajenos modificados durante la captura. No se modificaron, revirtieron ni publicaron esos cambios desde esta tarea. Antes de ejecutar el plan hay que recapturar el SHA y estado.

## Primeras barreras

Empezar por `FND-01`; después los paquetes listos de toolchain, gates, reloj/pruebas, matriz runtime e inventario. **El orden exacto se calcula por dependencias**, no por el orden de párrafos ni el número de fase.

La ejecución inicial acotada de Flutter dio **14 passed / 1 failed** por `occurredAt` futuro en una prueba de confirmación; `dart analyze lib` dio **exit 2**, con 0 errores, 4 warnings y 6.551 infos. La sincronización de harness dio **exit 1** por cuatro skills faltantes. Esto impide declarar el proyecto verificado; son entradas del plan, no fallos corregidos aquí.

`npm audit --omit=dev` informó 4 avisos moderados y 1 bajo, sin altos/críticos en ese alcance. No sustituye revisión de código, dependencias de desarrollo, móvil ni pentest.

## Cómo se gestionará el trabajo

- Una tarea es un paquete; las de tamaño L se dividen en slices con un solo objetivo y diff revisable. S/M/L son estimaciones preliminares, no un compromiso de calendario.
- Se permite lectura/revisión en paralelo; un único writer concurrente sobre código compartido. Las decisiones de seguridad, negocio y arquitectura se revisan independientemente.
- Toda implementación requiere spec EARS aprobada y gate correspondiente. No se aprueban automáticamente las especificaciones propuestas de este documento.
- Dinero, auth, DDL/DML, secretos, producción y eliminación tienen límites explícitos. Un bloque humano detiene su rama, mientras otras tareas independientes pueden continuar.
- Cada slice recorre DISCOVER → PLAN → EXECUTE → VERIFY → ITERATE. Máximo tres reparaciones; dos rondas sin progreso obligan a parar y explicar causa.
- El cierre profesional exige evidencia del commit exacto, incluido dispositivo/entorno donde corresponda. Ningún sistema permite prometer ausencia absoluta de vulnerabilidades.

La prioridad inicial es **confianza en los cambios**: baseline, pruebas y contratos. Después vienen consolidación, rendimiento y limpieza; la promoción profesional se cierra con observabilidad, restauración y validación adversarial.
