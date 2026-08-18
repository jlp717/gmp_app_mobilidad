---
name: code-graph-navigation
description: Use when navigating unfamiliar code with Serena MCP, symbol lookup, references, or impact analysis before editing.
---

# Code Graph Navigation

Use Serena first when a change depends on symbol ownership or cross-file impact.

1. Locate symbols before editing.
2. Check references before moving or deleting code.
3. Prefer targeted reads over broad scans.
4. If Serena is unavailable, fall back to LSP, grep, and verified file reads.

Output evidence: symbol queried, files read, and impacted files.
