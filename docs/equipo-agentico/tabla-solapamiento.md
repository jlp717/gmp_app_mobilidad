# A.3 — Cero solapamiento (1 fila = 1 responsabilidad única)

Verificado 21 ago 2026 contra `.claude/agents/*.md:1` description + Rol.

| Agente | Responsabilidad única (1 frase) | No hace (frontera) |
| orquestador | Clasifica playbook y despacha roster mínimo, sintetiza informes, decide gate. | No implementa backend/frontend directo salvo tiny. |
| backend-engineer | Implementa routes/services/repositories/queries DB2 con contrato OpenAPI. | No toca lib/ Flutter ni docs fuera de contrato. |
| frontend-engineer | Implementa widgets/providers/presentation con tokens AppColors y a11y. | No toca backend/routes ni DB2. |
| security-reviewer | Audita OWASP ASVS/ASI/MCP secretos/SCA sobre diff cerrado, bloquea crítico. | No escribe parche; no revisa legibilidad. |
| performance-reviewer | Mide p95/p99/CWV y detecta N+1/bundle degradación, solo reporta. | No optimiza código. |
| test-engineer | Escribe/repara tests deterministas + 1 e2e Playwright por feature. | No auto-repara lógica aserción. |
| db-migration-agent | Planifica migraciones expand-contract reversibles 1 paso, solo genera .sql. | No ejecuta DDL en prod, no escribe backend logic. |
| code-reviewer | Consolida 3 fan-out, deduplica, veredicto legibilidad/arquitectura PASS/WARN/BLOCK. | No re-audita OWASP profundo. |
| docs-agent | Sincroniza living spec/README/ADR con código en mismo ciclo. | No implementa feature. |
| release-agent | Despliega con whitelist + health 60s + rollback, flags. | No toca esquema DB2. |
| compliance-agent | Audita audit trail 12 campos + HITL financiero/GDPR por decisión IA. | No audita salud/menores (fuera scope). |

**Criterio solapamiento**: si `code-reviewer` dice "revisa calidad" y `security-reviewer` también, se distingue: quality → legibilidad/arquitectura/YAGNI; security → OWASP/ASVS/CWE/secrets. Ninguna fila describe lo mismo con otras palabras. Evidencia: cada `description` en `.claude/agents/*.md:3` es distinta y permite a orquestador decidir sin ambigüedad (The Prompt Shelf https://thepromptshelf.dev/blog/agents-md-best-practices/).
