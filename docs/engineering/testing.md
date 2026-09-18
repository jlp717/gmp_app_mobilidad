# Carriles de prueba

`npm test` sigue siendo el runner heredado y no certifica aislamiento. No se modifica por QA-01A.

## Unitarias aisladas

Desde `backend`, ejecutar `npm run test:unit:isolated`. La configuración contiene una allowlist explícita de suites de producto revisadas y fixtures de guard/contrato. Antes de importar producto bloquea sockets, HTTP/HTTPS, UDP, `fetch`, `listen`, procesos hijos, drivers DB/Redis/correo y el cargador de entorno. No usa `forceExit` ni permite una selección vacía.

La selección no representa cobertura global. Una suite nueva sólo entra tras revisar sus imports y pasar bajo el guard.

La ampliación SEC-02A añade contratos directos de autenticación: middleware y tokens reales, resolver, store de sesión y login handler con dobles inyectados. La ruta `/auth/validate` se compone en memoria desde el router real; los contratos HTTP con Supertest siguen fuera de este carril.

El guard evita E/S accidental de módulos de producto durante este carril; no es un sandbox para código hostil. Parte de una allowlist mínima de variables operativas del host y entrega al VM sólo valores sintéticos de prueba. Captura los entornos host y VM antes de modificarlos y los restaura exactamente al terminar. La configuración fija el compilador TypeScript y `tsconfig` de `backend`, por lo que el mismo comando funciona invocado desde la raíz o desde `backend`.

## Filesystem, HTTP e integración

Las pruebas que escriben en un directorio temporal requieren un carril de filesystem con raíz por worker. Las pruebas Express/Supertest pertenecen a un carril HTTP loopback explícito: Supertest puede abrir un listener y por eso no entra en la lane aislada. DB2, correo, Redis y procesos de arranque requieren carriles opt-in separados, identidad sintética/autorizada y cierre explícito.

## Negativos del harness

La fixture del carril prueba cada familia bloqueada y el import de un módulo de producto posterior al setup. Para comprobar una selección vacía, ejecutar Jest con esta configuración y un `--testPathPattern` que no coincida; el resultado debe ser distinto de cero. No ejecutar contra la suite heredada ni contra integración para realizar esa prueba.
