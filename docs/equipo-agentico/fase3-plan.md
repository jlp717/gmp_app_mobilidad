# FASE 3 — Plan max 5 fases (tras F0)

## Fase A — Hooks + Agentes canonicos (esta entrega)
Objetivo: pipeline Sec 7 operativo.
Artefactos: `.claude/settings.json`, `.claude/hooks/*.sh|*.mjs`, `.claude/agents/*.md` (11), `.claude/skills/*`, `.mcp.json`
Dep: ninguna
Validacion: `ls .claude/agents | wc -l == 11` + `cat .claude/settings.json | jq .hooks`
Riesgo: scanner bloquea literales -> mitigado con delegacion a .mjs

## Fase B — SDD + TRACE memoria
Objetivo: spec-first y aprendizaje continuo compilado.
Artefactos: `docs/spec/*.md`, `.claude/memory/rules/*.yaml`, `.claude/memory/corrections.jsonl`
Validacion: crear spec EARS dummy y verificar docs-agent lo actualiza
Riesgo: tellonce evaluacion pendiente -> spike timeboxed 1 dia

## Fase C — Seguridad + SCA
Objetivo: cerrar F4.
Artefactos: `docs/equipo-agentico/owasp-asi-matrix.md`, Gitleaks pre-commit, Dependabot config
Validacion: `gitleaks detect --no-git -v` + `npm audit` verde
Riesgo: gate 2-10 min -> medir en PR real

## Fase D — Observabilidad + evaluacion
Objetivo: F6.
Artefactos: OTEL gen_ai con capa mapeo, k6 scripts, Prometheus middleware existente
Validacion: traza por tarea con coste/latencia, dashboard
Riesgo: gen_ai experimental -> version pin + mapping layer

## Fase E — Contingencia + flags
Objetivo: F7.
Artefactos: feature flags, expand-contract templates, circuit breakers (max 3 retries)
Validacion: rollback test en staging
