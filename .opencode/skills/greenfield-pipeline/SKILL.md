---
name: greenfield-pipeline
description: >
  Fabrica de producto (app/web seria). Usar cuando Javier pide app completa,
  entregable a cliente, idea desde cero con frontend+backend+SEO, o producir
  en masa. Un maker. Loop hasta product-delivery-contract PASS. No organigrama.
---
# Fabrica (no vibecode)

Javier habla al Chief. Roster de 12. Fases en `.opencode/config/task-playbooks.yaml#factory`.
Contrato: `.opencode/config/product-delivery-contract.yaml`.
Escritorios: `.opencode/config/agency-capability-map.yaml` `client_delivery_defaults`. El router enciende pagos/i18n/CMS solo si salen en la idea.

## Bucle (hasta PASS o 12 ticks)

1. Living spec EARS + reglas de negocio + fuera de alcance. Sin esto, no hay codigo.
2. Arquitectura por capas. Frontend nunca habla a DB.
3. Vertical backend: auth, validacion, errores tipados, credentials_ref, test del endpoint.
4. Vertical frontend: loading/empty/error, tokens, a11y real (Playwright o Semantics).
5. A11y + copy + legal UE (privacy/cookies o noindex). Cero lorem.
6. SEO: title, meta, h1, OG, canonical, sitemap o noindex.
7. Perf: LCP/INP/CLS o equivalente Flutter. Numeros, no impresion.
8. Observabilidad + CI: health, logs, cero console.log, evidencia en PR.
9. Analytics o no-tracking escrito.
10. AppSec ve el diff. 0 secretos. AppSec no escribe el parche.
11. Critic sol. code-quality-contract PASS.
12. PR con evidencia. No merge a main. Prod = adelante.

Si un gate falla: el maker recibe el reporte (test, Lighthouse, analyze). Goal-loop-manager.
Prod, .env y pm2 fuera de este bucle.

## Anti-vibecode (BLOCK)

TODO en camino critico, any, console.log, mock en prod, lorem, test skipped, secreto, SQL concat, N+1, pantalla sin estados, catch vacio.

## No hacer

- Spawnar 8 especialistas Flutter/Node a la vez.
- Crear Legal-Agent o SEO-Agent. Son skills del maker.
- Declarar "listo para el cliente" sin product-delivery-contract PASS.
- Desplegar produccion desde la fabrica.
