# 00-Inbox — Unprocessed Captures

Raw captures waiting for triage. AI agents (via `/inbox-triage`) classify and route these to the correct vault folder.

## Rules
- All new captures land here first
- AI triages within 24h of creation
- Processed files move to `01-sources/` or appropriate folder
- Orphaned files (>7 days) trigger a warning in vault-health

## Supported Formats
- `.md` — Notes, articles, decisions
- `.txt` — Quick captures
- `.url` — Web links for ingestion
