---
name: headroom-context
description: Compresion de contexto LLM con headroom-ai (headroomlabs-ai). Comprime tool outputs, logs, RAG chunks e historial antes de llegar al modelo: menos tokens, mismo resultado.
---
# Headroom Context Compression

## Que es
headroom-ai comprime todo lo que el agente lee (tool outputs, logs, RAG, archivos, historial) antes del LLM. SDK TypeScript: headroom-ai (npm). CLI/Python: pip install headroom-ai[all].

## Uso basico (TS)

import { compress } from "headroom-ai";
const result = await compress(messages, { model: "gpt-4o", tokenBudget: 50000 });
console.log(result.tokensBefore, result.tokensAfter, result.transformsApplied);



## Donde aplicar en el harness
- Context packets de delegacion: comprimir antes del handoff-ledger.
- RAG: comprimir chunks antes de inyectarlos al contexto.
- Logs/salidas largas de tools: comprimir antes de responder.
- Historicos de sesion larga: comprimir antes de compactar.

## Config
- .opencode/config/headroom.yaml define rutas y umbrales.
- Paquete instalado en .opencode-runtime/ecc-npm/node_modules/headroom-ai.

## Reglas
- Nunca comprimir: correcciones de Javier, gates, evidencia de seguridad.
- La compression es para ahorrar tokens; la evidencia debe seguir verificable.
