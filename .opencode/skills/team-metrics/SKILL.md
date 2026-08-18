---
name: team-metrics
description: Reference checklist for team metrics workflows in the OpenCode team.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  converted_from: team-metrics.md
---

# Team Metrics Skill

## Purpose
Track, analyze, and improve the performance of the agent team. Provides framework for measuring agent effectiveness and identifying areas for improvement.

## When to Use
- @team-curator runs weekly audit
- Need to evaluate agent performance
- Deciding on model changes or agent retirement
- Optimizing team composition and delegation patterns

## Key Metrics

### Per-Agent Metrics
| Metric | Formula | Target |
|--------|---------|--------|
| Success Rate | completed / total * 100 | > 95% |
| Avg Completion Time | sum(completion_times) / count | < 10 min (Tier 1) |
| Error Rate | errors / total * 100 | < 5% |
| Rejection Rate | rejected_by_review / total * 100 | < 10% |
| Handoff Quality | complete_handoffs / total * 100 | > 90% |

### Team-Level Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| Throughput | Tasks completed per session | Track trend |
| Parallelism Rate | parallel_tasks / total_tasks * 100 | > 30% |
| Escalation Rate | escalated / total * 100 | < 15% |
| Re-work Rate | redone / total * 100 | < 5% |
| Agent Utilization | unique_agents_used / total_agents | Track distribution |

### Quality Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| Gate Pass Rate | tasks_passing_all_gates / total * 100 | > 90% |
| Test Coverage | lines_covered / total_lines * 100 | > 80% |
| Bug Rate | post_merge_bugs per 100 tasks | < 2 |

## Alert Triggers
| Condition | Action |
|-----------|--------|
| Success rate < 80% | Flag for review, consider model change |
| Error rate > 15% | Investigate, may need skill update |
| No agent used in session | Check if orchestrator doing work itself |
| Handoff quality < 70% | Retrain agents on handoff format |
| Gate pass rate < 80% | Review quality gates |

## Weekly Report Template
\\\
# Team Health Report — [date]

## Summary
- Tasks completed: N
- Success rate: X%
- Avg completion time: X min
- Escalations: N

## Top Performers
1. @agent — X tasks, Y% success

## Needs Attention
1. @agent — low success rate (X%), errors: [...]

## Recommendations
1. ...
\\\

## Anti-Patterns
- Metrics without action ? useless tracking
- Vanity metrics ? misleading data
- No baseline ? can't measure improvement
- Single metric focus ? imbalance
- No feedback loop ? wasted effort

