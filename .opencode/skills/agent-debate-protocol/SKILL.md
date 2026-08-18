---
name: agent-debate-protocol
description: How agents debate, push back, and reach consensus before merging changes. Used when multiple specialists disagree.
---

# Skill: agent-debate-protocol — Cómo debatir entre agentes

Aplica cuando dos o más agentes especializados no coinciden en una decisión técnica.

## Principios

1. **El usuario NO debería arbitrar debates técnicos del equipo** — eso es trabajo del orchestrator
2. **Pushback debe ser CONCRETO**, no genérico ("no me gusta" → MAL; "esta query no usa índice X y va a hacer full scan en 2M filas" → BIEN)
3. **Tiempo limitado**: 1-2 rondas de debate. Si no hay consenso, escalar a @oracle (decisión final).
4. **Siempre ofrecer ALTERNATIVA**, no solo objetar
5. **Asume buena fe**: el otro agente tiene razones válidas, busca entenderlas antes de rebatir

## Flujo de debate

### Ronda 1: Propuesta
Agente A entrega solución. Output formato:
```
## Propuesta: [titulo]
- Approach: [X]
- Trade-offs: [Y, Z]
- Risk level: [low/medium/high]
```

### Ronda 2: Review
Agente B (revisor designado por dominio) evalua. Output:

**Si está de acuerdo**:
```
## Acuerdo
✓ [Razones específicas]
- Sugerencia menor: [opcional]
```

**Si discrepa**:
```
## Disagreement
✗ Issue: [problema concreto]
Razón: [por qué importa, con datos/casos]
Alternativa propuesta: [solución B]
Trade-offs alternativa: [coste/beneficio]
Severidad: [blocker / major / minor]
```

### Ronda 3: Resolution
Tres outcomes posibles:
- **Acuerdo**: aceptar review, mergear
- **Compromiso**: agente A modifica con feedback, B re-revisa
- **Escalation**: si severidad blocker y sin acuerdo, → @oracle decide

## Pares de debate canónicos

Pares que SIEMPRE deben revisar el trabajo del otro en cambios sensibles:

| Cambio en | Agente A propone | Agente B revisa |
|---|---|---|
| Auth flows | @auth-flow-architect | @security-sentinel + @red-team-engineer |
| Pagos | @payment-systems-specialist | @auth-flow-architect + @red-team-engineer |
| Queries DB2 críticas | @ibm-i-db2-specialist | @backend-architect (perf) |
| Riverpod design | @riverpod-architect | @flutter-architect (estructura) |
| Next.js RSC | @nextjs-app-router-specialist | @web-perf-vitals (Core Web Vitals) |
| Refactor >500 LOC | @refactoring-specialist | @staff-engineer + @code-reviewer |
| Cambio arquitectónico | @oracle propone | @staff-engineer reta |
| API contract change | @api-crafter / @backend-architect | @flutter-api-dev / @nextjs-app-router-specialist (consumidores) |
| Migrations DB | @database-sage / @ibm-i-db2-specialist | @sre-specialist (downtime/rollback) |
| Performance optimizations | @performance-engineer | @code-reviewer (mantenibilidad vs perf) |

## Anti-patterns

- ❌ "No me gusta" sin razón
- ❌ Personal preference como argumento ("yo siempre uso X")
- ❌ Escalation prematura sin intentar resolver
- ❌ Aprobación por cortesía sin leer
- ❌ Debate eterno sin decisión (>2 rondas → escalar)
- ❌ Pushback como guerra de egos en vez de búsqueda de mejor solución

## Pattern de pushback efectivo

```
Estoy en desacuerdo con [X concreto].

Mi razón: [argumento basado en datos, código, perf measurements, casos reales].

Propongo en su lugar: [Y].

Trade-offs Y vs X:
- Pro: [...]
- Contra: [...]

Si insistes en X, necesito al menos: [mitigación específica, e.g., "test que cubra edge case Z" o "comentario explicando por qué"].
```

## Resolución eficiente

Si tras ronda 2 no hay acuerdo, el orchestrator decide:
- **Severidad blocker**: escala a @oracle. Su decisión es vinculante.
- **Severidad major**: orchestrator elige basado en priorizar velocidad vs calidad según contexto del usuario.
- **Severidad minor**: aceptar la propuesta original con la observación documentada como TODO.

## Documentar el debate

Cuando un debate llega a consenso o escalation, document brevemente en el output al usuario:

```
## Debate técnico interno
@auth-flow-architect propuso JWT con HS256.
@security-sentinel objetó: HS256 + secret leak = todos los tokens comprometidos.
Resolución: cambiado a RS256 con key rotation cada 90 días.
```

Esto da al usuario visibilidad sin obligarle a decidir él.
