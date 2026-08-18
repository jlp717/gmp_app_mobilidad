---
name: team-portable
description: Porta el harness completo del equipo a cualquier repo/carpeta nueva. Usar cuando Javier cree un repo nuevo para una app o proyecto.
---
# Team Portable

## Como portar
1. Crear el directorio destino.
2. Desde la raiz del repo fuente ejecutar: node scripts/opencode/bootstrap-team.mjs DESTINO
3. Ajustar opencode.json del destino si el stack difiere.
4. Crear docs/spec/APP.md con living-spec (o /greenfield).
5. Ejecutar /greenfield NOMBRE para arrancar el pipeline completo.

## Que se copia
- .opencode completo: config, agents, skills + skills-ecc, plugins, tools, scripts, rules.json, fallback-models.json.
- opencode.json, AGENTS.md, docs/agent-compliance-matrix.md.

## Que NO se copia
- Estado/sesion: state, backups, metrics, sandbox, TEAM_TRACE, tokens, same-error-tracker.
- Informes y certificaciones puntuales del repo fuente.

## Modelo de negocio
- Fase demo: frontend completo con datos y funcionalidades mockeados (producto entero simulado).
- Validacion con clientes.
- Fase real (~4 meses): implementar funcionalidad real con arquitectura, escalabilidad y mantenibilidad.

## Regla
- TODO repo nuevo de Javier debe bootstrap del harness (correccion NEGOCIO_DEMO_MOCK_PRIMERO_PORTABLE).
