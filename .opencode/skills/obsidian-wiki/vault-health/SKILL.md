---
name: vault-health
version: 1.0.0
description: Dashboard global de salud del vault Obsidian. Métricas de cobertura, frescura, densidad de grafo y páginas huérfanas. Genera reporte visual con recomendaciones priorizadas de mejora.
triggers:
  - "estado del vault"
  - "salud del wiki"
  - "métricas wiki"
  - "dashboard vault"
  - "/vault-health"
  - "/wiki-health"
tools:
  - obsidian_list
  - obsidian_graph
  - obsidian_property
  - obsidian_search
  - read
  - glob
  - grep
integrates_with:
  - obsidian-wiki
  - wiki-lint
  - weekly-synthesis
---

# vault-health — Dashboard de salud del vault

Genera un dashboard completo de salud del knowledge base con métricas cuantitativas y recomendaciones accionables.

## Métricas

### 1. Tamaño y cobertura
```
- Total páginas: contar .md en todo el vault
- Por carpeta: distribución (00-Inbox, 02-Wiki, 10-Decisions, etc.)
- Por tipo (kind en frontmatter): concept, decision, runbook, etc.
```

### 2. Densidad de grafo
```
- Total wikilinks: grep "\[\[.*\]\]" → contar
- Promedio links por página: total_links / total_páginas
- Páginas sin links salientes: potenciales hojas
- Densidad ideal: 2-5 links por página
```

### 3. Frescura
```
- Páginas actualizadas últimos 7d: count
- Páginas actualizadas últimos 30d: count
- Páginas sin actualizar 90d+: count (candidatas a archivar)
- Promedio días desde última actualización
```

### 4. Calidad de frontmatter
```
- Con frontmatter completo (created + kind + source): N
- Sin frontmatter: N (problema)
- Con campos faltantes: N
```

### 5. Conectividad
```
- Páginas huérfanas (0 backlinks): N
- Componentes desconectados: clusters aislados
- Páginas más conectadas (top-5 hubs)
```

## Reporte de salida

```markdown
# Vault Health Dashboard — YYYY-MM-DD

## 📊 Métricas clave
| Métrica | Valor | Estado |
|---------|-------|--------|
| Total páginas | 47 | ✅ |
| Wikilinks totales | 132 | ✅ |
| Links/página (avg) | 2.8 | ✅ |
| Huérfanas | 3 | ⚠️ |
| Sin frontmatter | 1 | ❌ |
| Stale (90d+) | 5 | ⚠️ |

## 📁 Distribución por carpeta
- 02-Wiki/: 18 páginas
- 10-Decisions/: 6 páginas
- 20_Runbooks/: 4 páginas
- 30-Retros/: 8 páginas
- 40-TechRadar/: 3 páginas
- 50-AgentTeam/: 8 páginas

## 🕸️ Top hubs (más conectados)
1. [[arquitectura-backend]] — 12 backlinks
2. [[auth-flow]] — 8 backlinks
3. [[reglas-inmutables]] — 6 backlinks

## ⚠️ Alertas
- ❌ `pagina-x.md` sin frontmatter → corregir
- ⚠️ 3 páginas huérfanas → enlazar desde índice
- ⚠️ 5 páginas stale → revisar vigencia

## 📈 Tendencia (vs semana anterior)
- Páginas nuevas: +2
- Links nuevos: +5
- Huérfanas: -1 (mejora)

## 🎯 Recomendaciones (priorizadas)
1. [ALTA] Agregar frontmatter a página-x.md
2. [MEDIA] Enlazar 3 huérfanas desde [[indice]]
3. [BAJA] Archivar o actualizar 5 páginas stale
```

## Ejemplo

```
Usuario: "Equipo, ¿cómo está la salud del wiki?"

1. Listar todas las páginas con glob
2. Calcular métricas (tamaño, links, frescura)
3. Identificar hubs y huérfanas
4. Generar dashboard con estados ✅/⚠️/❌
5. Retornar: 47 páginas, 132 links, 3 huérfanas, 1 sin frontmatter
```

## Reglas

- No modificar el vault — solo lectura y reporte
- Las recomendaciones se ordenan por impacto (calidad > cobertura > frescura)
- Si el vault tiene < 5 páginas → reportar "vault en fase inicial"
- Guardar dashboard en `50-AgentTeam/YYYYMMDD-Vault-Health.md` para trazabilidad
- Comparar con dashboard anterior si existe (tendencia)
