---
type: concept
status: active
summary: Como el equipo arranca una web o frontend nuevo sin que Javier repita el brief de senior.
tags: [greenfield, web, next, frontend]
---

# Greenfield web

Playbook **BUILD** `task_type: factory` si es app/web completa para cliente. Landing sola = `frontend_web`.
Skill `greenfield-pipeline`. Contrato `.opencode/config/product-delivery-contract.yaml`.
Un maker. Loop hasta PASS. PR != produccion.

Defaults de senior, no preguntar:

- Spec corta antes de codigo: usuario, flujo, estados, fuera de alcance.
- Stack: si es producto GMP, Flutter+Node+DB2. Si Javier pide web nueva, no inventar Postgres/Supabase. Estatico o el stack que el pida.
- Capas. Contratos API tipados. Timeouts. Errores accionables. Cero N+1.
- Auth en el borde. Validacion de input. Sin secretos en el repo.
- UI: loading / empty / error / offline. Responsive 1440 y 390. Reduced motion.
- Test del camino critico antes de "hecho".

Related: [[gmp-stack]] [[code-quality-contract]] [[vuln-analysis]]
