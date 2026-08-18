---
name: obsidian-wiki
version: 1.0.0
description: Orchestrador principal del wiki Obsidian para GMP App Mobilidad. Enruta trabajo a sub-skills (ingest, query, lint, synthesize, inbox-triage, vault-health) y gestiona el vault del equipo.
triggers:
  - "wiki"
  - "obsidian"
  - "vault"
  - "knowledge base"
  - "documentar en wiki"
  - "actualizar wiki"
  - "/wiki"
tools:
  - obsidian-capture
  - obsidian_search
  - obsidian_list
  - obsidian_property
  - obsidian_graph
  - read
  - glob
integrates_with:
  - wiki-ingest
  - wiki-query
  - wiki-lint
  - inbox-triage
  - weekly-synthesis
  - vault-health
---

# obsidian-wiki — Orchestrador del Vault

Skill principal que coordina la gestión del knowledge base Obsidian del equipo GMP.

## Vault canonical

- Path: `$OBSIDIAN_GMP_VAULT` o `C:\Users\Javier\Obsidian\GMP-Team`
- Estructura AI-first:
  ```
  vault/
  ├── 00_Inbox/          # Capturas sin procesar
  ├── 01_Sources/        # Fuentes procesadas
  ├── 02_Wiki/           # Páginas conceptuales enlazadas
  ├── 09_Index/          # Índice maestro (index.md)
  ├── 10_Decisions/      # Decisiones arquitectónicas
  ├── 20_Runbooks/       # Procedimientos operativos
  ├── 30_Retros/         # Retrospectivas
  ├── 40_TechRadar/      # Radar tecnológico
  └── 50_AgentTeam/      # Notas del equipo de agentes
  ```

## Enrutamiento

| Intención | Sub-skill |
|-----------|-----------|
| Guardar/crear página desde fuente | `wiki-ingest` |
| Buscar/responder pregunta | `wiki-query` |
| Health check / calidad | `wiki-lint` |
| Procesar captura cruda | `inbox-triage` |
| Extraer insights semanales | `weekly-synthesis` |
| Dashboard de salud global | `vault-health` |

## Inicialización / adopción

Si el vault no existe o está vacío:

1. Crear estructura de carpetas
2. Crear `09_Index/index.md` con frontmatter y tabla de contenidos
3. Crear página `02_Wiki/GMP-App-Mobilidad.md` como nodo raíz
4. Verificar que `.obsidian/app.json` existe

```bash
# Verificar vault
if (-not (Test-Path "$env:OBSIDIAN_GMP_VAULT")) {
  New-Item -ItemType Directory -Path "$env:OBSIDIAN_GMP_VAULT\00_Inbox" -Force
  New-Item -ItemType Directory -Path "$env:OBSIDIAN_GMP_VAULT\02_Wiki" -Force
  New-Item -ItemType Directory -Path "$env:OBSIDIAN_GMP_VAULT\09_Index" -Force
}
```

## Integración con obsidian-mcp

Cuando el servidor `obsidian-mcp` está disponible:

- `obsidian_search` → búsqueda semántica en el vault
- `obsidian_list` → listar archivos por carpeta/patrón
- `obsidian_property` → leer/escribir frontmatter YAML
- `obsidian_graph` → grafo de backlinks y forward links

Fallback sin obsidian-mcp: usar `read`, `glob`, y `grep` sobre el filesystem.

## Ejemplo

```
Usuario: "Equipo, documenta el nuevo flujo de autenticación en la wiki"

1. Detectar intención: crear página conceptual
2. Delegar a wiki-ingest con fuente = descripción del flujo
3. wiki-ingest crea 02-Wiki/auth-flow.md con wikilinks
4. Actualiza 09-Index/index.md
5. Retornar: página creada + enlaces relacionados
```

## Reglas

- Toda página nueva DEBE tener frontmatter YAML (created, kind, source, tags)
- Los wikilinks usan formato `[[nombre-pagina]]` (no markdown links)
- No duplicar información: si la entidad ya existe, actualizar, no crear
- Referenciar siempre la fuente en `source:` del frontmatter
