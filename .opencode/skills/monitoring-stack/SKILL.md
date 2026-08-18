---
name: monitoring-stack
description: Production monitoring stack patterns. Prometheus, Grafana, Loki, OpenTelemetry, Sentry, alert design, dashboards.
---

# Skill: monitoring-stack — Stack de Monitoreo

Patrones para implementar la stack de observabilidad moderna. Refer to @observability-architect para deep work.

## Stack canonico (open source)

```
┌─────────────────────────────────┐
│ Apps emiten:                    │
│  - logs (JSON via stdout)       │
│  - metrics (/metrics endpoint)  │
│  - traces (OTel exporter)       │
└──────┬──────────────────────────┘
       │
       v
┌──────────────────┬─────────────────┬──────────────────┐
│ Loki             │ Prometheus       │ Tempo / Jaeger   │
│ (logs)           │ (metrics)        │ (traces)         │
└────────┬─────────┴────────┬────────┴────────┬─────────┘
         │                  │                 │
         └──────────┬───────┴─────────────────┘
                    v
              Grafana (UI)
                    │
                    v
              Alertmanager → PagerDuty / Slack
```

## Logs estructurados — JSON siempre

```typescript
// Pino (Node) — fast structured logger
import pino from 'pino';
const log = pino({
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password'],
  serializers: pino.stdSerializers,
});

log.info({ userId, orderId, durationMs: 142 }, 'Order created');
```

```dart
// Dart — package:logging
final log = Logger('PedidosService');
log.info('Pedido creado: ${jsonEncode({"vendedor": v, "importe": i})}');
```

## Metrics — modelo RED para servicios

```typescript
const reqCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const reqDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

// En middleware
const end = reqDuration.startTimer({ method: req.method, route: req.route?.path });
res.on('finish', () => {
  reqCounter.inc({ method: req.method, route: req.route?.path, status: res.statusCode });
  end();
});
```

## Tracing distribuido (OpenTelemetry)

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'gmp-api',
  traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

Auto-instrumenta Express, ODBC, fetch, etc. Luego en logs incluir traceId:

```typescript
import { trace } from '@opentelemetry/api';
const span = trace.getActiveSpan();
log.info({ traceId: span?.spanContext().traceId, userId }, 'event');
```

## Alert design — SLO based, NO threshold magico

### MAL
```yaml
- alert: HighLatency
  expr: http_request_duration_seconds{quantile="0.99"} > 1
```

### BIEN — basado en SLO + burn rate
```yaml
- alert: SloErrorBudgetBurning
  expr: |
    (
      sum(rate(http_requests_total{status=~"5.."}[1h]))
      / sum(rate(http_requests_total[1h]))
    ) > (1 - 0.999) * 14
  for: 2m
  annotations:
    runbook_url: https://wiki/runbooks/slo-burn
```

Multi-window multi-burn-rate (Google SRE book): paginas si quemas budget rapido (1h @ 14x) o sostenido lento (6h @ 6x).

## Dashboard organizado

### Por servicio
- Top: estado actual (UP/DOWN, latency p99, error rate, throughput)
- Medio: trends 24h (sparkline)
- Bottom: detail si profundizas (per endpoint, per status)

### Para SREs (USE pattern)
- Utilization (%)
- Saturation (queue length, wait time)
- Errors

### Para producto (RED pattern)
- Rate (req/s)
- Errors (% 5xx)
- Duration (p50, p95, p99)

## Sentry / error tracking

```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.GIT_SHA,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Sanitize PII
    if (event.user?.email) event.user.email = hashEmail(event.user.email);
    return event;
  },
});
```

Source maps subir en CI release:
```bash
sentry-cli releases new $GIT_SHA
sentry-cli releases files $GIT_SHA upload-sourcemaps dist/
sentry-cli releases finalize $GIT_SHA
```

## Cardinalidad — peligro silencioso

Prometheus colapsa con cardinalidad alta:
```
http_requests_total{userId="u123"}    ← MAL: cada user es serie nueva
http_requests_total{user_segment="A"} ← BIEN: bucketeado
```

Limites prudentes:
- Max 100 valores por label
- Max 10 labels por metric
- Total series < 1M (warning), < 10M (red)

## Prod readiness checklist

- [ ] /health endpoint para liveness probe
- [ ] /ready endpoint para readiness (verifica deps)
- [ ] /metrics endpoint Prometheus
- [ ] Logs JSON con traceId
- [ ] Sentry configured con release tag
- [ ] Alertas SLO-based, runbook url anotado
- [ ] Dashboard del servicio en Grafana
- [ ] On-call rotation definida

## Restricciones
- NUNCA log credentials/PII (usa `redact` en config logger)
- NUNCA cardinalidad alta (userId, orderId como label)
- NUNCA alertas sin runbook_url
- NUNCA sample 100% traces en prod (cost + storage)
- SIEMPRE traceId en logs para join
- SIEMPRE source maps en Sentry
