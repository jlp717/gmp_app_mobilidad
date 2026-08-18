---
name: skills-health
description: Health-check de skills: detecta stubs, frontmatter roto, skills rotas y duplicados entre skills/skills-ecc. Read-only, reporta.
---
# Skills Health

## Que detecta
- SKILL.md sin frontmatter (--- name/description).
- Stubs (menos de 3 lineas utiles).
- Skills referenciadas en flujos/configs que no existen en disco.
- Duplicados entre .opencode/skills y .opencode/skills-ecc.

## Flujo
1. Inventariar skills (propia, ecc, superpowers).
2. Validar frontmatter y contenido.
3. Cruzar con referencias de task-flows.yaml y chief-protocol.
4. Reportar hallazgos con ruta y fix.

## Salida
- Lista: skill, problema, fix.
