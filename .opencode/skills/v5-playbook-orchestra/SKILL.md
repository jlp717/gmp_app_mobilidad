---
name: v5-playbook-orchestra
description: >
  Orquestacion V6. Usar SIEMPRE al clasificar una peticion de Javier.
  Playbooks TINY/EXPLORE/BUILD/SWEEP/SECURE/PROD. Roster de 12. Manager owns chat.
---

# Playbook Orchestra V6

Leer `.opencode/memory/FIELD-GUIDE.md` y `.opencode/config/playbooks.yaml`.
Si el tipo de tarea no es obvio: `.opencode/config/capability-catalog.yaml` y `.opencode/config/agency-capability-map.yaml`.

## Pasos del Chief (cada mensaje)

1. Field Guide. No cargar 7 YAML de auditoria.
2. Si correccion de Javier → `correction-capture` y sigue.
3. `decision-router` (devuelve `playbook` + `departments[]` + `required_skills`). `flow-policy-check`. Guardrails.
4. Contexto: `vault/09-index/index.md` + como maximo 3 notas. Repo-Explorer si hace falta codigo.
5. Persist plan + emitEvent. Ejecutar SOLO los agentes del playbook como tools. Spawn maker con `cost_policy.executor_model` y skills de `departments[]`. Recorrer `phases[]`. Gate blocking no se salta.
6. Research: 3-5 Web-Researcher en paralelo. Citation pass. Coding: 1 writer.
7. Si hubo diff: `code-quality-contract`. Sin PASS no hay hecho. Max 3 repair. max_turns del playbook. Calidad always-on: Javier no la pide.
8. PROD: whitelist deploy + palabra adelante. Cero credenciales en el prompt.
9. Nunca ceder la conversacion al especialista. Planner nunca baja de sol. Critic nunca mas barato que el maker.

## Anti-patrones

- Spawnar Flutter-Architecture + Flutter-Data + Flutter-UI + Flutter-Performance a la vez.
- Crear un agente nuevo por SEO, legal, i18n o Stripe. Eso es un escritorio + skill.
- Pedir a prompt-optimizer + Context-Manager + 3 critics en un typo.
- Dejar que el maker se auto-review.
- Decir "listo" sin scorecard PASS.
- Esperar a que Javier diga "hazlo senior / con QA / accesible".
- Leer CLAUDE.md entero, LEDGER, ACI y AGENTS.md en cada turno.
- Poner passwords, tokens o user+pass+host en system prompt, vault o handoff.
- Adoptar A2A. Un solo runtime OpenCode.
- 10+ workers en paralelo para codigo.
