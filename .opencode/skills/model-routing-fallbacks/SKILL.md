---
name: model-routing-fallbacks
description: Choose and audit OpenAI, Cursor ACP, and OpenCode Go models by task risk, latency, quota cost, and fallback policy without defaulting to expensive Opus models.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  providers: openai,cursor-acp,opencode-go
---

## Policy

Use the best confirmed model for the job, not the same model for every agent.

## Routing

- Orchestrators: `openai/gpt-5.5`.
- Architecture, security, final risk review: `openai/gpt-5.5`.
- DB2 and DevOps decisions: `openai/gpt-5.5`.
- Flutter, Node, Next implementation: `openai/gpt-5.5` while Cursor Agent reports no available models; switch to `cursor-acp/composer-2.5` only after a successful model probe.
- Tests, performance, simplification: `openai/gpt-5.5` while Cursor is unavailable; Composer 2.5 is the preferred code fallback when confirmed.
- Read-only exploration, metrics, notification, lightweight research: OpenCode Go.

## Cost Guard

Cursor ACP Claude Opus 4.7/4.8 may appear in probes because it is available, but it must not be in active agent defaults or automatic fallbacks unless Javier explicitly requests it for a single task.

## Fallback Order

1. Retry same model only for transient rate/timeout errors on the **same in-flight request** (no mid-session model swap).
2. On quota/billing/rate-limit for OpenAI, record `.opencode/state/provider-health.json` and use `cursor-acp/composer-2.5` on **new sessions only**.
3. Move to same-tier fallback from `.opencode/fallback-models.json`; Composer 2.5 is first fallback for OpenAI agents when quota is exhausted.
4. Skip Cursor fallbacks if Cursor probe reports no models.
5. If model quality is inadequate twice, escalate to the next tier.
6. If all confirmed models fail, stop and report rather than hallucinating.

## GMP Session Rules

- Never change the model of a conversation already in progress when quota fails.
- Do not auto-retry `session.prompt` inside the same session after a quota error.
- New chats and new subagent sessions should read provider-health and pick Composer when OpenAI is blocked.
- Inspect live routing with `model-provider-health`, `flow-status` (o `/flow`) y `.opencode/state/flow-trace.jsonl`.

## Evidence

Use `.opencode/probe-results.json` or the latest `cursor-agent models` check as the source of truth for availability. A model not confirmed by probe cannot be routed automatically.
