# Matriz de Cohesion ECC (affaan-m/ECC) -> Equipo GMP V4

> Generada 2026-08-12, tarea 20260812-125735-gmp-hiub / 20260812-132832-gmp-acw9.
> Fuente: https://github.com/affaan-m/ECC (MIT). Cohesion: lo mejor de cada lado sin colisiones.

## Agents ECC -> Equivalente GMP V4

| Agent ECC | Equivalente GMP V4 | Decision |
|-----------|-------------------|----------|
| build | chief-engineer-assistant | ya cubierto |
| planner | Architect-Planner | ya cubierto |
| architect | Architect-Planner | ya cubierto |
| code-reviewer | Code-Reviewer / Check-Reviewer | ya cubierto |
| security-reviewer | appsec-engineer / Security-Validator | ya cubierto |
| tdd-guide | Test-Writer / skill tdd-workflow | ya cubierto |
| build-error-resolver | Node-Express-Specialist + debugging-and-error-recovery | ya cubierto |
| e2e-runner | qa-automation-lead + browser-testing-with-playwright | ya cubierto |
| doc-updater | product-ux + skill docs-sync | ya cubierto |
| refactor-cleaner | Simplify-Reviewer + skill code-simplification | ya cubierto |
| database-reviewer | DB2-AS400-Specialist / DB2-Query-Optimizer | ya cubierto (DB2, no Postgres) |
| docs-lookup | Web-Researcher + MCP context7 | ya cubierto |
| harness-optimizer | **ecc-harness-optimizer** (nuevo) | IMPORTAR con prefijo |
| loop-operator | goal-loop-manager + skill goal-driven-loop | ya cubierto |
| go-reviewer / go-build-resolver | no aplica a GMP/Granja (Node/Flutter/DB2) | NO importar |
| java/java-build/kotlin/kotlin-build/php/python/rust/rust-build/cpp/cpp-build reviewers | no aplica al stack actual | NO importar (disponibles via npm cuando se instale) |

## Commands ECC -> Equivalente GMP V4

| Command ECC | Equivalente GMP | Decision |
|-------------|-----------------|----------|
| /plan, /tdd, /code-review, /security, /build-fix, /e2e, /refactor-clean, /orchestrate | /workflow, /route, /verify, /quality, /security (propios) | ya cubierto |
| /verify, /eval | /verify, /quality, /matricula | ya cubierto |
| /learn, /checkpoint | memory-learning-loop, session-handoff | ya cubierto |
| /update-docs, /update-codemaps | docs-sync, codemap | ya cubierto |
| /test-coverage, /setup-pm | testing-strategy | ya cubierto |
| /skill-create | skill-creator (global) | disponible al instalar npm |
| /instinct-*, /evolve, /promote, /projects | requiere infra instincts ECC | disponible al instalar npm |

## Skills ECC

- 39 skills adaptadas en .opencode/skills-ecc/ (ver listado).
- 248 restantes: disponibles al instalar npm ecc-universal (catalogo completo bajo demanda).

## Notas

- No se importan agents/commands que dupliquen o no apliquen al stack: evita colision con roster V4 y model-assignment-audit.
- Agents/commands ECC usan modelos anthropic; cualquier importacion futura debe remapear a openai/gpt-5.5 (critico) u opencode-go/deepseek-v4-flash (barato).
