---
name: release-evidence-gate
description: Prevent premature delivery by requiring concrete evidence: tests, lint, DB2 checks, security review, performance checks, and Telegram-ready summary.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  gate: final-verification
---

## Delivery Gate

Before saying a task is done, confirm:

1. Files changed are exactly the intended files.
2. Tests/lint/analyze ran, or the exact blocker is reported.
3. DB2 tables and columns were verified if SQL was touched.
4. Secrets scan passed for modified files.
5. Visual changes have screenshot or viewport evidence when possible.
6. Reviewer disagreement is resolved or documented.
7. Telegram message contains summary, files, tests, and how Javier can verify.

## Hard Stops

Do not deliver as success if:

- A test failed and was not fixed.
- DB2 entity names were guessed.
- Production deploy happened without approval.
- There is no rollback path for DB or production changes.

## Output Format

Return:

```json
{
  "status": "success|partial|failure",
  "evidence": [],
  "files_modified": [],
  "tests": [],
  "warnings": [],
  "manual_actions": []
}
```
