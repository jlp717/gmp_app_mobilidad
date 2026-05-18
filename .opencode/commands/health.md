---
description: Full project health audit. Checks git, tests, analyze, DB, and updates PROJECT_STATE.md.
---

# /health

Full system health check. Runs diagnostics and updates `PROJECT_STATE.md`.

## Standard Mode (default)

1. **Git status**: branch, clean/dirty, up-to-date with remote
2. **Backend tests**: run `npx jest --silent`
3. **Flutter analyze**: run and count errors/warnings
4. **DB2 connection**: verify via `ibm-db2-mcp_health_check`
5. **Memory graph**: verify key entities exist
6. **Knowledge files**: verify all files present
7. **Update PROJECT_STATE.md** with results
8. **Report summary**

## Quick Mode (`--quick`)

Skip tests and analyze. Only check:
- Git status
- DB2 connection
- Memory graph presence
- Knowledge file presence

## Output

```
## Health Report — 2026-05-18

### ✅ Healthy
- Git: branch test, clean, up to date
- Backend tests: 204/204 passing
- DB2 connection: OK

### ⚠️ Warnings
- Flutter analyze: 20 errors (pre-existing)
- PM2 restarts: 85 (investigate)

### ❌ Failures (none)

### Knowledge Base
- 9/9 files present
- 15 memory entities loaded

Last updated: 2026-05-18 09:00
```
