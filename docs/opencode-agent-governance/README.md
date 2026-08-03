# OpenCode Agent Governance Pack

Committed source of truth for the 2026-08-03 multi-agent audit protocol.  
Local runtime still uses `.opencode/` (often gitignored); validators check both when present.

## Contents

| Path | Purpose |
|------|---------|
| `governance-standard.yaml` | Master checklist ↔ implementation map |
| `security-controls.md` | Security-by-design controls |
| `context-strategy.md` | Context isolation + long-task strategy |
| `workflow-patterns.md` | Graph topology & explicit patterns |
| `evals-calibration.md` | Eval suite + LLM-as-judge calibration |
| `CHANGELOG.md` | Versioned prompt/YAML/model governance changes |
| `canon/` | Machine-readable policies copied into `.opencode/config/governance/` |
| `evals/` | Gold cases + baseline scores |

## Priority order enforced

1. Security (least privilege, HITL, sandbox, intent validator, redaction)
2. Anti-infinite-loop (`max_iterations` → `CRITICAL_ERROR`, anti-doom-loop)
3. Everything else (ACI, cost, evals, OTEL, canary CI)

## Verify

```bash
node scripts/opencode-governance/validate-governance.mjs
node --test scripts/opencode-governance/governance.test.mjs
```

CI: `.github/workflows/opencode-governance.yml`
