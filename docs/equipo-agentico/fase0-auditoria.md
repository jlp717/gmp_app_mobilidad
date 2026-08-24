# FASE 0 â€” Auditoria e inventario (bloqueante)

Inventario realizado 21 ago 2026 contra repo real.

## Sustrato ejecucion real
- **Claude Code puro** (subagentes + hooks + skills) + OpenCode legacy coexistente (.opencode/ 80+ configs) â€” clasificado como **workflow + agentes hibridos**.
- Claude `.claude/settings.json` existia con 1 PostToolUse (guardvibe) + SessionStart/PreCompact bd prime. Hooks incompletos vs Sec 5.16.
- Subagentes: `.claude/agents/` inexistente antes (solo .opencode/agents con 30+ agentes legacy). Riesgo 5.3: writters multiples sin worktree isolation â€” detectado.
- MCP: `.mcp.json` con claude-flow v3 + context7 + guardvibe. No habia ibm-db2 ni playwright. Revision MCP no verificada (5.1 alert 2026-07-28).
- Memoria: `.opencode/memory/` + vault/09-index, sin ciclo TRACE 6 pasos (5.11) â€” solo storage, sin compilacion a checks.
- Estado escalado: Herramienta interna -> Beta (flujos dinero/stock/auth en prod).

## Clasificacion workflow vs agente
| Componente | Tipo | Veredicto |
| .opencode/config/playbooks.yaml | workflow | secuencia predefinida TINY..PROD |
| .opencode/agents/maker.md | agente | decide siguiente paso dinamico |
| .claude/hooks (previos) | workflow | gating determinista |
| vault + memory | memoria | falta compilacion a regla ejecutable |

## MCP revisiones (5.1)
- Verificar cada servidor habla 2026-07-28 (stateless, sin initialize). Todos anclados a previa -> requiere capa traduccion o upgrade antes de asumir compatibilidad. Gap abierto.

## Decision bloque Sec 4
| Accion | Que | Por que | Reemplaza con |
| Conserva | lib/, backend/routes-services-repositories, vault/09-index, runtime-health.yaml, .mcp.json estructura | Patrones solidos (capas, offline-first, PM2 3335) alineados con 5.5/5.6 | â€” |
| Refactoriza | .claude/settings.json hooks -> pipeline Sec 7 completo | Solo tenia 1 hook, falta Stop/SubagentStop gating | Este commit |
| Crea | TRACE memory, EARS specs, ASI matrix, observabilidad gen_ai | Gaps 5.11/5.8/5.13 | Ver Fase 2/3 |

Evidencia: `AGENTS.md:1`, `.claude/settings.json:1`, `.mcp.json:1`, `.opencode/config/:` (~60 yaml), `lib/features/*:1`.

