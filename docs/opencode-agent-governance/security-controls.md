# Security Controls — OpenCode Team

Priority #1 for the 2026-08-03 governance audit.

## Controls matrix

| Control | Implementation | Enforcement |
|---------|----------------|-------------|
| Least-privilege writes | Chief/agent `permission.edit` allowlists; proposals dir for config; `file-gate-check` | `.opencode/agents/*.md` + `security-gate.yaml` |
| No shared master key inheritance | Per-agent model + tools frontmatter; `model-assignment-audit` blocks inheritance | `model-routing.yaml` + audit tool |
| Code sandbox | Docker preferred; else `process_isolate` (workspace-only, stripped env, TTL kill) | `sandbox-run.ts` + `canon/sandbox-policy.yaml` |
| Sandbox TTL | Default **30s**, hard max **30s** unless `allow_extended_ttl` + justification | Hardened tool + validator |
| Egress allow-list | Network off by default; `network:true` requires Docker + HITL; without Docker = fail-closed | Policy + tool |
| Intent validator entry | `intent-validator` workflow node before route/delegate | `canon/intent-validator.yaml` + tool stub |
| Untrusted content marking | External web/docs/MCP marked `UNTRUSTED_EXTERNAL`; never override system rules | `AGENTS.md` + anti-hallucination-guard |
| HITL delete/deploy/spend/out-of-scope | Telegram HITL + `production-approval-gate` + plan-approval + budget unfreeze | `telegram-hitl-gateway.yaml`, `production-safety.yaml` |
| No hardcoded secrets | `env-protection` blocks `.env`/keys; gitleaks in `team-ci` | plugins + CI |
| Log redaction | Flow traces summarize args (no full secrets); metrics redacted | `flow-observability.ts` |
| OTLP optional | `OTEL_EXPORTER_OTLP_ENDPOINT` fail-soft; headers via env only | `otel-agentops.yaml` + plugin |

## Identity model

- Each agent has explicit `model` (no global inherit).
- Tool allowlists are per-agent; high-impact tools (`sandbox-run`, `staging-deploy`, `production-approval-gate`, `snapshot-restore`) bounded to Chief / SRE / DevOps only.
- Config mutation: proposal-only (`security-gate.yaml`); Chief cannot write `.opencode/config/**` directly.

## Residual risks

1. ~~OTLP live exporter~~ — **closed** (optional env, fail-soft).
2. ~~Sandbox without Docker~~ — **closed** (`process_isolate`; network still fail-closed without Docker).
3. `.opencode/CREDENCIALES.md` local-only — must never be committed (directory ignore + explicit never-track note).
4. Process isolate cannot enforce cgroup memory/CPU or true packet egress filter — Docker remains preferred for strong isolation.

See also: `canon/sandbox-policy.yaml`, `canon/intent-validator.yaml`, `CHANGELOG.md`.
