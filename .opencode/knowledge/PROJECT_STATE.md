# Project State — GMP App Movilidad

> **Auto-updated by /health command and orchestrator at session end.**
> Current as of: 2026-05-18

---

## Current Status

| Metric | Value |
|--------|-------|
| **Active Branch** | `test` |
| **Base Branch** | `main` |
| **Last Commit** | `987f7af fix: adjust repartidor commissions` |
| **Version** | 4.1.0 |
| **Working Tree** | Clean ✅ |
| **Up to date with origin** | Yes ✅ |

## Test Status

| Suite | Count | Status |
|-------|-------|--------|
| Backend tests | 204/204 | ✅ All passing |
| Flutter navigation tests | 11/11 | ✅ All passing |
| Widget tests | ~60+ | ✅ (OrderStatusBadge, SmartProductImage, ComingSoonPlaceholder, SkeletonWidgets, KPICard) |

## Known Issues

### Critical
- **Flutter analyze errors**: ~20 errors (AppTheme.anim* — pre-existing debt). **Does not block build** but needs cleanup.
- **Memory graph persistence**: Knowledge graph is RAM-only. Session bootstrap layer just added (May 18).
- **PM2 production**: gmp-api service restarts count at 85 — needs investigation.

### Technical Debt
| Item | Severity | Notes |
|------|----------|-------|
| `rutero_detail_modal.dart` (3517 lines) | High | Needs widget extraction |
| 30 files > 500 LOC | Medium | Gradual refactor |
| 14 cache files duplicated | Medium | Needs audit before consolidation |
| `pedidosProvider` 39 ref.read() | High | Cannot add autoDispose |
| Flutter analyze 20 errors | Medium | Pre-existing, not blocking |

---

## Branch Structure

```
main              ← Production
  └─ test         ← Active development (CURRENT)
  └─ feat/load-planner-v2
  └─ feature/backend-modularization
  └─ feature/final-optimizations
  └─ fix/pedidos-cobros-critical
  └─ optimization-phase-1
  └─ security-sql-parameterization
  └─ original-working-version
  └─ pre
  └─ pre-new-logic
  └─ opencode/*   (5 branches: cosmic-mountain, crisp-falcon, curious-mountain, quiet-moon, sunny-canyon, sunny-wizard)
```

---

## Recent Commits (Last 10)

```
987f7af fix: adjust repartidor commissions
608166a chore: bump app version to 4.1.0
9e163dc feat: add agent workflow tooling and UI polish
7b865a4 bd init: initialize beads issue tracking
9da6e7a feat: improve sales insights
b7dbfa0 fix: handle nullable vendor code
ca9bb41 chore: bump app version to 4.0.8
da95387 chore: update production setup script
aafff75 feat: align mobility data flow
348899f feat: Add migration scripts and SQL for immediate fixes
```

---

## Development Commands

```bash
# Flutter
flutter pub get
flutter analyze
flutter build apk --release
dart run build_runner build --delete-conflicting-outputs

# Backend
cd backend; npx jest

# Knowledge Sync
/knowledge-sync    # Bidirectional sync memory ↔ files
/knowledge-save    # Dump memory graph to files
/health            # Full project audit
```
