---
name: issue-agent-mapper
description: "Symphony-style issue→agent auto-mapper. Auto-discovers issues, assigns to best-fit agent, creates isolated workspace, monitors progress, handles completion. Invocable as /issue-agent-mapper or /symphony."
version: "1.0"
triggers:
  - /issue-agent-mapper
  - /symphony
  - "map issue to agent"
  - "auto-assign issue"
  - "symphony mode"
---

# Issue→Agent Auto-Mapper (Symphony Pattern)

Implements OpenAI's Symphony pattern: every open issue gets a dedicated agent workspace with automatic assignment, monitoring, and completion handling.

## When to Use

- New issue created (beads, GitHub, or user request)
- Manual reassignment needed
- Agent stalled or crashed
- Bulk issue triage requested

## Workflow

### 1. Auto-Discovery

Scan all configured sources for new/unassigned issues:

```
Sources (in priority order):
1. beads (local) → `bd ready` + `bd list --unassigned`
2. GitHub issues → `gh issue list --state open --label "triage"`
3. User requests → inbox items tagged as issues
```

### 2. Issue Classification

Classify each issue along three axes:

| Axis | Values | Detection |
|------|--------|-----------|
| **Type** | bug, feature, refactor, investigation, chore | Keywords in title/description + labels |
| **Complexity** | low (<1h), medium (1-4h), high (4-8h), epic (>8h) | Scope signals: files touched, dependencies, description length |
| **Required Skills** | flutter_ui, flutter_data, backend, db2, security, qa, devops | Keyword matching against agent skill registry |

**Classification algorithm:**
```javascript
function classifyIssue(issue) {
  const text = `${issue.title} ${issue.body}`.toLowerCase();
  
  // Type detection
  const type = matchFirst(text, {
    bug: ['bug', 'fix', 'crash', 'error', 'broken', 'not working'],
    feature: ['add', 'new', 'implement', 'create', 'support'],
    refactor: ['refactor', 'restructure', 'clean', 'simplify', 'migrate'],
    investigation: ['investigate', 'research', 'analyze', 'diagnose'],
    chore: ['update', 'bump', 'deps', 'docs', 'ci']
  }) || 'investigation';

  // Complexity estimation
  const complexity = estimateComplexity(issue);
  
  // Required skills extraction
  const requiredSkills = extractSkills(text);
  
  return { type, complexity, requiredSkills };
}
```

### 3. Agent Selection Algorithm

**Strategy: `best_fit`** (default)

Score each available agent:

```
score = (skill_match * 0.4) + (history_success * 0.3) + (1 - current_load) * 0.2 + (past_performance * 0.1)
```

| Factor | Weight | Source |
|--------|--------|--------|
| Skill match | 40% | Agent's declared skills ∩ issue's required skills |
| History success | 30% | Past issues of same type completed successfully |
| Current load | 20% | Number of active workspaces assigned |
| Past performance | 10% | Average verification-loop pass rate |

**Fallback strategies:**
- `round_robin`: Cycle through eligible agents
- `least_lowest`: Assign to agent with fewest active issues

### 4. Workspace Isolation

Each issue gets an isolated git worktree:

```
.opencode/workspaces/
  └── ISSUE-{id}/
      ├── .opencode/state/{task_id}.json
      ├── .opencode/handoffs/
      └── (worktree files)
```

**Workspace lifecycle:**
1. Create: `git worktree add .opencode/workspaces/ISSUE-{id} -b agent/{issue-id}`
2. Work: Agent operates in isolation
3. Complete: PR created from worktree branch
4. Cleanup: `git worktree remove` after merge (configurable)

### 5. Progress Monitoring

**Stall detection:**
- No file changes in `stall_detection_minutes` (default: 15)
- No state transitions in StateGraph
- No tool calls in session trace

**Health check (every 60s):**
```javascript
function checkHealth(workspace) {
  const lastActivity = getLastActivity(workspace);
  const elapsed = Date.now() - lastActivity;
  
  if (elapsed > STALL_THRESHOLD) {
    return 'stalled';
  }
  if (hasErrors(workspace)) {
    return 'error';
  }
  return 'healthy';
}
```

### 6. Retry & Escalation Policy

| Attempt | Action |
|---------|--------|
| 1 | Start agent in workspace |
| 2 (stall) | Restart agent with context summary |
| 3 (stall) | Restart with simplified scope |
| 3 (failure) | Escalate to chief-engineer-assistant |

**Escalation includes:**
- Full context packet of all attempts
- Workspace preserved for manual inspection
- Notification to Javier via Telegram

### 7. Completion Handling

On successful completion:
1. Run verification loop (mandatory)
2. Create PR from worktree branch
3. Update beads issue status → `bd close {id}`
4. Update GitHub issue (if applicable) → add label `done`
5. Cleanup workspace (per `cleanup_after` config)
6. Log to TEAM_TRACE

## Configuration

See `.opencode/config/issue-agent-mapper.yaml` for:
- Source priority
- Assignment strategy
- Workspace settings
- Monitoring thresholds
- Auto-actions

## Examples

### Example 1: Auto-map a new beads issue

```
User: /symphony

Chief:
1. `bd ready` → Found issue #42 "Fix rutero modal crash on scroll"
2. Classification: type=bug, complexity=medium, skills=[flutter_ui, flutter_data]
3. Agent scoring:
   - flutter-ui-specialist: 0.92 (skills: 1.0, history: 0.85, load: 0.3)
   - flutter-data-specialist: 0.65 (skills: 0.6, history: 0.7, load: 0.2)
4. Assignment: flutter-ui-specialist
5. Workspace: .opencode/workspaces/ISSUE-42/ (branch: agent/issue-42)
6. Monitoring: Active (health check every 60s)
```

### Example 2: Stall detection + restart

```
[15:00] Agent started on ISSUE-42
[15:15] No activity detected → STALL
[15:16] Restart attempt 2 with context summary
[15:17] Agent resumed work
[15:45] PR created → ISSUE-42 resolved
```

### Example 3: Escalation after 3 failures

```
[14:00] Agent started on ISSUE-57 (epic: DB2 migration)
[14:15] Stall detected → restart
[14:30] Stall detected → restart with simplified scope
[14:45] Stall detected → ESCALATE
[14:46] Chief notified, workspace preserved
[14:47] Telegram: "ISSUE-57 needs manual review. 3 attempts failed. Workspace: .opencode/workspaces/ISSUE-57/"
```

## Integration Points

| Tool | Usage |
|------|-------|
| `bd` (beads) | Issue discovery, status updates |
| `gh` (github) | GitHub issue sync, PR creation |
| `git-worktrees` | Workspace isolation |
| `parallel-dispatch` | Multi-issue parallel assignment |
| `handoff-ledger` | Context packet for each assignment |
| `state-manager` | Track agent progress |
| `elite-quality-gate` | Pre-completion verification |
| `telegram-notify` | Escalation notifications |

## Constraints

- Max 3 attempts per issue before escalation
- Workspaces are NEVER auto-deleted before merge
- All state transitions logged to TEAM_TRACE
- Agent selection is deterministic (same input → same output)
- Escalation always notifies Javier (no silent failures)
