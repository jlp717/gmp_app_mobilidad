---
name: wiki-ingest
version: 1.0.0
description: Convierte fuentes (URLs, notas, código) en páginas wiki enlazadas en el vault Obsidian. Extrae conceptos clave, entidades y decisiones; actualiza el índice; mueve fuentes procesadas.
triggers:
  - "ingresar a wiki"
  - "documentar"
  - "crear página wiki"
  - "procesar fuente"
  - "/wiki-ingest"
tools:
  - obsidian-capture
  - obsidian_search
  - obsidian_property
  - read
  - webfetch
  - edit
integrates_with:
  - obsidian-wiki
  - wiki-query
  - inbox-triage
---

# wiki-ingest — Ingesta de fuentes al wiki

Transforma una fuente (URL, nota en inbox, fragmento de código, decisión verbal) en una o más páginas wiki enlazadas.

## Flujo

1. **Leer fuente**
   - Si es URL → `webfetch(url)` para obtener contenido
   - Si es archivo local → `read(path)`
   - Si es texto directo → usar como-is

2. **Extraer entidades**
   - Conceptos clave (nombres propios, patrones, arquitecturas)
   - Decisiones tomadas (ADR implícitas)
   - Relaciones entre entidades (A depende de B, C reemplaza D)
   - Tags relevantes (máximo 5)

3. **Buscar páginas existentes**
   - Usar `obsidian_search` o `glob` para verificar si la entidad ya tiene página
   - Si existe → actualizar con nueva información
   - Si no existe → crear nueva página

4. **Crear/actualizar página**
   - Path: `02-Wiki/<nombre-normalizado>.md`
   - Frontmatter obligatorio:
     ```yaml
     ---
     created: 2026-08-10T12:00:00Z
     updated: 2026-08-10T12:00:00Z
     kind: concept | decision | architecture | pattern | runbook
     source: <URL o descripción de la fuente>
     tags: [auth, flutter, riverpod]
     ---
     ```
   - Cuerpo: resumen + secciones + wikilinks a entidades relacionadas

5. **Crear wikilinks**
   - Por cada entidad mencionada: `[[entidad]]` si tiene página, o `[[entidad|nuevo]]` si se creó
   - Backlinks: agregar enlace a la página fuente

6. **Actualizar índice**
   - Editar `09-Index/index.md`: agregar entrada en la sección correspondiente
   - Mantener orden alfabético dentro de cada sección

7. **Mover fuente procesada**
   - Si la fuente estaba en `00-Inbox/`, mover a `01-Sources/` con prefijo `processed-`

## Ejemplo

```
Fuente: "Decidimos migrar de ChangeNotifier a Riverpod en comisiones"

1. Extraer: Riverpod, ChangeNotifier, comisiones, migración de estado
2. Buscar: [[riverpod-state]] → existe, [[comisiones-feature]] → existe
3. Crear/actualizar: 02-Wiki/migracion-estado-comisiones.md
4. Wikilinks: [[riverpod-state]], [[comisiones-feature]], [[auth-flow]]
5. Índice: agregar bajo "Arquitectura > Estado"
6. Fuente: mover de 00-Inbox a 01-Sources
```

## Reglas

- Máximo 1 página por entidad (no fragmentar)
- Si la página ya existe y el contenido nuevo es menor al 20% del existente → append con `## Update YYYY-MM-DD`
- No crear páginas vacías (mínimo 3 líneas de contenido)
- Los tags deben ser lowercase, sin espacios, en inglés o español consistente
- Fuente procesada NUNCA se borra: se mueve a `01-Sources/`
