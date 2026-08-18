---
type: concept
status: active
summary: Checklist + metricas que sustituyen la revision humana del codigo generado por IA.
tags: [quality, politec, n+1, tests]
---

# Code quality contract

AI-written code is not reviewed by Javier line by line. It passes `.opencode/config/code-quality-contract.yaml` or it does not ship. Enforcer is the `code-quality-contract` tool. Scorecard lands in `.opencode/state/code-quality-scorecard-latest.json`.

Politec dimensions, all blocking when they fail: Purpose, Organization, Legibility, Integration, Tests, Efficiency (N+1=0, no await in forEach), Compliance (parameterized SQL, no secrets, auth on routes). `elite-quality-gate` is the deterministic scanner. A critical-path test must have been executed with a real exit code.

PASS means the Chief may say done. BLOCK means the maker iterates, max 3 loops. Never claim tests, security, or staging evidence that was not obtained.

Related: [[gmp-stack]] [[db2-access]] [[deploy-policy]]
