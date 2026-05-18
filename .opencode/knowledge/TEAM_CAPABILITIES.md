# Team Capabilities — GMP App Movilidad

> Agent roster, model assignments, skills, and MCPs available.
> Auto-updated by /knowledge-sync.

---

## Agent Roster (70+)

### Orchestration & Planning
| Agent | Model | Role |
|-------|-------|------|
| orchestrator | openai/gpt-5.5 | CTO, single point of entry |
| oracle | openai/gpt-5.5 | Architect (read-only) |
| planner | openai/gpt-5.5 | Strategy (read-only) |
| team-curator | openai/gpt-5.5 | Team auditor (read-only) |
| tech-lead | openai/gpt-5.5 | Feature execution lead |

### Flutter Specialists
| Agent | Model | Role |
|-------|-------|------|
| flutter-architect | opencode-go/kimi-k2.6 | Architecture decisions |
| flutter-ui-dev | opencode-go/kimi-k2.6 | Material 3, widgets |
| flutter-state-dev | opencode-go/kimi-k2.6 | Riverpod providers |
| flutter-api-dev | opencode-go/kimi-k2.6 | Dio, HTTP, API integration |
| flutter-test-dev | opencode-go/qwen3.6-plus | Widget/unit/integration tests |
| riverpod-architect | opencode-go/kimi-k2.6 | Riverpod 2.x patterns |

### Backend & Database
| Agent | Model | Role |
|-------|-------|------|
| backend-architect | openai/gpt-5.5 | API design (read-only) |
| ibm-i-db2-specialist | opencode-go/glm-5.1 | DB2 queries, optimization |
| database-sage | opencode-go/glm-5.1 | Schema, migrations |
| api-crafter | opencode-go/kimi-k2.6 | Node.js/Express endpoints |

### Quality & Security
| Agent | Model | Role |
|-------|-------|------|
| code-reviewer | opencode-go/deepseek-v4-pro | Code review (read-only) |
| security-sentinel | openai/gpt-5.5 | Security audit (read-only) |
| red-team-engineer | openai/gpt-5.5 | Adversarial testing |
| test-champion | opencode-go/qwen3.6-plus | Test strategy |
| qa-engineer | opencode-go/qwen3.6-plus | QA testing |

### Bugfixing & Performance
| Agent | Model | Role |
|-------|-------|------|
| fixer | amazon-bedrock/claude-sonnet-4-6 | Systematic debugging |
| performance-engineer | opencode-go/glm-5.1 | Performance optimization |
| refactoring-specialist | opencode-go/deepseek-v4-pro | Code refactoring |

### DevOps & Deploy
| Agent | Model | Role |
|-------|-------|------|
| deployment-engineer | openai/gpt-5.5 | Production deploy |
| devops-specialist | opencode-go/qwen3.6-plus | CI/CD |
| sre-specialist | opencode-go/glm-5.1 | Monitoring, SLOs |

---

## Skills Inventory (88 total)

### From addyosmani/agent-skills (23 skills)
- spec-driven-development, tdd, code-review, security, frontend-ui-engineering
- debugging, performance, ci-cd, api-and-interface-design, planning-and-task-breakdown
- code-review-and-quality, code-simplification, documentation-and-adrs
- shipping-and-launch, shipping-and-launch, context-engineering, deprecation-and-migration
- error-handling, git-workflow-and-versioning, incremental-implementation
- performance-optimization, security-and-hardening, testing-strategy

### OpenCode Default Skills (62 skills)
- flutter-* (13 skills), nodejs-express, db2-*, auth-security
- Material 3, navigation, riverpod, dio, offline-first, charts
- polish, ux-writing, animation-*, tailwind, responsive-design
- qa-checklist, production-grade-checklist, incident-response
- jwt-refresh-flow, sentry-*, mobile-deploy, monitoring-stack
- plus 14 superpowers (brainstorming, systematic-debugging, etc.)

### Project-Specific Skills (4)
- gmp-mobilidad-flutter (in skills/)
- granja-nextjs-shadcn (in skills/)
- OpenSpec skills (4 in .opencode/skills/)

---

## MCPs Active (16+)

### Always On (15)
context7, sequential-thinking, memory, filesystem, ddg-search, git, github,
firecrawl, ibm-db2-mcp, dart-flutter-mcp, pub-mcp, gmp-deploy-ssh, sentry, time, fetch

### On-Demand (18)
playwright, excel, iflow-flutter, code-graph-rag, chrome-devtools, vercel,
mcp-seo, web-quality-mcp, guardvibe, postgres, brave-search, tavily, slack,
desktop-commander, cloudflare, beads, ibmi-mcp-official, openspec

---

## Model Strategy

| Use Case | Best Model | Why |
|----------|-----------|-----|
| Reasoning/Planning | openai/gpt-5.5 | Top ARC-AGI, MMMU |
| Complex Code | opencode-go/kimi-k2.6 | SWE-bench top, 128k ctx, low cost |
| Analysis/Review | opencode-go/deepseek-v4-pro | Best bug detection |
| SQL/DB | opencode-go/glm-5.1 | Excellent structured reasoning |
| Speed/Tests/DevOps | opencode-go/qwen3.6-plus | Fast, reliable |
| Research | google/gemini-2.5-flash | 1M token context |
| Bugfixing | claude-sonnet-4-6 | Best incremental reasoning |

Every agent has a documented fallback model if primary fails.
