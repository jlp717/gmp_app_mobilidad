# Architecture Decision Records — GMP App Movilidad

> Each entry documents a significant technical decision.
> Format: Date | Decision | Rationale | Alternatives | Risks

---

## ADR-001: Persistent Knowledge Base Architecture

**Date**: 2026-05-18
**Decision**: Implement multi-layer persistent knowledge system with filesystem as source of truth
**Why**: Memory graph (RAM-only) is lost on OpenCode Go reset (~daily). Project context, business rules, and user preferences were being re-learned every session, causing inconsistency and wasted tokens.
**Architecture**:
- Layer 1: `.opencode/knowledge/*.md` — git-tracked, persistent, source of truth
- Layer 2: Memory MCP graph — fast cache loaded from files at session start
- Layer 3: Session bootstrap — auto-load knowledge on every session
- Layer 4: Sync commands — `/knowledge-sync`, `/knowledge-save`
- Layer 5: Auto-discovery — `/health` command
**Alternatives**:
- `bd remember` — quick but less structured, no version control
- SQLite-backed memory — possible but adds dependency, not git-tracked
- Memory MCP config persistence — MCP doesn't support file persistence natively
**Risks**:
- Knowledge files and memory graph can drift if sync not run regularly
- Mitigation: Session bootstrap always loads from files (files win on conflict)

---

## ADR-002: pedidosProvider — NO autoDispose

**Date**: 2026-05-16 (inherited)
**Decision**: `pedidosProvider` must NOT use `autoDispose`
**Why**: Provider has periodic timers for auto-refresh and 39 `ref.read()` references throughout the codebase. Adding `autoDispose` would break the timer mechanism and cause runtime errors.
**Alternatives**: Refactor to separate timer logic from data provider → estimated 2-3 days of work
**Risks**: Current architecture couples data fetching with timer scheduling. Technical debt that needs dedicated refactor.

---

## ADR-003: Vendor 'ALL' Query Pattern

**Date**: 2026-05-16 (inherited)
**Decision**: Vendor code 'ALL' means query without vendor filter
**Why**: Business logic requires that 'ALL' shows data from ALL vendors. Adding `WHERE VENDOR='ALL'` would return zero results.
**Implementation**: `vendor-helpers.ts` utility — when vendor is 'ALL', omit the WHERE clause entirely
**Risk**: Developers may accidentally add WHERE clause. Mitigated by code review and this ADR.

---

## ADR-004: select() Optimization Pattern

**Date**: 2026-05-16 (inherited)
**Decision**: Use `select()` in Riverpod consumers to prevent unnecessary widget rebuilds
**Why**: Multiple providers (auth, cobros, entregas) had 10+ consumers each. Without `select()`, every change to any field rebuilds all consumers. With `select()`, only consumers watching the changed field rebuild.
**Applied to**: `authProvider`, `cobrosProvider`, `entregasProvider` (10 individual select() consumers each)
**Rule**: All new providers must use `select()` in consumers

---

## ADR-005: OpenCode Plugin System Disabled

**Date**: 2026-05-16 (inherited)
**Decision**: Set `"plugin": []` in global config
**Why**: External plugins cause infinite "Loading plugins" hang on Windows TUI
**Impact**: No plugin-based extensions. All functionality via MCPs and commands.

---

## ADR-006: Dual MCP Config (TUI + Web)

**Date**: 2026-05-16 (inherited)
**Decision**: Maintain separate MCP configurations for TUI mode and web mode
**Why**: `gmp-deploy-ssh` MCP hangs TUI rendering but is essential for web/mobile use. TUI config has it disabled, web config has it enabled.
**Files**: `opencode.tui-mode.jsonc`, `opencode.web-mode.jsonc`

---

## ADR-007: Project-Level Memory Override

**Date**: 2026-05-18
**Decision**: Memory graph is NOT the source of truth — knowledge files are
**Why**: Memory MCP stores data in RAM only. Files in `.opencode/knowledge/` are git-tracked and survive all resets. On session start, orchestrator reads files and populates memory graph.
**Conflict Resolution**: If memory graph and knowledge files disagree, FILES WIN. After loading, agent can update memory with new findings.
