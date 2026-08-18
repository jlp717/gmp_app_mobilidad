---
name: inbox-triage
version: 1.0.0
description: Clasificación inicial de capturas crudas en 00-Inbox/. Lee archivos, los tipifica (decisión, lección, fuente, diario), extrae metadata, crea wikilinks iniciales y los ruta a la carpeta correcta del vault.
triggers:
  - "procesar inbox"
  - "clasificar notas"
  - "triaje capturas"
  - "/inbox-triage"
  - "/inbox"
tools:
  - obsidian_list
  - obsidian_property
  - read
  - glob
  - obsidian-capture
integrates_with:
  - obsidian-wiki
  - wiki-ingest
---

# inbox-triage — Triaje de capturas

Procesa archivos crudos en `00-Inbox/` y los distribuye al vault con clasificación y metadata.

## Flujo

1. **Listar inbox**
   - `glob("00-Inbox/**/*.md")` para encontrar capturas pendientes
   - Ignorar archivos ya procesados (prefijo `processed-`)

2. **Leer y clasificar**
   Para cada archivo:
   - Leer contenido (primeras 50 líneas suficientes para clasificar)
   - Clasificar por tipo:

   | Tipo | Señales | Destino |
   |------|---------|---------|
   | `decision` | "decidimos", "se aprobó", "elegimos X sobre Y" | `10-Decisions/` |
   | `lesson` | "aprendí", "error", "no volver a", "lección" | `02-Wiki/` (como patrón) |
   | `source` | URL, referencia externa, RFC | `01-Sources/` |
   | `daily` | Fecha, log de día, briefing | `50-AgentTeam/` |
   | `runbook` | Pasos, procedimiento, cómo-hacer | `20-Runbooks/` |
   | `retro` | Retrospectiva, qué funcionó, mejora | `30-Retros/` |

3. **Extraer metadata**
   - Título: primera línea `#` o nombre de archivo
   - Fecha: del frontmatter o del nombre de archivo (prefijo timestamp)
   - Tags: extraer keywords del contenido (max 5)
   - Entidades: nombres propios, módulos, tecnologías mencionadas

4. **Enriquecer frontmatter**
   Agregar/actualizar YAML:
   ```yaml
   ---
   created: <fecha>
   kind: <tipo-clasificado>
   source: <origen>
   tags: [tag1, tag2]
   processed: true
   ---
   ```

5. **Crear wikilinks iniciales**
   - Por cada entidad detectada: insertar `[[entidad]]` en el contenido
   - Si la entidad no existe aún, crear redlink (lo indica como pendiente)

6. **Mover a destino**
   - Mover archivo de `00-Inbox/` a la carpeta destino correspondiente
   - Renomear si es necesario: eliminar timestamp del nombre si ya está en frontmatter

7. **Reportar**
   Resumen del triaje:
   ```
   Procesados: 5 archivos
   - 2 decisiones → 10-Decisions/
   - 1 lección → 02-Wiki/
   - 1 source → 01-Sources/
   - 1 daily → 50-AgentTeam/
   ```

## Ejemplo

```
Archivo: 00-Inbox/20260810120000-error-odbc-connection.md
Contenido: "Hoy falló la conexión ODBC por timeout. Aprendí que hay que
           configurar connectionTimeout en el pool."

1. Clasificar: `lesson` (señal: "aprendí")
2. Metadata: título="ODBC Connection Timeout Lesson", tags=[odbc, db2, error-handling]
3. Wikilinks: [[db2-connection-pool]], [[error-handling-pattern]]
4. Destino: 02-Wiki/odbc-timeout-lesson.md
5. Mover y renombrar
```

## Reglas

- No eliminar contenido durante el triaje
- Si la clasificación es ambigua → marcar `kind: uncategorized` y mover a `00-Inbox/uncategorized/`
- Procesar máximo 10 archivos por invocación (evitar timeouts)
- Si un archivo tiene `processed: true` en frontmatter → saltar
