---
name: production-grade-checklist
description: Master checklist that ANY production-bound feature must pass before merge. Quality gates from FAANG-tier teams.
---

# Skill: production-grade-checklist — Estándar producción FAANG-tier

Lista que toda feature debe pasar antes de mergear a `main`. NO es opcional. Si algún check falla, NO mergear sin justificación documentada.

## 1. Code quality

### Tipado
- [ ] TypeScript strict mode (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`)
- [ ] Dart sound null safety (no `!` salvo justificado)
- [ ] Python type hints en funciones públicas
- [ ] Sin `any` / `dynamic` salvo comment justificando

### Nombres y estructura
- [ ] Funciones / clases con nombre que describe **qué hace**, no **cómo**
- [ ] No abreviaturas raras (`ctx` OK, `mctxlst` no)
- [ ] Archivos <500 LOC. Si excede, split.
- [ ] Funciones <50 LOC. Si excede, extraer.
- [ ] Sin comentarios "qué" — el código se autoexplica. Comentarios para "por qué".

### Limpieza
- [ ] Sin imports unused
- [ ] Sin variables unused
- [ ] Sin `console.log` / `print` en producción
- [ ] Sin TODO sin issue ID
- [ ] Sin código comentado out

## 2. Tests

### Cobertura
- [ ] Unit tests para lógica no-trivial (puro business logic)
- [ ] Integration tests para endpoints / providers complejos
- [ ] E2E para flujos críticos (login, checkout, pago)
- [ ] Coverage delta del PR no baja el global
- [ ] Tests del happy path + edge cases + error paths

### Calidad
- [ ] Tests deterministicos (no flaky por timing/random)
- [ ] AAA pattern (Arrange-Act-Assert)
- [ ] No mocks dentro del subject (mockear adyacente)
- [ ] Builders > fixtures hardcoded
- [ ] No `setTimeout` para esperar (usar `waitFor`)

## 3. Errores y observabilidad

- [ ] Manejo de errores explícito (try/catch con razón clara)
- [ ] Errores user-facing tienen mensaje útil (no "Error: failed")
- [ ] Logs estructurados JSON con request_id correlacionable
- [ ] Métricas (Prometheus / RUM) para nuevos endpoints / flujos críticos
- [ ] Sentry / equivalente atrapa errors no manejados
- [ ] Distributed tracing añade spans para nueva lógica

## 4. Seguridad

### Validación
- [ ] Input validado en frontera (Zod schema, Pydantic, validate.js)
- [ ] Output sanitizado si se renderiza (XSS prevention)
- [ ] Queries parametrizadas (no string concat SQL)
- [ ] File paths sanitizados (no path traversal)
- [ ] URLs externas validadas (no SSRF)

### Auth / Authz
- [ ] Endpoints nuevos requieren auth por default
- [ ] Authorization en endpoint Y en resolver / service (defensa en profundidad)
- [ ] Object-level auth check (ownership) para recursos por ID
- [ ] Rate limit en endpoints públicos / auth
- [ ] Tokens con TTL razonable + rotation

### Secrets
- [ ] Sin secretos hardcoded — env vars o secret manager
- [ ] Sin secretos en logs (redact)
- [ ] Sin secretos en error messages
- [ ] `.env` en `.gitignore`
- [ ] Si se filtra: rotation inmediata + post-mortem

### Red team passed
- [ ] @red-team-engineer probó vectores comunes para esta feature
- [ ] Findings críticos resueltos antes de mergear

## 5. Performance

### Frontend (web)
- [ ] Core Web Vitals: LCP <2.5s, INP <200ms, CLS <0.1
- [ ] Bundle size delta razonable (<50KB para feature)
- [ ] Imágenes optimizadas (AVIF/WebP, lazy load below-fold)
- [ ] Sin re-renders innecesarios (React.memo / useMemo justificados)
- [ ] No memory leaks (cleanup en useEffect)

### Frontend (Flutter)
- [ ] Frame budget 16ms (60fps) o 8ms (120fps)
- [ ] Riverpod con `select` para evitar rebuilds full
- [ ] Lazy loading de listas grandes (`ListView.builder`)
- [ ] Imágenes con cache + placeholder
- [ ] `dispose` correcto en controllers

### Backend
- [ ] Queries con índices (verificado en EXPLAIN plan)
- [ ] N+1 evitado (DataLoader / batch / join)
- [ ] Pagination (cursor o offset, no ALL rows)
- [ ] Caching donde aplica (Redis / CDN / in-memory)
- [ ] No bloqueos largos (transactions cortas)

## 6. Accesibilidad (web)

- [ ] Contraste WCAG AA (4.5:1 normal, 3:1 grande)
- [ ] Navegable con teclado (Tab order lógico)
- [ ] Focus visible (no `outline:none` sin alternativa)
- [ ] ARIA cuando HTML no basta (`aria-label`, `aria-describedby`)
- [ ] Alt text en imágenes informativas
- [ ] Heading hierarchy h1→h2→h3 sin saltos

## 7. Documentación

- [ ] README de la feature actualizado si aplica
- [ ] API contract documentado (OpenAPI / GraphQL schema)
- [ ] Decisiones arquitectónicas en ADR si aplica
- [ ] Inline docs solo cuando el "por qué" no es obvio
- [ ] Changelog entry para release notes

## 8. Compliance / Legal

- [ ] PII tratado conforme GDPR (consent, retention, erasure)
- [ ] Cookies declared en banner si web
- [ ] Términos privacidad actualizados si nueva categoría datos
- [ ] Audit log para cambios sensibles (data access, role changes)

## 9. Operacional

- [ ] Migrations reversibles (DOWN script)
- [ ] Feature flag si rollout gradual
- [ ] Plan de rollback documentado
- [ ] Métricas de salud (health check endpoint actualizado si aplica)
- [ ] Runbook si introduce nuevo failure mode

## 10. Code review

- [ ] @code-reviewer aprueba (al menos 1 senior review)
- [ ] @staff-engineer revisó si change >500 LOC
- [ ] @security-sentinel + @red-team-engineer si toca auth/datos
- [ ] CI verde
- [ ] Branch up-to-date con main (no merge conflicts)

## Severity matrix

Si algún check falla:

| Categoría | Falla | Acción |
|---|---|---|
| Tipado / nombres | Falla | Cambiar antes de mergear |
| Tests críticos | Falla | NO mergear hasta arreglar |
| Seguridad CRITICAL | Falla | NO mergear, escalar |
| Performance budget | Falla | Si feature core, NO mergear; si secundario, issue + fix planeado |
| A11y | Falla | NO mergear si user-facing |
| Documentación | Falla | Mergear si cambio interno; NO si API pública |

## Auto-aplicación por agentes

Cuando @code-reviewer revisa, debe aplicar este checklist como base. Cuando @tech-lead verifica antes de cerrar feature, igual. Cuando @release-manager prepara release, exige checklist completo en PRs incluidos.

Si un agente lo skip, @staff-engineer puede objetarlo en review.
