---
name: prompt-optimization
description: Optimize prompts for cost (tokens), latency, and quality. Caching strategies, structured outputs, model routing, eval-driven iteration.
---

# Skill: prompt-optimization — Cost / Latency / Quality

Procedimiento para llevar un prompt de "funciona" a "production-grade".

## Las 3 dimensiones (jerárquicas)

1. **Calidad** (sin esto, las demás importan poco)
2. **Coste** (tokens × precio modelo)
3. **Latencia** (time to first token + tokens/sec)

## Workflow optimización

### Paso 1: Baseline
- Prompt actual + 10-20 inputs reales como dataset eval
- Medir: % éxito (vs ground truth), tokens medios in/out, latencia p50/p95, $ por call

### Paso 2: Calidad primero
- ¿El prompt es claro? Test con LLM-as-judge o human eval
- Few-shot 3-5 ejemplos representativos calibrados
- Chain-of-thought solo en modelos sin reasoning interno (o1, R1, Opus thinking ya razonan)
- Structured output (JSON schema, Anthropic tool_use) si parseado posterior

### Paso 3: Coste
- **Prompt caching** (huge savings):
  - Anthropic: `cache_control: ephemeral` en system prompt + ejemplos
  - OpenAI: auto-cache en prompts >1024 tokens
  - 90% descuento en hits, 5min TTL
- **Comprimir context**:
  - Resumir conversaciones largas (>20 turnos) en system summary
  - RAG retrieval top-K relevante en lugar de full context
  - Eliminar few-shot redundantes (3 calibrados > 10 random)
- **Model routing** por complejidad:
  - Clasificación / extracción simple → Haiku ($0.80/1M)
  - Coding / razonamiento medio → Sonnet ($3/1M)
  - Critical reasoning → Opus ($15/1M)
- **Batch APIs** (50% off) para tareas non-realtime

### Paso 4: Latencia
- Streaming siempre que UI muestra al usuario
- Modelo más rápido si calidad equivalente (Haiku 2x más rápido que Sonnet)
- Reducir output length con instrucciones explicitas ("Respond in <100 words")
- Avoid chain-of-thought visible si user no lo necesita

### Paso 5: Eval automático
```typescript
// Promptfoo / Langfuse / similar
const cases = [
  { input: '...', expected: '...' },
];

for (const c of cases) {
  const out = await runPrompt(c.input);
  assert(matchesExpected(out, c.expected));
}
```

CI bloquea merge si eval rate <95%.

## Patterns concretos

### Anthropic — prompt caching agresivo
```typescript
const r = await client.messages.create({
  model: 'claude-sonnet-4-6',
  system: [
    { type: 'text', text: shortIntro },
    { type: 'text', text: longSystemPrompt, cache_control: { type: 'ephemeral' }},  // este se cachea
    { type: 'text', text: examples, cache_control: { type: 'ephemeral' }},  // este también
  ],
  messages,
});
```

Dentro de 5 min, hits cacheados cuestan ~10% del precio normal.

### OpenAI — JSON strict
```typescript
const r = await openai.chat.completions.create({
  model: 'gpt-5.5',
  messages,
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'X', strict: true, schema: {...} },
  },
});
```

100% JSON válido garantizado por el modelo.

### Reduce few-shot a lo mínimo viable
```
ANTES (10 ejemplos): 5000 tokens
DESPUÉS (3 ejemplos calibrados): 1500 tokens
Calidad: misma o mejor (3 calibrados > 10 random)
Ahorro: 70% tokens
```

### Output length cap
```
Bad: "Respond appropriately"
Good: "Respond in maximum 3 bullet points, under 80 words total"
```

## Anti-patterns

- "Be detailed" sin límite → output infinito
- Chain-of-thought pidiendo explícito en o1/R1/Opus thinking → desperdicio tokens (ya razonan internamente)
- System prompt repetido en cada call sin caching → dinero quemado
- Eval ad-hoc cuando recordamos → tarde es nunca
- Production prompts sin versionar
- Trust output del modelo sin validation (parse JSON, sanitize)

## Checklist pre-producción

- [ ] Prompt versionado (git)
- [ ] Eval suite con >20 casos
- [ ] CI ejecuta evals en cambios prompt
- [ ] Prompt caching activo si posible
- [ ] Model routing por complejidad implementado
- [ ] Streaming si UI esperaba response >2s
- [ ] Structured output validation (Zod / JSON schema)
- [ ] Logs estructurados con tokens, model, cost por request
- [ ] Rate limit + budget cap per user
- [ ] Fallback provider configurado

## Métricas a monitorear

- Tokens in/out p50, p95 medios
- Cost per request medio
- Latency TTFT + total
- Eval pass rate (debe ser estable >95%)
- Cache hit rate (objetivo >50%)
- Error rate por type (rate limit, auth, parse error)

## Coordinación

- @prompt-engineer: diseño prompts
- @cost-engineer: análisis $$/request
- @ai-integration-specialist: SDK, fallback, streaming
- @observability-architect: logs / metrics
