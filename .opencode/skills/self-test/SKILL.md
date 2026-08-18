---
name: self-test
version: 2.0
description: Verificacion automatica post-implementacion para tareas Tier 2/3.
tools: bash, fetch-mcp, ibm-db2-mcp, playwright
trigger: automatic
---

# Self-Test

Se ejecuta tras toda implementacion Tier 2/3. Solo marca una tarea como completada si los checks aplicables pasan o si una limitacion externa queda documentada con causa exacta.

## 1. Identificar Superficie Modificada

- Leer diff: `git diff --name-only`.
- Clasificar archivos: frontend, backend, base de datos, config, docs.
- Ejecutar solo checks proporcionales al cambio.

## 2. Check HTTP

- Para endpoints GET modificados: verificar codigo `200` y shape de respuesta.
- Para POST/PUT/DELETE: usar payload minimo valido y verificar codigo esperado.
- Si el servidor no esta disponible, reportar comando de arranque esperado y error exacto.

## 3. Check Base De Datos

- Para SQL/modelos DB2: usar `ibm-db2-mcp` en modo read-only.
- Verificar que no hay errores SQL ni bloqueos evidentes.
- No ejecutar DDL/DML destructivo.

## 4. Tests Unitarios

- Flutter: `flutter test` o test dirigido.
- Node backend: `npm test` o runner equivalente del paquete.
- Next.js: `npm test`, lint o typecheck segun scripts disponibles.
- Umbral: 0 tests fallidos.

## 5. E2E

- Si hay UI o flujo de usuario: `npx playwright test --reporter=line` o prueba equivalente.
- Capturar ruta de screenshot/trace en fallos.

## 6. Reporte Al Orquestador

```text
Estado: PASS|FAIL
Checks: HTTP=<n/a|ok|fail>, SQL=<n/a|ok|fail>, Unit=<n/a|ok|fail>, E2E=<n/a|ok|fail>
Comandos: <lista>
Fallos: <error exacto, archivo/linea si aplica>
Accion: proceed|return-to-agent|ask-user
```
