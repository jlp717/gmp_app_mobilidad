# Inventario y limpieza segura

Censo físico recursivo terminado sin errores de acceso: **35.371 directorios, 220.997 archivos, 12.303.890.473 bytes lógicos (~11,46 GiB), 2.070 archivos tracked**. No es espacio recuperable: incluye Git, dependencias, builds, SDKs y estado útil. No mide compresión ni bloques reales de disco.

## Qué contiene cada inventario

- [inventory-summary.json](inventory-summary.json): fecha, SHA, totales y categorías heurísticas.
- [directory-inventory.csv](directory-inventory.csv): 569 directorios publicables, metadatos directos y tratamiento.
- [owned-file-inventory.csv](owned-file-inventory.csv): 2.008 paths rastreados y publicables, tamaño y clasificación. El nombre no certifica autoría: puede incluir vendor/derivados.
- [top-level-inventory.json](top-level-inventory.json): agregados de todos los árboles raíz, incluidos los excluidos de publicación.

El repositorio GitHub es público. Los inventarios completos están reservados localmente en `.codex/graph-runs/2026-09-18-professionalization/full-directory-inventory.csv` y `full-owned-file-inventory.csv`. No se suben listas de archivos privados/ignorados. Las 34.802 filas de directorio no publicadas se contabilizan en los totales; no significan carpetas no censadas. Los 29 reparse points se registraron sin seguir destinos externos; sus destinos no están dentro del alcance. Los 31 archivos protegidos no se leyeron.

La categorización automática es una preclasificación. Un subárbol runtime puede contener dependencias; las cifras por categoría usan precedencia explícita. Ninguna categoría autoriza borrado. El censo excluye el directorio de esta entrega para no contarse a sí mismo.

## Cobertura por cada árbol raíz

| Árbol | Directorios | Archivos físicos | MiB lógicos | Tratamiento propuesto |
|---|---:|---:|---:|---|
| `.` | 1 | 33 | 0.72 | Raíz: manifiestos, entrada y configuración mínima; outputs/temporales fuera; secretos solo referencia. |
| `.agent` | 2 | 2 | 0.00 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.agents` | 16 | 22 | 0.09 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.beads` | 10 | 202 | 14.94 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `.claude` | 48 | 77 | 0.15 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.cline` | 40 | 70 | 0.33 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.clinerules` | 1 | 12 | 0.02 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.codex` | 43 | 522 | 2.94 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.codex-remote-attachments` | 5 | 4 | 0.29 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `.continue` | 13 | 22 | 0.08 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.cursor` | 4 | 7 | 0.30 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.dart_tool` | 20 | 120 | 715.68 | Generado/dependencias: fuera de Git; reproducir antes de cualquier limpieza local aprobada. |
| `.git` | 837 | 45612 | 967.30 | Gestionado por Git; no borrar ni reorganizar manualmente. |
| `.github` | 4 | 21 | 0.13 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.husky` | 2 | 20 | 0.00 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.idea` | 3 | 5 | 0.00 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.obsidian` | 5 | 16 | 2.41 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `.omo` | 2 | 3 | 0.00 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.openclaw` | 2 | 2 | 0.00 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.opencode` | 354 | 4073 | 82.51 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.opencode-legacy` | 4336 | 17180 | 321.30 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `.opencode-runtime` | 3935 | 17551 | 5469.75 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `.qoder` | 14 | 22 | 0.08 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.qwen` | 13 | 23 | 0.08 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.remember` | 5 | 361 | 2.20 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `.semgrep` | 1 | 1 | 0.00 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.swarm` | 32 | 61 | 2.52 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `.trae` | 12 | 18 | 0.07 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.venv` | 355 | 2956 | 70.29 | Generado/dependencias: fuera de Git; reproducir antes de cualquier limpieza local aprobada. |
| `.vscode` | 1 | 1 | 0.00 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `.windsurf` | 13 | 22 | 0.08 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `android` | 46 | 58 | 29.25 | Plataforma: declarar soporte, preservar scaffolds; debug separado de release; secretos fuera. |
| `assets` | 6 | 12 | 3.29 | Producto/datos: conservar; refactor vertical con contratos. Revisar generated/tmp dentro de cada subárbol. |
| `backend` | 3477 | 26453 | 351.06 | Producto/datos: conservar; refactor vertical con contratos. Revisar generated/tmp dentro de cada subárbol. |
| `build` | 9208 | 17365 | 1406.90 | Generado/dependencias: fuera de Git; reproducir antes de cualquier limpieza local aprobada. |
| `coverage` | 1 | 1 | 0.25 | Generado/dependencias: fuera de Git; reproducir antes de cualquier limpieza local aprobada. |
| `db` | 2 | 2 | 0.00 | Producto/datos: conservar; refactor vertical con contratos. Revisar generated/tmp dentro de cada subárbol. |
| `docs` | 33 | 193 | 14.83 | Vigencia/owner/sucesor; evidencia histórica inmutable y privacidad revisada. |
| `handoffs` | 1 | 2 | 0.00 | Vigencia/owner/sucesor; evidencia histórica inmutable y privacidad revisada. |
| `integration_test` | 2 | 3 | 0.02 | Conservar; clasificar unit/widget/contract/e2e y fixtures sintéticas. |
| `ios` | 16 | 51 | 0.31 | Plataforma: declarar soporte, preservar scaffolds; debug separado de release; secretos fuera. |
| `ipex_ollama` | 2485 | 7732 | 176.33 | Herramienta auxiliar: demostrar consumidor y soporte; separar entorno/dependencias; no borrar automáticamente. |
| `lib` | 144 | 316 | 5.66 | Producto/datos: conservar; refactor vertical con contratos. Revisar generated/tmp dentro de cada subárbol. |
| `linux` | 5 | 10 | 0.02 | Plataforma: declarar soporte, preservar scaffolds; debug separado de release; secretos fuera. |
| `logs` | 2 | 26 | 0.19 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `macos` | 16 | 30 | 0.22 | Plataforma: declarar soporte, preservar scaffolds; debug separado de release; secretos fuera. |
| `memory-bank` | 1 | 6 | 0.00 | Vigencia/owner/sucesor; evidencia histórica inmutable y privacidad revisada. |
| `node_modules` | 596 | 4181 | 59.61 | Generado/dependencias: fuera de Git; reproducir antes de cualquier limpieza local aprobada. |
| `observability` | 6 | 8 | 0.01 | Herramientas: separar readonly/TEST/admin, validar config real y guards. |
| `pixel-agents` | 1527 | 14778 | 166.64 | Herramienta auxiliar: demostrar consumidor y soporte; separar entorno/dependencias; no borrar automáticamente. |
| `scripts` | 28 | 111 | 0.72 | Herramientas: separar readonly/TEST/admin, validar config real y guards. |
| `skills` | 7 | 14 | 0.04 | Configuración/agentes/IDE: fuente canónica frente a derivado/local; allowlist antes de versionar o retirar. |
| `test` | 48 | 123 | 0.66 | Conservar; clasificar unit/widget/contract/e2e y fixtures sintéticas. |
| `tool` | 5 | 5 | 0.02 | Herramientas: separar readonly/TEST/admin, validar config real y guards. |
| `uploads` | 2 | 0 | 0.00 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `vault` | 11 | 27 | 0.02 | Estado/artefactos/legado: clasificar en privado, retención y propietario; nunca publicar contenidos por limpieza. |
| `venv` | 7559 | 60423 | 1863.48 | Generado/dependencias: fuera de Git; reproducir antes de cualquier limpieza local aprobada. |
| `web` | 2 | 8 | 0.04 | Plataforma: declarar soporte, preservar scaffolds; debug separado de release; secretos fuera. |
| `windows` | 6 | 18 | 0.07 | Plataforma: declarar soporte, preservar scaffolds; debug separado de release; secretos fuera. |

## Procedimiento por archivo/carpeta candidato

1. Registrar path absoluto resuelto, estado Git, propietario, propósito, sensibilidad, fuente de reproducción y SHA/hash si procede. No abrir archivos prohibidos.
2. Buscar referencias estáticas con rg/git grep y revisar imports dinámicos, assets/pubspec, workflows, scripts, mounts y documentación vigente. Referencias cero no prueba por sí sola falta de uso runtime.
3. Clasificar: conservar; refactorizar en sitio; generar desde fuente; archivar evidencia; retirar del índice conservando copia local; eliminar solo con autorización específica.
4. Proponer destino y diff revisable. Si contiene datos/adjuntos/operaciones, cuarentena privada aprobada: no moverlo a docs/archive público. No añadir árboles ignorados completos con git add -f.
5. Aplicar un lote pequeño con un único writer. No mezclar movimiento mecánico, cambio funcional y actualización de dependencias. No usar git clean/reset ni borrar worktrees.
6. Actualizar imports/manifiestos/docs; ejecutar tests/build/links pertinentes y comparar comportamiento. Revisión independiente y commit reversible.
7. Comprobar desde checkout limpio que todos los inputs requeridos son versionados o reproducibles. Mantener evidencia necesaria y revisar retención con propietario.

## Estructura objetivo mínima

```text
/                         manifiestos, README, AGENTS, configuración raíz
lib/core/                 transversal, independiente de features
lib/features/<feature>/   data/domain/providers/presentation
backend/routes/           validación, autorización y delegación
backend/services/         reglas y casos de uso
backend/repositories/     consultas y persistencia
backend/adapters/         integraciones externas cuando proceda
backend/src/modules/      módulos existentes; consolidación mediante ADR, no movimiento automático
test/ integration_test/   pruebas Flutter
backend/__tests__/ tests/ lanes Jest explícitas, sin duplicar discovery
scripts/ tool/            herramientas portables, admin separado
docs/spec/ adr/           requisitos y decisiones vigentes
docs/operations/          procedimientos y recuperación
docs/audits/              evidencia fechada y redactada
assets/ plataformas/      recursos y proyectos soportados
```

`backend/adapters/` es una ubicación propuesta si el dominio la requiere; no implica crear carpetas vacías ni mover DB2 fuera de la propiedad backend. Carpetas SDK/plataforma no se renombran por estética.

## Cierre de limpieza

El objetivo de limpio es intención y reproducción, no cero archivos locales ni borrar evidencias. El árbol de entrega debe tener solo cambios propios previstos y no depender de cachés/herramientas ignoradas del equipo de Javier. Retirar algo del HEAD público no sanea el historial; si se descubre información sensible, activar SEC-08/OPS-07 con acción humana específica.
