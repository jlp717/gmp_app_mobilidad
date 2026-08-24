# FASE 7 — Contingencia y rollback (5.5, 5.10)

## Circuit breakers
- Max 3 repair iterations + 2 no-progress rounds antes de escalar (orquestador.md pipeline).
- Hook Stop con `decision: block` es el breaker determinista.

## Rollback
- Expand-and-contract base (5.5): flag + tabla/columna nueva reversible -> deploy -> cleanup separado.
- Feature flags para todo cambio con radio prod (release-agent).
- Snapshot: `.claude/state/plans/` + git worktree permite revertir 1 commit.

## Context fatigue / token burn
- Presupuesto minimo tokens alta sena: orquestador lee Field Guide (3 lineas) + max 3 notas vault, no todo.
- handoff ledger condensado, no volcado contexto. Progressive-context (Sec 3).

## Salud runtime
Fuente `.opencode/config/runtime-health.yaml` sigue vigente (3335 + SSH localhost). Mo de 3197 verificado no listening (2026-06-07).
