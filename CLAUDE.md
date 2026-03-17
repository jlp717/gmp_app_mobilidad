# GMP App Mobilidad - Claude Code Configuration

## Project Stack

- **Frontend**: Flutter/Dart (`lib/`)
- **Backend**: Node.js/CommonJS (`backend/`)
- **Database**: DB2 via ODBC (DSN='GMP'), custom tables in schema JAVIER
- **Roles**: JEFE_VENTAS, COMERCIAL, REPARTIDOR

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER proactively create documentation files (*.md) or README files
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep responses short and actionable — no trailing summaries
- NEVER edit `albaran_detail_page.dart` for repartidor bugs — the real UI is `rutero_detail_modal.dart`
- Never continuously check status after spawning a swarm — wait for results

## File Organization (This Project)

- `lib/` — Flutter/Dart frontend (features/, core/, shared/)
- `backend/` — Node.js API (routes/, services/, middleware/)
- `backend/scripts/` — utility/investigation scripts
- `.claude/` — Claude Code config, agents, skills, hooks
- NEVER save working files to root folder

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All independent operations MUST be concurrent/parallel in a single message
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message
- Use subagents (Agent tool) for parallel independent research tasks
- ALWAYS batch ALL todos in ONE TodoWrite call
- ALWAYS spawn ALL agents in ONE message for parallel execution

## Token Efficiency Rules

- NEVER use long Bash output when dedicated tools exist (Read, Grep, Glob, Edit)
- For file search: use Glob (NOT find or ls)
- For content search: use Grep (NOT grep or rg in Bash)
- For reading: use Read (NOT cat/head/tail)
- For editing: use Edit (NOT sed/awk)
- Summarize tool results before responding — don't dump raw output
- Use subagents to isolate large explorations from main context
- Prefer targeted reads (offset+limit) over full file reads for large files

## Build & Test

```bash
# Frontend
flutter pub get
flutter analyze
flutter build apk --release
dart run build_runner build --delete-conflicting-outputs

# Backend
cd backend && npx jest
node backend/server.js

# Quick health check
nc localhost 3197
```

## Flutter-Specific Rules

- After modifying any `.dart` model or provider, run `dart run build_runner build --delete-conflicting-outputs` if the project uses code generation (freezed, json_serializable)
- After adding new dependencies, ALWAYS run `flutter pub get` before editing code that uses them
- Run `flutter analyze` after significant Dart changes to catch type errors early
- New features go in `lib/features/<feature_name>/presentation/pages/` + `providers/` + `widgets/`
- Providers use ChangeNotifier pattern — check existing providers before creating new ones
- Navigation: any new tab MUST be added to BOTH `_getNavItems` AND `_buildCurrentPage` in main_shell.dart

## Backend-Specific Rules

- Routes in `backend/routes/` — register in server.js with `app.use('/api/<name>', require('./routes/<name>'))`
- Services in `backend/services/` — pure DB logic, no Express req/res
- DB2 queries use `odbc` package with DSN='GMP' — always use parameterized queries (never string concat)
- Vendor code 'ALL' requires special handling: query all vendors, not WHERE VENDEDOR='ALL'
- Test with `cd backend && npx jest` — test files in `backend/__tests__/`

## Key Architecture Notes

- Navigation: `lib/features/dashboard/presentation/pages/main_shell.dart`
- Tab routing must stay in sync between `_getNavItems` and `_buildCurrentPage`
- Vendor code 'ALL' must be handled specially in backend services
- `showCommissions` DB flag controls Comisiones tab visibility
- Delivery detail UI: `rutero_detail_modal.dart` (NOT albaran_detail_page.dart)
- Receipt endpoints MUST include `signaturePath` field
- RUTERO_CONFIG queries MUST filter `ORDEN >= 0` to exclude blocking entries

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries (backend routes)
- Always sanitize file paths to prevent directory traversal

## Swarm Orchestration (RuFlo)

- Use hierarchical topology for complex multi-file tasks
- Keep maxAgents at 6-8 for tight coordination
- Use `run_in_background: true` for all agent Task calls
- After spawning agents, STOP and wait — do NOT poll status
- When agent results arrive, review ALL results before proceeding

### Model Routing

| Complexity | Model | Use Cases |
|-----------|-------|-----------|
| Simple | Haiku | Formatting, renames, simple lookups |
| Medium | Sonnet | Feature implementation, bug fixes |
| Complex | Opus | Architecture, security review, multi-file refactor |

## V3 CLI Commands (RuFlo)

```bash
# Doctor check
npx @claude-flow/cli@latest doctor --fix

# Swarm init
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Memory
npx @claude-flow/cli@latest memory search --query "your query"
npx @claude-flow/cli@latest memory store --key "key" --value "value" --namespace patterns

# Agent spawn
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder
```

## Available Agents (60+ Types)

Core: `coder`, `reviewer`, `tester`, `planner`, `researcher`
Specialized: `security-architect`, `security-auditor`, `performance-engineer`
Swarm: `hierarchical-coordinator`, `mesh-coordinator`
GitHub: `pr-manager`, `code-review-swarm`, `release-manager`

## MCP Servers

- **claude-flow**: RuFlo orchestration, memory, swarm coordination
- **context7**: Live documentation lookup for any library (Flutter, Dart, Node, Express, DB2, etc.)
  - Use `context7` MCP tools to fetch up-to-date API docs instead of guessing from memory
  - Especially useful for Flutter widgets, Dart APIs, and Node.js packages
  - Saves tokens by fetching only the relevant doc section, not the whole page
