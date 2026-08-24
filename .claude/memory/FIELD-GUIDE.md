# Field Guide — gmp_app_mobilidad (3 lineas max contexto)

Fuente corta. Detalle: vault/09-index/index.md + max 3 notas. Catalogo: .claude/config/

## Habla humano
Javi -> Orquestador (owns chat). Especialistas = tools. No elige agentes.

## Cualquier tarea
| Pedido | Playbook |
| typo/pregunta/correccion | TINY |
| mapear/logs readonly | EXPLORE |
| docs oficiales/comparar lib | EXPLORE (3-5 workers+citation) |
| feature/bug/pantalla/endpoint | BUILD (spec EARS -> maker -> fan-out -> critic) |
| migracion 50+ files | SWEEP (worktrees, 1 owner/file) |
| XSS/SQL/secretos/OWASP | SECURE (AppSec no escribe parche) |
| deploy/PM2/DDL/secret rotation | PROD (gates+adelante) |

## Coste
Planner sol siempre. Executor terra solo si riesgo bajo + spec EARS clara. Critic nunca mas barato que maker. SECURE/PROD/db_migration/comisiones = sol.

## Cierre
fan-out: security+performance+test (paralelo) -> code-reviewer -> docs-agent. Sin PASS no hay hecho.