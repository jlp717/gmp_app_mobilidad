# F — TRACE 6 etapas (5.11) — evidencia

1. Captura: orquestador detecta "aprende/te corrijo/no vuelvas/recuerda/prefiero" -> .claude/memory/corrections.jsonl:1
2. Destilacion: agente memory extrae regla atomica -> .claude/memory/rules/<id>.yaml:1 (ej. 2026-08-21-01.yaml:1)
3. Compilacion: regla -> check runtime PreToolUse exit 2 (validate-prod.mjs:7, validate-secrets.mjs:6) — no solo CLAUDE.md texto
4. Curacion: campo conflicts_with resuelto explicitamente, no acumulado silencioso
5. Caducidad: expires null o fecha; correccion puntual "hoy no toques" no se vuelve permanente sin confirmacion
6. Alcance: scope global/por tipo/por agente (ej. backend-engineer)

Prueba fuego: corrige "nunca hagas X", cierra sesion, en tarea distinta sin repetir, verifica validate-*.mjs bloquea X. Si repites correccion, ciclo falla.
Origen: https://arxiv.org/abs/2606.13174 (57.5% violacion sin TRACE) + https://github.com/YujunZhou/tellonce

Evaluacion tellonce skill externa: pendiente Fase 3 spike 1 dia antes de construir propio.