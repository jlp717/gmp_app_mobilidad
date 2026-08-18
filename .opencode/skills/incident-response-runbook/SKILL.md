---
name: incident-response-runbook
description: Incident response template — SEV1/2/3 triage, IC roles, blameless postmortem, action items tracking.
---

# Skill: incident-response-runbook

Template completo para responder a incidentes de producción de forma profesional.

## Severidades

- **SEV1**: customer-facing total outage / data loss / security breach → all hands, status page red, page CEO si cliente enterprise afectado
- **SEV2**: partial outage o major degradation → on-call team, status page yellow
- **SEV3**: minor issue, workaround exists → next business day
- **SEV4**: cosmetic or internal only → backlog

## Roles durante incidente

- **Incident Commander (IC)**: lidera, NO trabaja técnico. Coordina, decide, comunica
- **Tech Lead**: investiga + ejecuta fixes
- **Communications Lead**: actualiza stakeholders, status page, customer-facing
- **Scribe**: timeline detallado para postmortem

## Timeline durante incidente

```markdown
# Incident [TITLE] — [DATE]

## Detection
- HH:MM: Alert dispared (qué alerta, cuál métrica)
- HH:MM: Confirmed by [person]

## Response
- HH:MM: IC asignado: [name]
- HH:MM: Severity declared: SEV[1-4]
- HH:MM: War room creado (Slack channel: #incident-XXX)

## Investigation
- HH:MM: Hipótesis #1: [...] → descartada porque [...]
- HH:MM: Hipótesis #2: [...] → confirmada con [...]

## Mitigation
- HH:MM: Mitigación aplicada: [rollback / config change / scale up]
- HH:MM: Métrica X recuperada (de Y a Z)

## Resolution
- HH:MM: Servicio restaurado
- HH:MM: All clear
- HH:MM: Post-incident review programada para [fecha]
```

## Postmortem (template, blameless)

```markdown
# Postmortem — [Incident title] — [date]

## Summary
[2-3 líneas: qué pasó, impacto, duración]

## Impact
- Duration: X min
- Users affected: ~Y
- Error budget burned: Z%
- Revenue impact: $W (si aplica)

## Root cause
[5 whys hasta llegar al SISTEMA, NO a la persona]

Why 1: ¿Por qué cayó el servicio?
Why 2: ¿Por qué pasó eso?
Why 3: ¿Por qué no se detectó antes?
Why 4: ¿Por qué el sistema lo permitió?
Why 5: ¿Por qué [contributing factor]?

## Timeline
[Detallado UTC, copiar del scribe]

## What went well
- Detection: alerta a los X min
- Response: IC asignado en Y min
- Mitigation: rollback automático funcionó

## What went wrong
- [Concreto, sistema-focused]

## Action items
| # | Action | Owner | Due | Priority |
|---|--------|-------|-----|----------|
| 1 | Add monitoring for X | @user | YYYY-MM-DD | HIGH |
| 2 | Improve runbook for Y | @user | YYYY-MM-DD | MED |

## Lessons learned
[Patrón aplicable a otros sistemas]
```

## Reglas blameless

- NUNCA "X persona hizo el bug" → "El sistema permitió que un cambio sin test de carga llegara a prod"
- NUNCA culpar individuo en escritura
- NUNCA acusar de negligencia
- SIEMPRE focus en sistema, procesos, defensas faltantes

## Action items obligatorios

- Cada action tiene owner + deadline
- Si no se completa antes del deadline → review en standup
- Acciones P0 con 14 días, P1 con 30 días, P2 con 90 días

## Comunicación externa

### Status page durante incidente
```
[INVESTIGATING] We are aware of an issue affecting [service].
Investigating root cause. Updates every 15 min.

[IDENTIFIED] We have identified the issue and are deploying a fix.

[MONITORING] A fix has been deployed and we are monitoring.

[RESOLVED] The issue has been resolved. Postmortem to follow.
```

### Customer email post-resolution (SEV1/2)
- ¿Qué pasó? (sin detalles técnicos)
- ¿Qué hicimos para arreglar?
- ¿Qué hacemos para prevenir?
- Disculpa sincera si afectó workflow del cliente
- Compensación si SLA violado

## Tooling

- **Status page**: Atlassian Statuspage / Better Uptime / Instatus
- **Incident management**: PagerDuty / OpsGenie / FireHydrant
- **War room**: Slack channel `#incident-YYYYMMDD-name`
- **Timeline**: scribe en doc compartido tiempo real
- **Postmortem**: Confluence / Notion / repo `/postmortems/`

## Restricciones

- NUNCA empezar a "arreglar" sin declarar IC primero
- NUNCA cambiar prod sin aprobación IC
- NUNCA cerrar sin postmortem si SEV1/2
- SIEMPRE documentar action items, OWN-deadline
- SIEMPRE blameless en escritura

## Cuando NO aplicar este skill
- Bug minor sin impacto cliente → tickets normales
- Performance degradation sin SLA breach → optimization regular
- Investigación rutinaria → no escalation
