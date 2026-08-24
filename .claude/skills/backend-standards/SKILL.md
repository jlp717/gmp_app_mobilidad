# Backend Standards (5.5)

Checklist senior para backend-engineer. Suelo minimo, no sugerencia.

- OpenAPI antes que codigo (EncodeDots, Xano 2026)
- OAuth2/JWT + auth por recurso, rate limit, OWASP API Top 10
- HTTPS + HSTS siempre (TechMarcos)
- Idempotencia con clave donde aplique (pagos/creaciones), errores consistentes nunca 500 desnudo
- Cache lecturas costosas, job async para largas, p50/p95/p99
- expand-and-contract para migraciones (OneUptime)
- Versionado aditivo; breaking => nueva version
- JSON plano, predecible, listo para agentes

Refs: https://www.encodedots.com/blog/api-design-principles-best-practices , https://www.xano.com/blog/modern-api-design-best-practices/
