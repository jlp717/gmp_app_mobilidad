# Continuous Evaluation & LLM-as-Judge Calibration

## Regression eval suite

Location: `docs/opencode-agent-governance/evals/`

| Artifact | Role |
|----------|------|
| `gold-cases.json` | Real failure-derived cases (routing, HITL, doom-loop, sandbox) |
| `baseline.json` | Minimum scores; architecture/prompt/model changes must not regress |
| Validator | `scripts/opencode-governance/validate-governance.mjs` runs deterministic checks |
| Node tests | `scripts/opencode-governance/governance.test.mjs` |

## When evals are required

- Prompt / agent frontmatter changes
- Tool schema or ACI annotation changes
- Model routing / fallback changes
- Workflow state machine or gate changes

Rule: **suite score ≥ baseline** or BLOCK merge (CI job `opencode-governance`).

## Deterministic vs LLM-as-judge

Prefer deterministic checks (schema presence, max_iterations CRITICAL_ERROR, sandbox TTL ≤30, inventory counts, classification file present).

LLM-as-judge is **optional** for narrative quality only. When used:

### Calibration protocol

1. Freeze 10 gold narratives with human labels (PASS/WARN/BLOCK).
2. Run judge prompt twice; agreement with human must be ≥ 0.8 Cohen-like accuracy.
3. Document judge model + temperature (0) + prompt hash in `CHANGELOG.md`.
4. Never use LLM-as-judge alone for security or production gates.

Current default: **deterministic-only** in CI (no LLM judge spend).
