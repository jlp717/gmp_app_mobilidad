---
type: concept
status: active
summary: Unica politica de deploy a 192.168.1.230. El agente no pregunta esto cada vez.
tags: [deploy, sre, pm2, production]
---

# Deploy policy

The only allowed production deploy sequence is `git pull origin test` followed by `pm2 restart gmp-api`. Credentials live in `${GMP_SSH}` and are resolved by MCP `gmp-deploy-ssh`. Do not put user+password in this note or in prompts.

Liveness is `/api/health`. Production readiness is `/api/ready` over SSH localhost with `User-Agent: GMP-SRE-HealthCheck/1.0`. Failed readiness at 60 seconds implies rollback.

Playbook PROD requires staging first, QA pass, AppSec pass, SRE health pass, `production-approval-gate`, and Javier saying **adelante**. Discovery/logs without mutation is R3. DB2 DDL/DML, deploy, rollback, secret rotation, or pm2 mutation is R4.

Related: [[gmp-stack]] [[db2-access]]
