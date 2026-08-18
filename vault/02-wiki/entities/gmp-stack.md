---
type: entity
status: active
summary: Stack canonico GMP App Movilidad y Granja. Lo que el agente debe saber sin releer CLAUDE.md.
tags: [gmp, stack, flutter, node, db2]
entity-type: system
owner: chief-engineer-assistant
---

# GMP stack

The GMP App Movilidad stack is Flutter 3.24+ on the client, Node.js CommonJS + Express (`gmp-api` via MCP `gmp-deploy-ssh`), and IBM DB2 for i (DSN `GMP` via MCP `ibm-db2-mcp`, schemas JAVIER and DSEDAC). Granja canonical path is `/var/www/mari-pepa`. PostgreSQL and Supabase are forbidden unless Javier changes architecture in writing. Hosts and credentials are `host_ref` / `credentials_ref` in `.opencode/config/connections.yaml`, not literals in prompts.

Flutter features live under `lib/features/<feature>/{data,domain,providers,presentation}`. `lib/core/` is shared infrastructure. Delivery UI for repartidor is `rutero_detail_modal.dart`, never `albaran_detail_page.dart`. New tabs must update both `_getNavItems` and `_buildCurrentPage` in `main_shell.dart`.

Related: [[db2-access]] [[deploy-policy]] [[code-quality-contract]]
