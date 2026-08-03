# OpenCode Governance Changelog

## 2026-08-03 — v1.1 leftovers closed

- OTLP: optional live exporter behind `OTEL_EXPORTER_OTLP_ENDPOINT` (fail-soft); file exporter remains primary. See `canon/otel-agentops.yaml`.
- Sandbox: `process_isolate` fallback when Docker missing (TTL≤30, workspace-only, egress deny / network fail-closed).
- Canary: `canary-eval-rollback.mjs` + CI job auto-rollback on eval regression (staging/local markers; no prod deploy).
- Gitignore: selective track of `model-routing.yaml`, `agent-graph.yaml`, `semantic-memory-pruner.yaml`, degraded agents, `telegram-notify` + `semantic-memory-pruner` tools. `CREDENCIALES.md` stays ignored.
- Degrade complete: `memory-cleaner` → `semantic-memory-pruner`; `Metrics-Observer` → `cost-latency-threshold.mjs`; `Release-Notifier` → `telegram-notify`.

## 2026-08-03 — v1 governance pack

- Added committed inventory + agent/workflow classification.
- Formalized security controls, sandbox TTL≤30s policy, intent-validator entry node.
- Documented hybrid compaction + note-taking context strategy.
- Declared Actor-Critic + CRITICAL_ERROR on max_iterations; StateSnapshot after nodes.
- Added ACI registry with destructive/open-world annotations and poka-yoke confirm.
- Added cost governance (Sol/Terra/Luna) + eval gold cases/baseline.
- Mapped AgentOps to gen_ai.* conventions (file exporter; OTLP pending → closed in v1.1).
- Wired CI workflow `opencode-governance.yml` with baseline gate (canary/auto-rollback policy documented).

### Canary / rollback policy

1. Governance changes land on feat/* first.
2. CI must pass `validate-governance` + `governance.test`.
3. Optional canary candidate via `workflow_dispatch` input or `--candidate`.
4. `canary-eval-rollback.mjs`: PASS promotes candidate → `last_known_good`; FAIL while canary → restore `last_known_good` and exit 1.
5. Production self-update of agents/config forbidden without proposal + Javier approval (`security-gate.yaml`).
6. Does **not** deploy to `192.168.1.230`.

### Enable OTLP (optional)

```bash
# Local collector example (no secrets required for plain HTTP):
set OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
# Optional auth headers (never commit):
set OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20...
```

If unset or POST fails, spans still land in `.opencode/state/otel-genai.jsonl`.
