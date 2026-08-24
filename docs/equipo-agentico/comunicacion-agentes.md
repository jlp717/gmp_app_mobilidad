# B — Comunicación real entre agentes

Verificado 21 ago 2026.

## ¿CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 activado?
**NO.** Evidencia: `grep "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" .claude/settings.json` → 0 resultados (`.claude/settings.json:1` no contiene flag).

**Consecuencia técnica**: NO hay mensajería directa entre compañeros vía buzón compartido. Todo pasa por orquestador como intermediario único (subagentes aislados, cada uno reporta a quien lo invocó, sin verse entre sí). Esto es **diseño válido y deliberado**, no omisión.

## ¿Por qué no se activó?
Agent Teams es experimental (Claude Docs 5.16) y menos predecible en resumición de sesión. Para un repo con datos financieros y 11 especialistas, se prioriza determinismo: 1 writer/worktree + fan-out lectura paralela con consolidación explícita del orquestador. Activar flag no configura flujo automáticamente — habría que diseñar TaskCreate/TaskList + SendMessage explícito, no se hizo porque no compensa el riesgo.

## ¿Cómo se garantiza que los 3 revisores no se ignoran?
Orquestador `.claude/agents/orquestador.md:18` paso 10: recoge 3 payloads en paralelo y sintetiza **sin descartar por primera impresión**. `code-reviewer.md:17` deduplica y distingue defecto confirmado vs posible antes de veredicto. Prueba fuego: en feature E2E `health-check-e2e` se invocan los 3 y se loguea `handoff-ledger` con timestamp + output_hash por revisor — si no ves 3 entradas, no confirmes B.

## Canal db-migration → backend-engineer
Si `db-migration-agent` detecta breaking endpoint, lo reporta a orquestador (no directo a backend) y orquestador lo reinyecta como `required_gates` al `backend-engineer` antes de dar por bueno. Evidencia: `db-migration-agent.md:19` paso 4 + `orquestador.md:14` paso 6.

**Estado B**: ✅ con justificación explícita de por qué se optó por subagentes + consolidación orquestador, no por agent teams.
