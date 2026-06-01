# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run bd prime when full workflow context is needed.

Issues live in the local Dolt database under .beads/dolt/. Cross-machine sync uses bd dolt push/pull through the git remote under refs/dolt/data. .beads/issues.jsonl is a passive export, not the sync protocol.

## Non-Interactive Shell Commands

Always use non-interactive flags for file operations:

```bash
cp -f source dest
mv -f source dest
rm -f file
rm -rf directory
cp -rf source dest
scp -o BatchMode=yes source host:path
ssh -o BatchMode=yes host command
```

## OpenCode Multi-Agent Rules

The operational source of truth for the OpenCode team is .opencode/AGENTS.md. Keep this root file compact because OpenCode loads it automatically into every agent prompt.

Hard rules:
- Always read a file before editing it.
- Never place scratch/work files in the repository root.
- Never create unnecessary .md files during product tasks.
- Use beads at task start and completion when an issue is related.
- For repartidor UI bugs, use rutero_detail_modal.dart; do not edit albaran_detail_page.dart.
- For new Flutter tabs, update both _getNavItems and _buildCurrentPage in main_shell.dart.
- After modifying Dart models/providers, run dart run build_runner build --delete-conflicting-outputs.
- DB2 DSN is GMP; primary schemas are JAVIER and DSEDAC.
- DB2/AS400 server is 192.168.1.22.
- Backend/application server is 192.168.1.230; backend path is /opt/gmp-api; PM2 production port is 3335. Health checks must call `/api/health` with `User-Agent: GMP-SRE-HealthCheck/1.0`.
- Image server is 192.168.1.191.
- Granja also uses DB2/AS400. Do not introduce PostgreSQL or Supabase into agent plans for these projects.

## OpenCode V4 Chief Engineer Layer

- Default V4 entry point is chief-engineer-assistant for Javier-facing requests, especially mobile or Telegram sessions.
- Layer 1 agents: chief-engineer-assistant, product-ux, Architect-Planner, sre-engineer, appsec-engineer, qa-automation-lead, code-autopilot, tech-radar-agent.
- Layer 2 remains the specialist team in .opencode/agents; direct specialist routing requires explicit @agent mention.
- Before design or implementation, Layer 1 must run rag-query against codebase plus user_corrections/lessons/anti_patterns.
- Tier 2 and Tier 3 work goes to staging first. Production requires QA pass, AppSec pass, SRE health check, and Javier saying "adelante".
- SRE owns production health for 192.168.1.230:3335/api/health and mari-pepa.com; failed post-deploy health at 60 seconds triggers rollback.
- Repeated errors are tracked by same-error-detector; the second matching error in 30 days triggers a retrospective.
- OpenCode Web must never listen on the network without `OPENCODE_SERVER_PASSWORD`; the GMP launcher auto-creates it in `%USERPROFILE%\.config\opencode\.env` if missing.
- Production mutation requires the `production-approval-gate` token; Javier's word `adelante` is necessary but not sufficient unless staging, QA, AppSec and SRE gates are already green.
- GitHub environment gates are active: `production` requires Javier review and only allows `main`; `staging` allows `main`, `develop`, `test`, `pre`, `feat/*`, and `fix/*`.

## Elite Code Quality Bar

- N+1 is a blocking defect: no DB/API/file/network call inside loops over records unless cardinality is proven tiny and documented.
- DB2 list endpoints must batch, join, prefetch into maps, paginate, and use explicit ordering; broad queries require Performance-Analyst review.
- Business-critical flows (facturas, pedidos, cobros, stock, auth, checkout, DB2 writes) require regression tests, idempotency analysis, and rollback plan.
- New providers/endpoints need input validation, timeout, retry/backoff or explicit no-retry reason, cancellation/graceful failure, and typed error mapping.
- Code duplication found by RAG or `rg` must be reused/refactored or rejected with evidence.
- Reviewers must reject clever fragile code: prefer simple invariants, small functions, clear names, and tests around edge cases.
- Before closing Tier 2/3, run or require `elite-quality-gate`; any BLOCK finding for N+1, unsafe SQL, or async-loop patterns prevents delivery.

## References

- Project agent rules: .opencode/AGENTS.md
- Deterministic rules: .opencode/rules.json
- Project memory: .opencode/memory/
- Lessons learned: .agent/nhallucinate/lessons-learned.md
- Beads docs: CLAUDE.md section "Beads Issue Tracker"

