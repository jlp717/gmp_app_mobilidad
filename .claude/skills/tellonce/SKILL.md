# tellonce — Aprendizaje continuo por restriccion (5.11)

Inspirado en TRACE (arXiv:2606.13174) + impl `YujunZhou/tellonce`. Memoria pasiva falla 57.5%; TRACE compila a checks runtime.

## Ciclo 6 pasos
1. **Captura**: Javi corrige ("aprende/te corrijo/no vuelvas/recuerda/prefiero" o /teach) -> evento, no texto suelto.
2. **Destilacion**: extrae regla atomica, no parrafo completo.
3. **Compilacion**: regla -> comprobacion programatica. Hook PreToolUse con exit 2 si viola (no solo parrafo en CLAUDE.md).
4. **Curacion**: si nueva contradice existente, resuelve explicitamente; no acumules contradicciones.
5. **Caducidad**: correccion puntual ("hoy no toques") no se vuelve permanente sin confirmacion.
6. **Alcance**: etiqueta ambito (global / por tipo tarea / por agente).

## Implementacion en este repo
- Captura: `orquestador` detecta patron + guarda en `.claude/memory/corrections.jsonl`
- Destila: agente `memory` genera `.claude/memory/rules/<id>.yaml` con `check: <comando>`
- Compila: hook `PreToolUse` lee `rules/*.yaml` y bloquea con exit 2
- Evaluar `tellonce` skill externa en Fase 2 antes de construir propio

## Formato regla
```yaml
id: 2026-08-20-01
trigger: "no usar VENDEDOR='ALL'"
scope: backend-engineer
check: "grep -q \"VENDEDOR='ALL'\" && exit 2"
expires: null
```
