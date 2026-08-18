---
name: weekly-synthesis
version: 1.0.0
description: Extrae significado de ventanas temporales (última semana). Lee diarios, identifica patrones recurrentes, actualiza páginas conceptuales y genera reporte de conocimiento semanal con sugerencias de conexiones.
triggers:
  - "síntesis semanal"
  - "resumen de la semana"
  - "qué aprendimos"
  - "patrones recurrentes"
  - "/weekly-synthesis"
  - "/wiki-weekly"
tools:
  - obsidian_search
  - obsidian_list
  - obsidian_graph
  - obsidian_property
  - read
  - grep
  - glob
  - obsidian-capture
integrates_with:
  - obsidian-wiki
  - wiki-ingest
  - wiki-query
---

# weekly-synthesis — Síntesis de conocimiento semanal

Procesa los diarios y notas de la última semana para extraer patrones, actualizar conceptos y descubrir conexiones.

## Flujo

1. **Recolectar ventana temporal**
   - `glob("50-AgentTeam/*.md")` y otros archivos con fecha en la última semana
   - Filtrar por `created` o `updated` en frontmatter (rango: hoy-7d a hoy)

2. **Leer y extraer insights**
   Para cada archivo:
   - Leer contenido completo
   - Extraer:
     - Problemas resueltos
     - Lecciones aprendidas
     - Decisiones tomadas
     - Preguntas pendientes
     - Tecnologías/procesos mencionados repetidamente

3. **Identificar patrones**
   Agrapar insights por tema:
   - Mismo problema mencionado 2+ veces → patrón recurrente
   - Misma tecnología en contextos diferentes → posible generalización
   - Problema sin resolver → candidato a investigación

4. **Actualizar páginas conceptuales**
   - Para cada patrón → buscar página wiki relacionada con `obsidian_search`
   - Si existe → append `## Week YYYY-MM-DD` con nuevo insight
   - Si no existe → sugerir creación via `wiki-ingest`

5. **Generar reporte**
   Crear página `50-AgentTeam/YYYYMMDD-Weekly-Synthesis.md`:

   ```markdown
   ---
   created: <fecha>
   kind: synthesis
   source: auto-generated
   tags: [weekly, synthesis]
   ---

   # Weekly Synthesis — Semana YYYY-MM-DD

   ## Patrones recurrentes
   - **ODBC timeouts**: mencionados 3 veces. Acción: revisar pool config.
   - **Rebuild excesivo en Flutter**: 2 reportes. Acción: auditar providers.

   ## Decisiones de la semana
   - [[migracion-riverpod]] → aprobada para módulo cobros

   ## Lecciones aprendidas
   - [[lesson-odbc-timeout]]

   ## Conexiones sugeridas
   - [[db2-connection-pool]] ←→ [[error-handling-pattern]] (crear enlace)

   ## Preguntas abiertas
   - ¿Migrar reparto a Riverpod también?
   ```

6. **Sugerir conexiones**
   Detectar pares de páginas que mencionan el mismo tema pero no están enlazadas.

## Ejemplo

```
Usuario: "Equipo, síntesis de esta semana"

1. Recolectar: 12 archivos de la última semana
2. Patrones: "ODBC timeout" (3x), "rebuild" (2x), "staging deploy" (4x)
3. Actualizar: [[db2-connection-pool]] + nuevo insight sobre timeout
4. Sugerir: conectar [[staging-deploy]] con [[rollback-procedure]]
5. Reporte: 5 patrones, 3 decisiones, 2 conexiones sugeridas
```

## Reglas

- No modificar archivos originales (solo crear/actualizar síntesis)
- Los insights deben citar la fuente con wikilink
- Si no hay actividad en la semana → reportar "sin actividad registrada"
- La síntesis es acumulativa: no sobrescribir semanas anteriores
- Máximo 20 archivos procesados por síntesis
