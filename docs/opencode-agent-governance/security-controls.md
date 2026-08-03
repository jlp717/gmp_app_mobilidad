# Security Controls — OpenCode Team

Priority #1 for the 2026-08-03 governance audit.

## Controls matrix

| Control | Implementation | Enforcement |
|---------|----------------|-------------|
| Least-privilege writes | Chief/agent `permission.edit` allowlists; proposals dir for config; `file-gate-check` | `.opencode/agents/*.md` + `security-gate.yaml` |
| No shared master key inheritance | Per-agent model + tools frontmatter; `model-assignment-audit` blocks inheritance | `model-routing.yaml` + audit tool |
| Code sandbox | `sandbox-run`: Docker `--network none` default, `--memory 512m`, `--cpus 1`, read-only root, no-new-privileges, workspace mount only | `sandbox-run.ts` + `canon/sandbox-policy.yaml` |
| Sandbox TTL | Default **30s**, hard max **30s** unless `allow_extended_ttl` + justification | Hardened tool + validator |
| Egress allow-list | Network off by default; `network:true` requires justification note in ledger | Policy + HITL for prod egress |
| Intent validator entry | `intent-validator` workflow node before route/delegate | `canon/intent-validator.yaml` + tool stub |
| Untrusted content marking | External web/docs/MCP marked `UNTRUSTED_EXTERNAL`; never override system rules | `AGENTS.md` + anti-hallucination-guard |
| HITL delete/deploy/spend/out-of-scope | Telegram HITL + `production-approval-gate` + plan-approval + budget unfreeze | `telegram-hitl-gateway.yaml`, `production-safety.yaml` |
| No hardcoded secrets | `env-protection` blocks `.env`/keys; gitleaks in `team-ci` | plugins + CI |
| Log redaction | Flow traces summarize args (no full secrets); metrics redacted | `flow-observability.ts` |

## Identity model

- Each agent has explicit `model` (no global inherit).
- Tool allowlists are per-agent; high-impact tools (`sandbox-run`, `staging-deploy`, `production-approval-gate`, `snapshot-restore`) bounded to Chief / SRE / DevOps only.
- Config mutation: proposal-only (`security-gate.yaml`); Chief cannot write `.opencode/config/**` directly.

## Residual risks (open)

1. OTEL live exporter not wired to collector (spans are file-based today).
2. Sandbox requires Docker on host; absent Docker → tool fails closed (good) but no alternate isolate.
3. `.opencode/CREDENCIALES.md` exists locally and must never be committed (directory gitignored).

See also: `canon/sandbox-policy.yaml`, `canon/intent-validator.yaml`.
