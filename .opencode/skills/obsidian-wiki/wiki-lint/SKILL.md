---
name: wiki-lint
version: 1.0.0
description: Health check del vault: encuentra wikilinks rotos, páginas huérfanas, frontmatter faltante, páginas obsoletas y contradicciones. Genera reporte accionable con fixes sugeridos.
triggers:
  - "revisar wiki"
  - "health check vault"
  - "wikilinks rotos"
  - "páginas huérfanas"
  - "/wiki-lint"
  - "/wiki-check"
tools:
  - obsidian_list
  - obsidian_search
  - obsidian_graph
  - obsidian_property
  - read
  - glob
  - grep
integrates_with:
  - obsidian-wiki
  - vault-health
  - wiki-ingest
---

# wiki-lint — Calidad del vault

Auditoría completa de salud del wiki. Detecta 5 clases de problemas y genera reporte priorizado.

## Checklist de lint

### 1. Wikilinks rotos
Buscar `[[target]]` donde `target.md` no existe en el vault.
```
grep -r "\[\[.*\]\]" vault/ → extraer targets → verificar existencia
```
Severidad: ALTA (rompe navegación)

### 2. Páginas huérfanas
Páginas sin backlinks entrantes (nadie las referencia).
```
Para cada .md en 02-Wiki/:
  grep -r "\[\[pagina\]\]" vault/ --exclude="pagina.md"
  Si count == 0 → huérfana
```
Severidad: MEDIA (dificulta descubrimiento)

### 3. Frontmatter faltante o inválido
```
Leer cada .md → verificar que empieza con ---
Campos requeridos: created, kind, source
```
Severidad: ALTA (rompe automatización)

### 4. Páginas obsoletas (30+ días)
```
Leer frontmatter "updated" o "created"
Si fecha < hoy - 30d → stale
```
Severidad: BAJA (puede estar completa pero no refrescada)

### 5. Contradicciones
Misma entidad con hechos diferentes en páginas distintas.
```
Buscar entidades con múltiples páginas → leer secciones relevantes
Si valores conflictivos → reportar con ambas fuentes
```
Severidad: CRÍTICA (genera decisiones erróneas)

## Reporte de salida

```markdown
# Wiki Lint Report — YYYY-MM-DD

## Resumen
- Total páginas: N
- Problemas: N (Críticos: X, Altos: Y, Medios: Z, Bajos: W)

## Wikilinks rotos (ALTA)
- [[pagina-origen]] → [[link-roto]] (no existe)
  → Fix: crear página o corregir nombre

## Huérfanas (MEDIA)
- 02-Wiki/ejemplo.md → 0 backlinks
  → Fix: agregar desde [[indice]] o eliminar

## Sin frontmatter (ALTA)
- pagina-x.md
  → Fix: agregar YAML frontmatter

## Obsoletas (BAJA)
- pagina-y.md → última actualización 2026-05-01
  → Fix: revisar y actualizar

## Contradicciones (CRÍTICA)
- "Puerto backend" dice 3335 en [[runtime-health]] pero 3197 en [[notas-viejas]]
  → Fix: consolidar en una fuente de verdad
```

## Ejemplo

```
Usuario: "Equipo, revisa la salud del wiki"

1. Listar todas las páginas con glob
2. Para cada página: leer frontmatter, extraer wikilinks, contar backlinks
3. Comparar fechas, buscar contradicciones
4. Generar reporte con fixes
5. Retornar: 3 rotos, 2 huérfanas, 0 contradicciones
```

## Reglas

- No corregir automáticamente — solo reportar (el usuario decide)
- Las contradicciones requieren resolución humana (marcar con `[NEEDS DECISION]`)
- El lint no modifica archivos, solo lee
- Priorizar: contradiccinks > frontmatter > rotos > huérfanas > obsoletas
