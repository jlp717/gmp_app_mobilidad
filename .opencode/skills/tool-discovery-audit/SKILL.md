---
name: tool-discovery-audit
description: Discover and maintain the real project tool manifest: endpoints, scripts, dependencies, MCPs, DB2, SSH, image paths, CI/CD, and integrations.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  artifact: tools-manifest
---

## Scan Layers

1. API endpoints: `backend/routes/*.js`, `src/routes/*` when present.
2. Utility scripts: `backend/scripts/*`, migration, backup, seed, maintenance.
3. Production dependencies: `package.json`, `pubspec.yaml`.
4. Environment declaration: `.env.example` only; never read real `.env`.
5. CI/CD: `.github/workflows/*.yml`.
6. External integrations: HTTP calls, image base URLs, DB2, SSH, Telegram, Sentry.
7. MCP state: `opencode mcp list`.

## Manifest Rules

Write or update `.opencode/memory/tools-manifest.json` with:

```json
{
  "tool": "descriptive name",
  "type": "endpoint|script|service|db|ssh|mcp|integration",
  "location": "path or url",
  "currently_configured": true,
  "capabilities": [],
  "should_be_assigned_to": [],
  "action_needed": "none or exact next step"
}
```

## Incremental Mode

On startup, rescan endpoints and CI/CD first. Compare with previous manifest and report only deltas unless a full scan is requested.
