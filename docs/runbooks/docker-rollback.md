# Runbook — Docker image rollback (GMP backend)

## Strategy

Every push to `main` / `develop` / `test` builds a production image and pushes it
to GHCR tagged with the commit SHA and the branch name:

    ghcr.io/<org>/<repo>/gmp-backend:<sha>
    ghcr.io/<org>/<repo>/gmp-backend:<branch>

The immutable rollback unit is the **image digest** printed by the
`build-push` job (`digest` output). Keep the last **N=10** digests per branch
(GHCR retention or periodic `crane delete`).

## One-step rollback

```bash
# <DIGEST> = digest from the last known-good build-push job output
docker pull ghcr.io/<org>/<repo>/gmp-backend@<DIGEST>
docker compose up -d backend
```

Or pin by tag if the good commit is still tagged:

```bash
git log --oneline -5            # find last known-good SHA
docker pull ghcr.io/<org>/<repo>/gmp-backend:<GOOD_SHA>
docker tag ghcr.io/<org>/<repo>/gmp-backend:<GOOD_SHA> ghcr.io/<org>/<repo>/gmp-backend:rollback
docker compose up -d backend
```

## Post-rollback checklist (60s)

1. Liveness: `curl -fsS http://localhost:3335/api/live` -> expect 200 `{"status":"alive",...}`
2. Readiness: `curl -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready` -> expect 200 `{"status":"ready"}`
3. DB2 round-trip in logs or `/api/health` checks.database == healthy
4. `docker logs gmp-backend --since 2m` -> no crash loop, no ODBC driver errors
5. If readiness stays 503 > 60s: re-run rollback with previous digest and open an incident.

## Notes

- Rollback does NOT touch DB2 schema. Schema drift requires its own plan (db2-safe-change).
- PM2 hosts are unaffected: Docker stack is independent until cutover.