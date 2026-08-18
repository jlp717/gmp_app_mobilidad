---
name: context-pruning
description: Reference checklist for context pruning workflows in the OpenCode team.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  converted_from: context-pruning.md
---

# Context Pruning Skill

## Purpose
Manage conversation context to prevent overflow, maintain retrieval quality, and ensure efficient token usage across long sessions.

## When to Use
- Context usage exceeds 70%
- Starting a new major task in existing session
- Session has been running for extended time
- Model output quality degrades (sign of context pressure)

## Context Budget

| Context Used | Action | Urgency |
|--------------|--------|---------|
| < 50% | Normal operation | None |
| 50-70% | Prepare compression. Close resolved topics. | Low |
| 70-80% | COMPRESS NOW. Prioritize completed tasks. | High |
| > 80% | EMERGENCY COMPRESSION. Inform user if fails. | Critical |

## Compression Strategy

### What to Compress (Priority Order)
1. Completed tasks ? summary with files + result
2. Research conclusions ? findings + decision
3. Failed attempts ? root cause + fix
4. Discussion threads ? final agreement + reasoning
5. File reads ? key sections referenced

### What NOT to Compress
1. Active work — currently being edited
2. User instructions — requirements, constraints
3. Error messages — still being debugged
4. Code to be modified — need exact content
5. Recent context — last 5-10 messages (working memory)

## Techniques

### 1. Topic Closure
When topic complete:
- Summarize outcome (2-3 lines)
- Note files changed
- Mark as closed
- Compress conversation block

### 2. Knowledge Offloading
Move persistent knowledge to files:
- Decision ? DECISIONS.md
- Project state ? PROJECT_STATE.md
- Session summary ? SESSION_LOG.md
- User preferences ? USER_PATTERNS.md

### 3. Reference Compression
Instead of repeating full content:
- Use file paths: \see lib/features/x/providers/y.dart\
- Use issue IDs: \see bd-abc123\
- Use section references: \see AGENTS.md table\

### 4. State Snapshot
Before major context switch:
\\\
## State Snapshot
- Current task: [what]
- Files open: [which]
- Pending: [what remains]
- Risks: [any]
- Next step: [what to do]
\\\

## Session Management

### Session Boundaries
- Each session has independent context
- Bootstrap from knowledge files at start
- Save state to files at end
- No cross-session context dependency

### Long Session Protocol
If session exceeds 80% context:
1. Compress all completed topics
2. Save state snapshot
3. If still > 80% ? inform user
4. Options: continue (risk quality), new session, simplify task

### Multi-Task Sessions
- Complete task ? compress immediately
- Don't carry resolved context to next task
- Use state snapshot between tasks
- Max 3 active tasks per session

## Anti-Patterns
- No compression ? context overflow, quality loss
- Over-compression ? losing critical details
- Compressing active work ? lost context
- No state snapshot ? confusion on task switch
- Cross-session dependency ? breaks on reset
- Compressing user instructions ? wrong output

