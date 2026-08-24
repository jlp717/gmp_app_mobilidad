# FASE 4 — OWASP ASI01-ASI10 + ASVS + MCP Top 10

> Sec 5.13 + 5.7. Columna mitigacion con evidencia archivo:linea o GAP.

| ID | Riesgo | Mitigacion especifica / GAP |
|---|---|---|
| ASI01 | Secuestro objetivo | Hook no trata output externo como instruccion; orquestador valida contenido recuperado como dato. Evidencia: `.claude/agents/orquestador.md:20` |
| ASI02 | Uso indebido tools | Minima agencia: cada agente con tools acotadas, disallowedTools en reviewers. Evidencia: `security-reviewer.md:3` |
| ASI03 | Abuso identidad/privilegio | Credenciales corta vida via connectionsref, no hardcode. GAP: falta vault dynamic creds — plan Fase C |
| ASI04 | Cadena suministro | Inventario MCP en `.mcp.json:1`, SCA en PR. GAP: firma verificada MCP pendiente |
| ASI05 | RCE | PreToolUse bloquea ejecucion no autorizada, sandbox deny egress. Evidencia: `hooks/validate-prod.mjs:1` |
| ASI06 | Envenenamiento memoria | Validacion escritura memoria (TRACE paso 4). Evidencia: `skills/tellonce/SKILL.md:1` |
| ASI07 | Comms insegura agentes | Mensajes via handoff ledger, deny delegado no permitido. Evidencia: `orquestador.md:5` |
| ASI08 | Fallos cascada | Isolation worktree 1 owner/file + circuit breaker 3 retries. Evidencia: `autonomy-matrix.yaml:1` |
| ASI09 | Explotacion confianza humano-agente | Presenta accion cruda no resumen. Evidencia: `autonomy-matrix.yaml: presenta accion_cruda` |
| ASI10 | Rogue agents | Owner + expiracion por agente, kill switch via settings deny. Evidencia: `settings.json: permissions.deny` |

## ASVS 5.0 (resumen)
- L1 aplicado en backend routes auth check + validacion zod/joi. GAP: L2/L3 para financiero pendiente audit.
- SCA: Dependabot nativo GitHub gratis vs Snyk — elegir Dependabot por coste (Sec 5.7).
