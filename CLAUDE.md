# GMP App Mobilidad - Claude Code Configuration

## Project Stack

- **Frontend**: Flutter/Dart (`lib/`)
- **Backend**: Node.js/CommonJS (`backend/`)
- **Database**: DB2 via ODBC (DSN='GMP'), custom tables in schema JAVIER
- **Roles**: JEFE_VENTAS, COMERCIAL, REPARTIDOR

## Caveman Mode

- Caveman skills installed: `caveman`, `caveman-commit`, `caveman-review`, `caveman-compress`, `caveman-help`
- Default mode: **full** — drop articles, filler, pleasantries, hedging. Fragments OK. Short synonyms.
- Modes: `full`, `lite`, `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`
- Disable: "/caveman off" or "stop caveman"
- Config: `~/.config/caveman/config.json` → `{ "defaultMode": "full" }`

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
- `.opencode/` — OpenCode config, agents, project briefing
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
- Tab routing must stay in sync between `_getNavItems` AND `_buildCurrentPage` in main_shell.dart
- Vendor code 'ALL' requires special handling: query all vendors, not WHERE VENDEDOR='ALL'
- `showCommissions` DB flag controls Comisiones tab visibility
- Delivery detail UI: `rutero_detail_modal.dart` (NOT albaran_detail_page.dart)
- Receipt endpoints MUST include `signaturePath` field
- RUTERO_CONFIG queries MUST filter `ORDEN >= 0` to exclude blocking entries

## Performance Optimization Notes

### Providers con select() aplicados:
- `authProvider` → `select((s) => s.value)` en repartidor_rutero_page.dart
- `cobrosProvider` → `select((p) => p.pendingSummary)` en cobros_page.dart
- `entregasProvider` → 10 select() individuales para isLoading, error, albaranes, resumen*, filter*, sortBy en repartidor_rutero_page.dart

### NO agregar autoDispose a:
- `pedidosProvider` - Usa patrón addListener/removeListener, timers periódicos, y 39 ref.read() en pedidos_page.dart. Refactor completo necesario antes de autoDispose.

### Optimizado:
- `repartidor_rutero_page.dart` - refactorizado con select() para evitar rebuilds innecesarios

## Testing Coverage

### Widget Tests Creados (sesión actual):
- `test/widgets/order_status_badge_test.dart` - 23 tests ✅
- `test/widgets/smart_product_image_test.dart` - 13 tests ✅
- `test/widgets/coming_soon_placeholder_test.dart` - 9 tests ✅
- `test/widgets/skeleton_widgets_test.dart` - 8 tests ✅
- `test/widgets/kpi_card_test.dart` - tests de KPICard (varios passing)

### Core Widgets con tests:
- ErrorStateWidget, EmptyStateWidget, ModernLoading (pre-existing)
- ShimmerLoading, SkeletonCard, SkeletonList, SkeletonSummary
- OrderStatusBadge, SmartProductImage, ComingSoonPlaceholder

### Tests Totales (esta sesión):
- 11/11 Flutter navigation tests ✅
- 76/76 Backend tests ✅
- ~60+ Widget tests passing

## Color Centralization

### AppColors (`lib/core/theme/app_colors.dart`):
- 40+ colores centralizados
- Incluye: base colors, neon accents, glow intensities, status colors, text colors, gradients
- Reemplaza duplicación entre AppTheme y AppColors

### Archivos Pendientes de Refactor:
- `rutero_detail_modal.dart` (3517 líneas) - requiere extracción de widgets (complex, compartir estado)
- 30 archivos >500 líneas
- 1 archivo >3500 líneas

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries (backend routes)
- Always sanitize file paths to prevent directory traversal

## User Patterns (CRITICAL — apply to ALL output)

- **Standard**: Results must be exceptional — polished, animated, with personality. Generic output is unacceptable.
- **Hates**: AI-loop copy ("team of experts", "integral solutions"), decorative emojis, generic templates, bugs, silent failures.
- **Wants**: Purposeful animations, Material 3 with centralized colors (app_colors.dart), zero errors, verified before reporting.
- **Workflow**: User wants to use ONLY the orchestrator. Do NOT ask the user to switch agents/modes. Context must be remembered across sessions via memory MCP.
- **Zero tolerance**: console.log/print in production, hardcoded secrets, any/dynamic without justification, white screens, unverified "done" claims.
- **Verification**: ALWAYS run tests/analyze before claiming completion. Report the exact command and result.

## MCP Servers

- **context7**: Live documentation lookup for any library (Flutter, Dart, Node, Express, DB2, etc.)
  - Use `context7` MCP tools to fetch up-to-date API docs instead of guessing from memory
  - Especially useful for Flutter widgets, Dart APIs, and Node.js packages
  - Saves tokens by fetching only the relevant doc section, not the whole page
- **ibm-db2-mcp**: IBM Db2 for i via ODBC (DSN=GMP, schema JAVIER)
- **dart-flutter-mcp**: Dart/Flutter tooling daemon (hot reload, widget tree, tests)
- **pub-mcp**: pub.dev package search and info
- **gmp-deploy-ssh**: Deploy to production server (192.168.1.230)
- **github**: PRs, issues, code search, repo management
- **firecrawl**: Web research and content extraction
- **memory**: Persistent context across sessions
- **sequential-thinking**: Complex reasoning chains
- **filesystem**: File operations within allowed directories
- **ddg-search**: Web search
- **time**: Timezone utilities
- **fetch**: URL fetching
