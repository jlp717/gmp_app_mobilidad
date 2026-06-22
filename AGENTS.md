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
- Runtime health source is .opencode/config/runtime-health.yaml. The old 3197 backend port was verified not listening on 2026-06-07; do not use it for readiness decisions unless SRE verifies a later change.
- Remote Granja canonical path is `/var/www/mari-pepa`; `/var/www/granjamaripepa` was verified missing and must not be assumed.
- Image server is 192.168.1.191.
- Granja also uses DB2/AS400. Do not introduce PostgreSQL or Supabase into agent plans for these projects.

## OpenCode V4 Chief Engineer Layer

- Default V4 entry point is chief-engineer-assistant for Javier-facing requests, especially mobile or Telegram sessions.
- Javier launcher: `C:\Users\Javier\Start_OpenCode_Web_Gmp.cmd` (o `start-opencode-web-gmp.cmd`) → supervisor → OpenCode Web :3090 → post-arranque automatico. `Startup\Encode\web.cmd` solo redirige al launcher de Javier.
- Every Chief message follows `.opencode/config/chief-protocol.yaml`: prompt-optimizer → decision-router → flow-policy → execute → verify → learn.
- Layer 1 agents: chief-engineer-assistant, product-ux, Architect-Planner, sre-engineer, appsec-engineer, qa-automation-lead, code-autopilot, tech-radar-agent.
- Team Curator is the weekly team-health auditor: agent roster, route eval, flow policy, models, metrics, repeated errors, tech radar and Telegram summary.
- Pillar experts include DB2-Query-Optimizer, Redis-Cache-Specialist, Runtime-Log-Diagnostician, Flutter-Architecture-Specialist, Flutter-Performance-Specialist, API-Contract-Specialist, Visual-Design-Specialist, Technical-Verifier, plus backend, DB2, Flutter, QA and reviewer specialists.
- Layer 2 remains the specialist team in .opencode/agents; direct specialist routing requires explicit @agent mention.
- Before design or implementation, Layer 1 must run rag-query against codebase plus user_corrections/lessons/anti_patterns.
- Tier 2 and Tier 3 work goes to staging first. Production requires QA pass, AppSec pass, SRE health check, and Javier saying "adelante".
- SRE owns production health for 192.168.1.230:3335/api/health and mari-pepa.com; failed post-deploy health at 60 seconds triggers rollback.
- Repeated errors are tracked by same-error-detector; the second matching error in 30 days triggers a retrospective.
- Explicit corrections from Javier are captured by `correction-capture` and `user-correction-capture`; phrases like "aprende esto", "te corrijo", "no vuelvas a", "recuerda que", "prefiero que" or `/teach` must be stored before continuing and override generic memory.
- OpenCode Web must never listen on the network without `OPENCODE_SERVER_PASSWORD`; the GMP launcher auto-creates it in `%USERPROFILE%\.config\opencode\.env` if missing.
- Production mutation requires the `production-approval-gate` token; Javier's word `adelante` is necessary but not sufficient unless staging, QA, AppSec and SRE gates are already green.
- Task classification source: .opencode/config/task-classification.yaml. T1/T2/T3 controls workflow, R0-R4 controls risk, A/B/C controls model quality, A0-A4 controls autonomy, and V0-V4 controls verification.
- Model routing source: .opencode/config/model-routing.yaml. OpenAI handles critical reasoning and reliable code work while Cursor exposes no models; Cursor ACP is allowed for code/test implementation with non-GPT models only after a successful probe; OpenCode Go handles low-risk/research/metrics work. OpenCode Zen is manual-only.
- State machine source: .opencode/config/workflow-state-machine.yaml. Persisted state and gates override agent intuition.
- Natural-language decision tree source: .opencode/config/orchestrator-decision-tree.yaml. Javier talks to the Chief in natural language; slash commands are internal equivalents, not required user behavior.
- Goal loops source: .opencode/config/goal-loops.yaml. Objectives iterate via goal-loop-manager until completion_promise or max_iterations; global defaults in ~/.config/opencode/goal-loops-defaults.yaml.
- Hybrid interaction source: .opencode/config/hybrid-interaction.yaml. Loops pause and ask Javier on ambiguity; natural language remains the only required interface.
- Background automation: `.opencode/config/automation-schedule.json` runs on `.cmd` startup (non-blocking) and optional Windows Task Scheduler. Providers: OpenAI, Cursor ACP, OpenCode Go — not Claude.
- GitHub watchlist: `.opencode/config/github-watchlist.yaml` + `github-watchlist-sync` tool.
- Subagent communication source: `handoff-ledger` and .opencode/state/handoffs/. Tier 2/Tier 3 delegation must record context_packet before handoff and specialist_output after return.
- Readiness source: .opencode/state/readiness-latest.json. Cursor can only become an automatic primary model when readiness reports Cursor `AVAILABLE`; otherwise it stays fallback/manual.
- Runtime-health source: .opencode/config/runtime-health.yaml. GMP backend readiness must be checked over SSH on 192.168.1.230 with localhost:3335/api/health, not by direct PC TCP probes alone.
- Production discovery/log reading is R3 unless it mutates production; DB2 DDL/DML, deploy, rollback, secret rotation, or pm2 mutation is R4.
- GitHub environment gates are active: `production` requires Javier review and only allows `main`; `staging` allows `main`, `develop`, `test`, `pre`, `feat/*`, and `fix/*`.

## Elite Code Quality Bar

- N+1 is a blocking defect: no DB/API/file/network call inside loops over records unless cardinality is proven tiny and documented.
- DB2 list endpoints must batch, join, prefetch into maps, paginate, and use explicit ordering; broad queries require Performance-Analyst review.
- Business-critical flows (facturas, pedidos, cobros, stock, auth, checkout, DB2 writes) require regression tests, idempotency analysis, and rollback plan.
- New providers/endpoints need input validation, timeout, retry/backoff or explicit no-retry reason, cancellation/graceful failure, and typed error mapping.
- Code duplication found by RAG or `rg` must be reused/refactored or rejected with evidence.
- Reviewers must reject clever fragile code: prefer simple invariants, small functions, clear names, and tests around edge cases.
- Before closing Tier 2/3, run or require `elite-quality-gate`; any BLOCK finding for N+1, unsafe SQL, or async-loop patterns prevents delivery.
- External mutations and production deploys require an `idempotency_key` or a documented `no_retry_reason`; retries without one are BLOCK.
- Before trusting the team configuration, run or require `agent-roster-audit`; BLOCK findings mean the roster is not ready.
- Before trusting model routing, run or require `model-assignment-audit`; BLOCK findings mean an agent is inheriting, using forbidden Zen automation, using GPT through Cursor, or disagreeing with fallback-models.
- Before trusting workflow state, run or require `workflow-state-audit`; BLOCK findings mean approval, transition, or production gates are incomplete.
- Before executing a Tier 2/3 route, run or require `flow-policy-check`; BLOCK findings mean the route is unsafe or incomplete.
- Before accepting subagent output in Tier 2/3, run or require `handoff-ledger`; BLOCK output means missing evidence or invalid specialist contract.
- Before starting high-risk mobile work, run or require `readiness-smoke`; BLOCK findings mean MCPs, skills, tools, commands or providers are not ready.

## References

- Project agent rules: .opencode/AGENTS.md
- Deterministic rules: .opencode/rules.json
- Project memory: .opencode/memory/
- Handoff contract: .opencode/config/handoff-contract.yaml
- Natural language decision tree: .opencode/config/orchestrator-decision-tree.yaml
- Task classification: .opencode/config/task-classification.yaml
- Model routing: .opencode/config/model-routing.yaml
- Workflow state machine: .opencode/config/workflow-state-machine.yaml
- Runtime health: .opencode/config/runtime-health.yaml
- Lessons learned: .agent/nhallucinate/lessons-learned.md
- Beads docs: CLAUDE.md section "Beads Issue Tracker"

