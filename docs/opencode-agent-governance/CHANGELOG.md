# OpenCode Governance Changelog

## 2026-08-03 — v1 governance pack

- Added committed inventory + agent/workflow classification.
- Formalized security controls, sandbox TTL≤30s policy, intent-validator entry node.
- Documented hybrid compaction + note-taking context strategy.
- Declared Actor-Critic + CRITICAL_ERROR on max_iterations; StateSnapshot after nodes.
- Added ACI registry with destructive/open-world annotations and poka-yoke confirm.
- Added cost governance (Sol/Terra/Luna) + eval gold cases/baseline.
- Mapped AgentOps to gen_ai.* conventions (file exporter; OTLP pending).
- Wired CI workflow `opencode-governance.yml` with baseline gate (canary/auto-rollback policy documented).

### Canary / rollback policy

1. Governance changes land on feat/* first.
2. CI must pass `validate-governance` + `governance.test`.
3. If baseline regresses on main PR → auto-fail job (merge blocked) = rollback signal.
4. Production self-update of agents/config forbidden without proposal + Javier approval (`security-gate.yaml`).
