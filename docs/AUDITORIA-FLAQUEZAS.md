# AUDITORIA INTEGRAL DEL EQUIPO - Listado de Flaquezas por Severidad

> Fecha: 2026-08-13. Analisis exhaustivo de TODAS las capas del equipo (config, agents, skills, plugins, flujos, reglas, docs, memoria, portabilidad).

## MUY IMPORTANTES (rompen funcionalidad o exponen riesgo grave)

1. [MUY] guardvibe referenciado en task-flows pero es MCP externo sin verificar - puede dar falso sentido de seguridad.
2. [MUY] analisis_frio referenciado en task-flows como skill pero es un FLUJO (no skill) - referencia rota de naming.
3. [MUY] chroma-query (RAG semantico) caido - el fallback keyword funciona pero no hay memoria semantica real.
4. [MUY] No hay validacion automatica del harness (agnix candidato) - los AGENTS.md/SKILL.md pueden degradarse sin detectarse.

## IMPORTANTES (degradan calidad o coherencia)

5. [IMP] 27 configs YAML sin campo enabled:true explicito (ambiguedad de si estan activos).
6. [IMP] ponytail-audit y ponytail-debt son stubs (menos de 3 lineas utiles) - prometen y no cumplen.
7. [IMP] No hay CI de verificacion del equipo (team-ci existe como comando pero no esta en automation-schedule).
8. [IMP] No hay backup automatico periodico del harness (solo manual con team-backup).

## MEDIAS (mejoran robustez y experiencia)

9. [MED] No hay smoke test post-cambio de config automatizado (readiness-smoke es manual).
10. [MED] La memoria canonica project-state.md no se versiona/rota (riesgo de perder contexto historico).
11. [MED] No hay health-check de skills (detectar stubs/rotas automaticamente).
12. [MED] headroom esta instalado pero no hay plugin que lo invoque automaticamente en delegaciones largas.

## MINIMAS (pulido)

13. [MIN] 4 repos GitHub candidatos evaluados pero no instalados (agnix, hol-guard, ops-codegraph, swarm) - pendientes de sandbox.
14. [MIN] skills-ecc duplican conceptualmente algunas skills propias (verificacion manual necesaria).
15. [MIN] No hay comando /audit-team que ejecute todas las auditorias de una vez.
16. [MIN] Docs de estrategia no referenciados desde AGENTS.md raiz (solo desde project-state).

## RESUMEN
- Muy importantes: 4
- Importantes: 4
- Medias: 4
- Minimas: 4
- Total: 16 flaquezas detectadas y a corregir.
