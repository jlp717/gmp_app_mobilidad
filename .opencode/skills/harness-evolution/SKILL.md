---
name: harness-evolution
description: Agentic Harness Engineering (AHE) evolution loop. Read evidence corpus, identify failure patterns, propose harness edits, verify improvements, rollback on regression.
version: "1.0"
triggers:
  - /harness-evolution
  - /evolve
  - "improve the harness"
  - "harness regression"
  - "agent keeps failing"
---

# Harness Evolution Loop

Implements the Agentic Harness Engineering (AHE) framework. The harness (prompts, tools, skills, config) evolves based on structured evidence from real sessions.

## When to Use

- Repeated errors detected by `same-error-detector` (2+ occurrences in 30 days)
- Weekly evolution cycle (Sunday 03:00)
- Manual trigger when harness quality degrades
- After major task failures with harness-attributable root cause

## Workflow

### 1. READ Evidence Corpus

```bash
# Check recent findings
ls .opencode/state/evidence-corpus/findings/

# Check root causes
ls .opencode/state/evidence-corpus/root-causes/

# Check same-error tracker
cat .opencode/memory/same-error-tracker.jsonl | tail -20
```

Read the most recent findings. Prioritize by:
- `occurrence_count` (higher = more urgent)
- `severity` (blocker > correction > preference)
- `last_observed` (recent = active problem)

### 2. IDENTIFY Failure Patterns

For each finding, determine:

| Question | Evidence Source |
|----------|----------------|
| What failed? | `raw_trajectories` layer |
| Why did it fail? | `root_causes` layer |
| How often? | `same-error-tracker.jsonl` |
| What component? | `distilled_findings` layer |

Pattern categories:
- **Prompt ambiguity**: Agent misinterprets instructions
- **Tool gap**: Missing tool or incorrect tool contract
- **Skill misrouting**: Wrong skill invoked for task type
- **Config drift**: Config no longer matches reality
- **Context overflow**: Too much context, agent loses signal

### 3. PROPOSE Harness Edits

Rules:
- **Bounded**: Only edit harness components (prompts, tools, skills, config, templates)
- **Non-deletable**: Never remove `system_prompt_base`, `safety_rules`, `production_approval_gate`
- **Evidence-backed**: Each edit needs ≥3 evidence samples
- **Falsifiable**: Each edit has a testable hypothesis

Edit proposal format:
```yaml
change_id: "HE-YYYYMMDD-NNN"
component: "skills/db2-safe-change/SKILL.md"
change_type: "modify"  # add | modify | remove
hypothesis: "Adding explicit schema verification step reduces DB2 query errors by 50%"
evidence:
  - finding_id: "F-20260801-001"
  - finding_id: "F-20260805-003"
  - finding_id: "F-20260808-002"
success_criteria:
  - "Zero schema-related DB2 errors in next 5 uses"
  - "No regression in query correctness"
rollback_criteria:
  - "Any new error introduced"
  - "Task completion time increases >20%"
```

### 4. VERIFY Improvements

After applying edit:

1. **Immediate**: Run `decision-router` on a test case that previously failed
2. **Short-term**: Monitor next 3 real sessions using the modified component
3. **Medium-term**: Check `same-error-tracker.jsonl` after 7 days for recurrence

Verification checklist:
- [ ] Edit applied to correct file
- [ ] No unintended side effects on other components
- [ ] Success criteria measurable and measured
- [ ] No new errors in team_trace
- [ ] Rollback manifest created before edit

### 5. ROLLBACK on Regression

Auto-rollback triggers:
- New error type appears after edit
- Task success rate decreases >5%
- `same-error-detector` fires on modified component

Rollback procedure:
```bash
# Find the manifest
cat .opencode/state/harness-manifests/<change_id>.yaml

# Restore previous state
git checkout <previous_state_hash> -- <component_path>

# Record rollback
echo "ROLLED BACK: <change_id> - <reason>" >> .opencode/state/evidence-corpus/experiments/rollback-log.md
```

## Decision Tree: Edit or Not?

```
Finding identified
├── Is it harness-attributable?
│   ├── NO → Log as "code issue", route to code fix
│   └── YES ↓
├── Is evidence ≥3 samples?
│   ├── NO → Defer, keep collecting
│   └── YES ↓
├── Is component non-deletable?
│   ├── YES (safety/system) → Escalate to Javier
│   └── NO ↓
├── Is hypothesis falsifiable?
│   ├── NO → Refine hypothesis
│   └── YES ↓
├── Create change manifest
├── Apply edit
└── Start verification window
```

## Integration Points

| Tool | How Used |
|------|----------|
| `decision-router` | Classify the evolution task itself |
| `flow-policy-check` | Validate the edit route |
| `elite-quality-gate` | Quality check on proposed edits |
| `handoff-ledger` | Record evolution handoff |
| `retro-auto` | Feed findings into retrospectives |
| `same-error-detector` | Trigger evolution on threshold |

## Examples

### Should Evolve
- Agent repeatedly uses wrong DB2 schema → Update `db2-safe-change` skill with explicit schema list
- `decision-router` misclassifies T2 as T1 → Add more signals to task-classification.yaml
- Flutter widget test pattern missing → Add to `flutter-testing` skill

### Should NOT Evolve
- Single one-off error → Wait for pattern
- Code bug in feature → Fix code, not harness
- Missing business requirement → Product decision, not harness
- Infrastructure issue → SRE domain, not harness

## Constraints

- Max 10 evolution iterations per cycle
- Each edit must have rollback manifest
- Non-deletable components require Javier approval
- All changes logged to `team_trace`
- Evidence corpus pruned after retention period
