---
name: wiki-query
version: 1.0.0
description: Responde preguntas buscando evidencia en el vault Obsidian. Usa búsqueda por keyword y recorrido de grafo (backlinks, forward links) para dar respuestas grounded con citas de fuente.
triggers:
  - "qué dice el wiki sobre"
  - "buscar en el vault"
  - "quién decidió"
  - "por qué se migró"
  - "/wiki-query"
  - "/wiki-q"
tools:
  - obsidian_search
  - obsidian_graph
  - obsidian_list
  - obsidian_property
  - read
  - grep
  - glob
integrates_with:
  - obsidian-wiki
  - wiki-ingest
  - vault-health
---

# wiki-query — Consulta del wiki

Responde preguntas del usuario usando solo evidencia del vault. Nunca inventar información: si no está en el vault, decir "no encontrado en el vault".

## Flujo

1. **Clasificar pregunta**
   - Hecho puntual: "¿Qué puerto usa el backend?"
   - Relación: "¿Qué módulos dependen de auth?"
   - Temporal: "¿Cuándo se decidió X?"
   - Comparativo: "¿Cuál es la diferencia entre X e Y?"

2. **Búsqueda primaria**
   - `obsidian_search(query)` → páginas relevantes
   - Fallback: `glob("**/*.md")` + `grep(pattern, path="vault/")`

3. **Expandir con grafo**
   - Si una página es relevante → `obsidian_graph` para backlinks y forward links
   - Fallback: buscar `[[nombre-pagina]]` en otras páginas con `grep`

4. **Leer evidencia**
   - `read` de las páginas top-3 más relevantes
   - Extraer párrafos que contengan keywords de la pregunta

5. **Sintetizar respuesta**
   - Respuesta directa (1-3 oraciones)
   - Citación: `[[pagina]]` + extracto relevante
   - Confianza: alta (múltiples fuentes), media (una fuente), baja (inferencia)

6. **Reportar si no hay evidencia**
   - "No encontrado en el vault. ¿Deseas que lo ingrese como nueva información?"
   - Sugerir usar `wiki-ingest` para documentar

## Ejemplos

```
Q: "¿Por qué no usamos Supabase?"
R: Según [[decisiones-db2-vs-supabase]]: "DB2/AS400 es el sistema transaccional
   existente. No introducir PostgreSQL ni Supabase sin orden explícita."
   → Confianza: alta. Backlinks: [[arquitectura-backend]], [[reglas-inmutables]]

Q: "¿Quién es el dueño del módulo de cobros?"
R: No encontrado en el vault. ¿Deseas que lo documente?
```

## Reglas

- Toda respuesta DEBE incluir al menos un wikilink como cita
- Si la evidencia es contradictoria entre páginas → reportar ambas con timestamps
- No responder con conocimiento externo: solo vault
- Si la pregunta es ambigua → pedir clarificación antes de buscar
- Máximo 5 páginas leídas por consulta (eficiencia)
