---
name: code-review-checklist-50
description: 50+ point exhaustive code review checklist. Apply before approving any PR. Goes beyond surface review into security, performance, maintainability.
---

# Skill: code-review-checklist-50

50+ checks que un senior reviewer aplica antes de aprobar PR. NO es opcional.

## A. Funcionalidad (1-10)

1. ¿El código hace lo que dice la PR description?
2. ¿Cubre todos los acceptance criteria del issue?
3. ¿Hay edge cases no manejados (null, empty, max value, concurrent calls)?
4. ¿Errores propagados con contexto útil al usuario final?
5. ¿Hay cambios fuera del scope del PR? (señal de scope creep)
6. ¿Backwards compatible o breaking change documentado?
7. ¿Si breaking change → versión bumpeada (semver) y CHANGELOG actualizado?
8. ¿Comportamiento idéntico en dev/staging/prod (no entorno-dependent)?
9. ¿Si toca contracts (API, schema): consumers notificados?
10. ¿Feature flag para rollout gradual si toca user-facing?

## B. Tests (11-20)

11. ¿Tests para nueva lógica?
12. ¿Tests cubren happy path + edge cases + error paths?
13. ¿Tests son deterministicos (no flaky por timing/random)?
14. ¿AAA pattern (Arrange-Act-Assert)?
15. ¿Mockean adyacente, no el sujeto?
16. ¿Coverage delta no baja?
17. ¿Si fix bug: hay test que reproduce el bug original?
18. ¿Integration tests donde aplica (DB, HTTP, queues)?
19. ¿E2E para flow crítico nuevo?
20. ¿Tests legibles (alguien que no escribió el código entiende qué se prueba)?

## C. Seguridad (21-30)

21. ¿Inputs validados en frontera (Zod, Pydantic, validate.js)?
22. ¿Output sanitizado donde se renderiza (XSS prevention)?
23. ¿Queries parametrizadas siempre (NO string concat SQL)?
24. ¿File paths sanitizados (no path traversal)?
25. ¿URLs externas validadas (no SSRF)?
26. ¿Authorization en endpoint Y service (defensa profunda)?
27. ¿Object-level auth (ownership) en recursos por ID?
28. ¿Sin secrets hardcoded (env vars o secret manager)?
29. ¿Sin secrets en logs (redact tokens, PII)?
30. ¿Rate limit en endpoints públicos / auth?

## D. Performance (31-40)

31. ¿Sin queries N+1 (batch, DataLoader, JOIN)?
32. ¿Indices DB cubren las queries nuevas (verificado en EXPLAIN)?
33. ¿Pagination en listas potencialmente grandes (>100 items)?
34. ¿Sin SELECT * en código producción?
35. ¿Caching donde aplica (Redis, CDN, in-memory)?
36. ¿Sin re-renders innecesarios en frontend (React.memo / useMemo justificados)?
37. ¿Bundle size delta razonable (<50KB para feature)?
38. ¿Imágenes optimizadas (AVIF/WebP, lazy load below-fold)?
39. ¿Operaciones largas async / job queue (no bloquean request)?
40. ¿Memory leaks evitados (cleanup useEffect, dispose Flutter, close streams)?

## E. Mantenibilidad (41-50)

41. ¿Nombres descriptivos (función dice qué hace)?
42. ¿Funciones <50 LOC, archivos <500 LOC?
43. ¿Sin código duplicado >3 veces (DRY proporcional)?
44. ¿Comentarios solo para "por qué", no para "qué"?
45. ¿Sin TODO sin issue ID asociado?
46. ¿Imports limpios, sin unused?
47. ¿Lint OK (ESLint, dart analyze, ruff, etc.)?
48. ¿TypeScript / Dart sin `any`/`dynamic` (salvo justificado)?
49. ¿Logs estructurados JSON con request_id?
50. ¿Sin console.log / print en producción?

## F. Bonus (51-60) — para cambios grandes

51. ¿ADR creado si decisión arquitectónica?
52. ¿Migration reversible con DOWN script?
53. ¿Feature flag para rollback rápido?
54. ¿Smoke test post-deploy automatizado?
55. ¿Métricas custom para monitorear health post-deploy?
56. ¿Alertas configuradas para nuevos failure modes?
57. ¿Runbook para nuevos servicios/integraciones?
58. ¿Documentación interna actualizada (architecture, API)?
59. ¿README actualizado si aplica?
60. ¿@security-sentinel + @red-team-engineer revisaron si toca auth/datos?

## Severity matrix

Si algún check falla:

| Categoría | Falla | Acción |
|---|---|---|
| Funcionalidad | bug obvio | NO merge hasta arreglar |
| Tests críticos | sin cobertura | NO merge |
| Seguridad CRITICAL | injection / auth bypass | NO merge, escalar |
| Performance regression | >2x latencia | NO merge sin justificación |
| Maintainability | nombres malos, code smell | Pedir cambios |
| A11y | violación WCAG AA | NO merge si user-facing |

## Comentarios efectivos

### MAL
- "this is wrong" → vago
- "I don't like this" → personal preference

### BIEN
- "L42: esta query no usa el índice idx_orders_created_at, va a hacer full scan en 2M filas. Sugerencia: añadir orden o reescribir como WHERE created_at >= NOW() - INTERVAL '30 days'"
- "L120: aquí podría haber race condition si dos requests concurrentes — propongo lock optimista con campo version"

## Tiempo objetivo de review

- PR <100 LOC: <30 min
- PR 100-500 LOC: 1-2 horas
- PR >500 LOC: probablemente debería dividirse

## Coordinación

- @code-reviewer: aplica este checklist como base
- @red-team-engineer: focus puntos 21-30 (security)
- @performance-engineer: focus puntos 31-40
- @staff-engineer: review override en cambios >500 LOC
