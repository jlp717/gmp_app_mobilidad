---
type: concept
status: active
summary: Credenciales fuera del prompt. El modelo llama MCP; el harness resuelve el vault.
tags: [security, secrets, vault, mcp]
---

# Secrets policy

The model never sees passwords, tokens, or API keys. It sees resource names and `credentials_ref`. Connections live in `.opencode/config/connections.yaml`. Values live in env or a vault loaded by the harness (`gmp-deploy-ssh`, `ibm-db2-mcp`, `%USERPROFILE%\.config\opencode\.env`).

Do not put user+password+host+path in FIELD-GUIDE, agent prompts, vault notes, or chat. Domain knowledge stays: `VISTA_DEUDA_BASE`, CPC `ROW_NUMBER()`, `R1_T8CDVD`.

If a secret touched plaintext (chat, md, log), rotate it. Treat it as exposed. Diff scan is `code-quality-contract` POL-C plus gitleaks in CI.

Related: [[deploy-policy]] [[db2-access]] [[vuln-analysis]]
