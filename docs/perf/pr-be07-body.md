## Summary

- If `initDb()` fails after config validation, the API still listens and PM2 gets `ready`. `/api/ready` returns 503 `{ database: 'unavailable' }` and retries DB2 with backoff 5→60s.
- Missing DB credentials remain fatal. `db.js` untouched.

## Test plan

- [x] `cd backend && npx jest --forceExit --no-coverage ./__tests__/server-startup-degraded.test.js ./__tests__/reparto-server-startup.test.js`
- [ ] Do not merge / deploy from this PR
