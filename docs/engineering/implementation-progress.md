# Estado verificable de la profesionalización

Implementación autorizada por Javier el 18 de septiembre de 2026. Rama `codex/professionalization-implementation-20260918`, basada en `test@710fede` más el plan. El checkout original y sus cambios ajenos se conservan. El plan histórico de `docs/audits/2026-09-18-professionalization/` no se reescribe.

Este documento diferencia paquetes revisados de aceptación integral. **Las 57 tareas no están cerradas y no se ha desplegado a producción.** El [seguimiento estructurado](professionalization-status.json) conserva las dependencias y la aceptación completa de cada tarea.

## Paquetes implementados y revisados

| Paquete | Resultado y evidencia | Límite de la evidencia |
|---|---|---|
| FND-01: aislamiento | Worktree independiente y baseline de cambios ajenos. | No integra cambios concurrentes del checkout original. |
| FND-02: versiones | Node 24.21.0 y Flutter 3.35.6 centralizados; checker con cinco pruebas Windows/Linux y dos revisiones. | IBM i y CI remoto pendientes. La instalación Linux sin scripts no prueba ODBC nativo. |
| FND-03A: runner | Commit `34a00e4`; propaga fallos, limita tiempo/salida y no muestra salida potencialmente sensible. 12 pruebas y una omisión por plataforma en Windows y Linux; dos revisiones. | El gate completo sigue bloqueado por el baseline, como se detalla abajo. |
| FND-04: reloj | Commit `f1b6f55`; reloj UTC inyectable, límite inclusivo y huella/payload conservados. Dos revisiones y pruebas de fronteras temporales. | No valida el flujo en dispositivo. |
| FND-05A/B: runtime | Inventario AST `88d9931` y composición real de app.js bajo dobles explícitos; ocho y siete pruebas respectivamente, dos revisiones. | No ejecuta handlers internos ni acredita autorización por objeto. |
| QA-01A: aislamiento de tests | Guard antes de importar producto, sin forceExit ni selección vacía; tres pruebas de restauración de entorno. | Previene E/S accidental; no es un sandbox para código hostil. |
| CI-I: entradas de workflows | Observador de metadatos de sólo lectura, expresiones fuera de código ejecutable y política YAML. Nueve pruebas y checker; dos revisiones. | No es evidencia de ejecución de GitHub Actions. |
| SEC-08B: dependencias | Instalación física nueva, auditorías raíz/backend sin avisos conocidos; contratos CSV, body-parser y Morgan con TypeScript 5 pasan; dos revisiones. | No descarta vulnerabilidades desconocidas. Los enlaces de dependencias del checkout no se han sustituido. |
| SEC-02A: autenticación | Middleware real y handlers bajo aislamiento; tres suites dirigidas, 60 pruebas. Runbook de Redis corregido; dos revisiones. | Auth y DB protegidos permanecen intactos. No se prueba Redis real. |
| CHAT / QA-F1 | Entrada estricta del chatbot; 17 pruebas nuevas. Ocho suites existentes de finanzas/scope adoptadas sin alterar sus contratos; dos revisiones. Snapshot integrado: 34 suites y 675 pruebas con dependencias nuevas. | Dobles de DB2, transporte y proveedores; no BOLA universal ni transacciones reales. |
| ARCH-04A: promociones | Política pura compartida, sin cambio de TTL/scope. 43 pruebas del paquete; dos revisiones. Dos infos nuevos corregidos y análisis focalizado limpio. | No equivale a refactorizar toda la arquitectura Flutter. |
| OPS-01A: transporte RUM | Cola acotada, lotes de 50, single-flight y mapas inmutables. 13 pruebas Flutter y dos del handler hermético; dos revisiones. | Entrega best-effort: puede perder o duplicar eventos. Privacidad se trata aparte. |
| CACHE-A1 | Invalidación después de autenticación, preservando el montaje financiero canónico y no-store. 34 pruebas de middleware y siete de composición; dos revisiones. | Los intentos autenticados siguen invalidando de forma conservadora; no prueba commit ni BOLA. |
| SEC09-P: privacidad RUM | Categorías fijas, sin IDs ni strings arbitrarios en dimensiones; UUID por lote. Fixture wire compartida Dart/Node y dos revisiones. Análisis de todo telemetry sin incidencias. | Reduce detalle por operación; no impide canales encubiertos numéricos ni sanea otros logs. |
| REP-01A: copias de recuperación | Commit `635e448`; tres copias retiradas sólo del índice, hashes/tamaños locales preservados y reglas exactas de ignore. Dos revisiones. | No borra archivos físicos ni historia de Git. |

Los recuentos describen snapshots o paquetes concretos. No se suman como cobertura global ni se confunden archivos de tests con pruebas ejecutadas.

## Comprobaciones adicionales

- `flutter build web --no-pub --release`: exit 0, salida JavaScript. El dry-run de Wasm señala dependencias incompatibles; no se declara build Wasm ni móvil.
- TypeScript acotado de backend: exit 0; no se presenta como tipado de todo el runtime CommonJS.
- Tres archivos Flutter existentes de liquidación comercial, captura offline y confirmación diferida: 20 pruebas pasan, manteniendo separados los perfiles comercial y reparto.
- Pruebas Node de toolchain, entradas de workflows, lifecycle y runner en el snapshot integrado: 29 pasan y una omisión específica de POSIX en Windows.

## Gates pendientes y límites reales

El gate obligatorio `loop_gate.py --project . --json` devuelve `WARN`, exit 0: no resuelve los launchers npm/Flutter de Windows y faltan dos políticas `.opencode` ignoradas por Git. El exit 0 del wrapper no aprueba los checks omitidos. Las pruebas aplicables se ejecutan explícitamente y se registran aparte; las reglas canónicas no se modifican sin la decisión correspondiente.

Politec mediante el runner alcanzó su deadline de 60 segundos: `BLOCKED/124`; wrapper exit 1. Un intento directo posterior completó con exit 1: exige un patrón textual de `/api/ready` que contradice el contrato público redactado actual, y el scanner bloquea cuatro fuentes de más de 1 MiB. También señala 24 archivos de más de 1.800 líneas. No se ocultaron estos resultados ni se rebajó el gate.

El escáner complementario Gitleaks, con reglas por defecto explícitas, sin exclusiones del proyecto, redacción completa y plazo de 45 segundos por archivo, no encontró coincidencias en `.obsidian/plugins/dataview/main.js` ni en los dos bundles Three.js. En `docs/quality-baseline/eslint-baseline.json` produjo 17 coincidencias `generic-api-key`. La correlación por columnas las sitúa en código y mensajes embebidos de scripts de CI relativos a idempotencia; no se confirmó una credencial real. Los informes se conservan privados y redactados. Esto no convierte en PASS el scanner original ni acredita una auditoría integral de secretos.

La sustitución de enlaces locales de dependencias fue rechazada por el control automático con el único motivo «bloqueado por política». No se aplicó ni se intentó rodear el bloqueo. Las comprobaciones de dependencias nuevas se realizan sobre una instalación física separada, comparando las fuentes relevantes con el worktree.

Quedan pendientes, entre otros, la decisión HTTPS/LAN, la coherencia de políticas de gobernanza, catálogo y transacciones DB2 reales, validación móvil con jefe de ventas en reparto, mediciones de rendimiento en dispositivo, staging y gates de producción. No se han cambiado secretos, DB2, PM2 ni producción. Coste por agente y latencia integral no medidos.

La API del scanner existente también se ejecutó con un límite explícito de 8 MiB por archivo, sin cambiar su CLI ni configuración: exit 1, cero errores de lectura y dos coincidencias en `source` embebido de `backend/tests/setup.js`. La revisión independiente confirmó valores sintéticos de tests, idénticos al setup actual. No se añadieron exclusiones ni se modificó el baseline histórico.
