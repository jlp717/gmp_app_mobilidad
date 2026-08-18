---
name: mobile-telegram-control
description: Format plans, approvals, progress, and final delivery for Javier on Telegram with concise mobile-first messages and no internal spam.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  channel: telegram
---

## Use When

Use for approvals, task completion, production deploy decisions, long-running checkpoints, and failures that require Javier input.

## Message Rules

- One consolidated startup message.
- Do not send internal delegation events.
- Use short executive language.
- For approval, provide clear `SI` / `NO` / `CANCELAR` options.
- Include risk and rollback state for DB/deploy changes.
- If approval is pending for Tier 2/3, pause execution until response or timeout policy.

## Final Message

Include:

1. What changed.
2. Files modified.
3. Tests and checks run.
4. Remaining warnings.
5. How Javier can verify on mobile or app.

## Never

- Do not paste long diffs.
- Do not expose secrets, tokens, or raw credentials.
- Do not claim success without evidence.
