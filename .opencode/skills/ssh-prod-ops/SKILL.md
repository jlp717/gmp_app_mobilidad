---
name: ssh-prod-ops
description: Operate the GMP application server through SSH with batch-mode commands, PM2 checks, health checks, deploy gates, and rollback discipline.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  server: "192.168.1.230"
---

## Facts

- Backend/application server: 192.168.1.230.
- SSH user: gmp.
- Backend path: `/opt/gmp-api`.
- Production port: 3335 in PM2. Health checks use `/api/health` with `User-Agent: GMP-SRE-HealthCheck/1.0`.
- PM2 process: `gmp-api`.
- Granja web path: `/var/www/mari-pepa/`.

## Rules

- Use non-interactive SSH options: `ssh -o BatchMode=yes`.
- Production deploy always needs explicit Javier approval.
- Read logs and health status before assuming production state.
- Do not run destructive commands unless the plan contains rollback and approval.

## Pre-Deploy Checklist

1. Confirm branch and working tree.
2. Confirm tests passed or document the exact blocker.
3. Confirm no secrets were changed.
4. Create or verify snapshot/rollback target.
5. Confirm health endpoint expectations.

## Post-Deploy Checklist

1. Check PM2 status.
2. Check recent backend logs.
3. Check `http://localhost:3335/api/health` from the server with `curl -A GMP-SRE-HealthCheck/1.0`.
4. If health fails within the agreed window, rollback and notify.

## Output

Always return commands run, exit codes, affected service, and whether rollback is still available.
