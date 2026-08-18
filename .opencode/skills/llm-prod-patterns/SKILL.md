---
name: llm-prod-patterns
description: LLM in production patterns. Streaming, caching, fallback, cost optimization, eval, structured output, function calling.
---

# Skill: llm-prod-patterns — LLM en Produccion

Patrones probados para integrar LLMs (OpenAI, Anthropic, Groq, etc.) en aplicaciones reales. Refer to @ai-integration-specialist para implementacion deep, @prompt-engineer para prompts.

## Stack moderno (mayo 2026)

| Proveedor | Mejor uso | Modelo flagship | API gratis |
|---|---|---|---|
| Anthropic | Razonamiento, coding | Claude Opus 4.7 | No (paid only) |
| OpenAI | General purpose, function calling | GPT-5.5 | No (creditos iniciales) |
| Google | Multimodal, contexto largo (1M+) | Gemini 2.5 Pro / Flash | Si (Google AI Studio gratis con quota) |
| Groq | Velocidad bestial (LPU) | Llama 3.3 70B Versatile | Si (~6000 req/dia) |
| Cerebras | Velocidad bestial (wafer) | Llama 4 Scout 17B | Si (free tier) |
| OpenRouter | Gateway multi-modelo | Cualquiera (incl. Claude, GPT) | Algunos modelos free |
| DeepSeek | Coding, razonamiento, barato | DeepSeek-V3.5, DeepSeek-R1 | Via OpenRouter free |

## Streaming — siempre que UI espera respuesta

```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

const stream = await client.messages.stream({
  model: 'claude-opus-4-7',
  max_tokens: 4096,
  messages: [{ role: 'user', content: prompt }],
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    res.write(event.delta.text);  // streaming al cliente
  }
}
res.end();
```

Sin streaming = UX terrible para respuestas >5s.

## Prompt caching — 90% mas barato

```typescript
// Anthropic prompt caching (5 min cache de prefijo)
const response = await client.messages.create({
  model: 'claude-opus-4-7',
  system: [
    {
      type: 'text',
      text: longSystemPrompt,  // 5000+ tokens, repetido en cada call
      cache_control: { type: 'ephemeral' },
    },
  ],
  messages,
});
```

OpenAI tambien tiene prompt caching automatico (sin opt-in) en prompts >1024 tokens.

Aplicalo SIEMPRE que repitas system prompt o RAG context.

## Structured output — NO confies en parseo libre

### OpenAI strict mode (JSON garantizado)
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-5.5',
  messages,
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'pedido_extraction',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          cliente: { type: 'string' },
          articulos: { type: 'array', items: { type: 'object', properties: { ... } } },
          total: { type: 'number' },
        },
        required: ['cliente', 'articulos', 'total'],
        additionalProperties: false,
      },
    },
  },
});
const data = JSON.parse(response.choices[0].message.content);
// Validacion adicional con Zod por si acaso
```

### Anthropic — XML tags + Zod validation
```typescript
const prompt = `
Extract from text below.
<output>
  <cliente>...</cliente>
  <articulos>
    <item><nombre>...</nombre><cant>...</cant></item>
  </articulos>
</output>

Text: ${text}
`;
// Parse XML + validate with Zod
```

## Function calling (tool use)

```typescript
const tools = [
  {
    name: 'get_pedido',
    description: 'Obtener pedido por ID',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

let messages = [{ role: 'user', content: 'Busca pedido P00123' }];
while (true) {
  const r = await client.messages.create({ model, tools, messages, max_tokens: 1024 });
  if (r.stop_reason === 'end_turn') break;
  if (r.stop_reason === 'tool_use') {
    const toolUse = r.content.find(c => c.type === 'tool_use');
    const result = await executeFunction(toolUse.name, toolUse.input);
    messages.push({ role: 'assistant', content: r.content });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }] });
  }
}
```

## Fallback strategy

```typescript
const providers = [
  { name: 'anthropic', client: anthropicClient, model: 'claude-opus-4-7' },
  { name: 'openai', client: openaiClient, model: 'gpt-5.5' },
  { name: 'groq', client: groqClient, model: 'llama-3.3-70b-versatile' },
];

for (const p of providers) {
  try {
    return await p.client.messages.create({ model: p.model, messages });
  } catch (err) {
    log.warn({ provider: p.name, err }, 'Provider failed, trying next');
    if (!isTransient(err)) throw err;
  }
}
throw new Error('all_providers_failed');
```

Critico para apps con SLA. Single provider = single point of failure.

## Cost optimization

### Model routing por complejidad
```typescript
function pickModel(task: 'classify' | 'simple' | 'medium' | 'complex'): string {
  return {
    classify: 'claude-haiku-4-5',           // $0.80/1M
    simple: 'gpt-5-mini',                    // $0.50/1M
    medium: 'claude-sonnet-4-6',             // $3/1M
    complex: 'claude-opus-4-7',              // $15/1M
  }[task];
}
```

### Batch APIs (50% discount, 24h SLA)
- Anthropic Message Batches
- OpenAI Batch API
- Para tareas non-realtime (categorizacion, embeddings, summaries de archivo)

### Reduce token waste
- Trim historico conversacion >20 turnos (resumir antes)
- Comprimir context con summary recursivo
- Usar embeddings + RAG en vez de mandar libro entero
- Cache responses identicas (hash del prompt → response)

## Eval pipeline obligatorio

```typescript
// Promptfoo / Langfuse / similar
const cases = [
  { input: 'P001', expected: { cliente: 'Carlos' } },
  { input: 'codigo invalido', expected: { error: true } },
];

for (const c of cases) {
  const r = await extract(c.input);
  expect(r).toMatchObject(c.expected);
}
```

Ejecutar en CI antes de:
- Cambio de prompt
- Cambio de modelo
- Bump de version SDK

## Restricciones
- NUNCA API key en frontend. Siempre proxy server-side.
- NUNCA streaming sin abort signal cuando user navega
- NUNCA confiar output del modelo (validar con Zod / JSON schema)
- NUNCA evals "ad-hoc cuando recordamos" — automatizar en CI
- NUNCA sin rate limit + budget cap per-user (costs runaway)
- SIEMPRE prompt caching para prefijos largos
- SIEMPRE fallback provider
- SIEMPRE log requests/responses con traceId (debugging)

## Anti-pattern famosos
- "Make it work, then we'll optimize cost" — coste vuela rapido
- "We'll add eval later" — tarde es nunca
- Cache busting accidental (timestamp en system prompt → cache miss siempre)
- 1 modelo para todo (Opus para clasificar es caro)
- No streaming → UX horrible para >2s respuesta
- Sin telemetria → "no se por que es lento/caro/malo"
