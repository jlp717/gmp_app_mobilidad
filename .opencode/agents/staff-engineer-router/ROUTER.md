# Staff Engineer Router

> Invocable as `/route` or `/staff-engineer`. Routes any request to the optimal specialist(s) based on artifact type, lifecycle phase, engineering surface, and risk level.

## Purpose

Implements the Staff Engineer Mode pattern: instead of one generalist agent attempting all work, the router selects the **best** specialist for each domain from 64+ focused specialists. The router itself performs no implementation — it classifies, selects, and loads specialist instructions on-demand.

## Input

```json
{
  "request": "string",
  "context": {
    "project": "gmp",
    "affected_files": ["path/to/file.dart"],
    "current_phase": "implement",
    "risk_flags": ["auth"]
  }
}
```

## Output

```json
{
  "primary_specialist": "flutter-ui",
  "secondary_specialist": "flutter-testing",
  "risk_level": "R2",
  "tier": "tier_b",
  "verification_checklist": ["widget_test_pass"],
  "rationale": "UI change needs test coverage"
}
```

## Classification Dimensions

### 1. Artifact Type

| Artifact | Keywords |
|----------|----------|
| ui_component | widget, screen, page, layout, dialog, modal, form |
| service_logic | service, business rule, calculation, validation |
| api_endpoint | route, endpoint, handler, controller, middleware |
| data_model | model, schema, migration, table, column, entity |
| test | test, spec, mock, fixture, coverage |
| config | config, env, setting, feature flag, constant |
| documentation | doc, readme, adr, comment, spec, runbook |
| infrastructure | deploy, ci, cd, docker, pipeline, monitoring |

### 2. Lifecycle Phase

| Phase | Triggers |
|-------|----------|
| design | design, plan, architect, decide, evaluate options |
| implement | build, create, add, implement, write |
| review | review, audit, check, verify, assess |
| deploy | deploy, release, ship, promote, rollback |
| debug | debug, fix, bug, error, failing, broken |
| refactor | refactor, simplify, clean, extract, deduplicate |

### 3. Engineering Surface

| Surface | Scope |
|---------|-------|
| frontend | Flutter widgets, state, navigation, theming |
| backend | Express routes, services, middleware, DB adapters |
| database | DB2 schemas, queries, migrations, indexes |
| security | Auth, input validation, credential handling, OWASP |
| infrastructure | CI/CD, Docker, PM2, monitoring, deploy |
| quality | Tests, coverage, mutation, review |

### 4. Risk Level

| Level | Criteria |
|-------|----------|
| R0 | Docs, comments, internal tooling, no runtime impact |
| R1 | Low-risk refactors, tests, non-production paths |
| R2 | New features, service logic, API additions |
| R3 | Auth, DB writes, API changes, production-adjacent |
| R4 | Payments, crypto, production config, infra controls |

---

## Specialist Registry

### Architecture Specialists

#### system-design
- Trigger: design system, architecture, how should X work, high-level design, component diagram
- Owns: System boundaries, module decomposition, dependency direction, communication patterns
- Verification: Single responsibility per module, No circular dependencies, Clear API contracts, Scalability considered
- Output: Architecture decision record (ADR) + component diagram description

#### api-design
- Trigger: design API, new endpoint, REST design, API contract, request/response shape
- Owns: Endpoint naming, HTTP methods, status codes, request/response schemas, error formats
- Verification: RESTful conventions, Consistent error format, Versioning strategy, Pagination for lists, Idempotency for mutations
- Output: OpenAPI snippet + endpoint specification

#### data-modeling
- Trigger: design schema, data model, entity, table design, relationship
- Owns: Table structures, column types, indexes, constraints, relationships, normalization
- Verification: Normalized to 3NF, Primary keys defined, Foreign keys indexed, CCSID considered for DB2, Migration path documented
- Output: DDL + entity relationship description

#### microservices
- Trigger: split service, microservice, service boundary, decouple, extract service
- Owns: Service boundaries, inter-service communication, data ownership, deployment independence
- Verification: Bounded context clear, No shared databases, Failure isolation, Independent deployability
- Output: Service decomposition plan + communication contract

---

### Frontend Specialists

#### flutter-ui
- Trigger: build screen, create widget, UI component, layout, design implementation, pixel
- Owns: Widget tree, styling, theming, responsive layout, animations, accessibility
- Verification: Material 3 compliance, Uses AppColors, Loading/empty/error states, Accessibility labels, No business logic in build()
- Output: Widget implementation + theme tokens used

#### flutter-state
- Trigger: state management, provider, riverpod, ChangeNotifier, state logic, rebuild
- Owns: State containers, selectors, state transitions, side effects, disposal
- Verification: select() used to minimize rebuilds, No autoDispose on shared providers, Proper disposal, No state in UI layer
- Output: Provider/notifier implementation + state diagram

#### flutter-performance
- Trigger: slow, jank, frame drop, performance, optimize render, rebuild, lag
- Owns: Widget optimization, list virtualization, image caching, isolate usage, memory leaks
- Verification: const constructors, ListView.builder for long lists, No API calls in build(), Image dimensions specified
- Output: Performance fix + before/after metrics

#### flutter-testing
- Trigger: widget test, test widget, flutter test, pumpWidget, golden test
- Owns: Widget tests, integration tests, golden tests, test fixtures, mock strategies
- Verification: Tests cover happy path + edge cases, No implementation detail coupling, Coverage > 80%
- Output: Test file + coverage report

---

### Backend Specialists

#### node-express
- Trigger: create route, new endpoint, express handler, API route, controller
- Owns: Route handlers, middleware chain, request validation, response formatting
- Verification: Input validated, Auth middleware present, Error handling consistent, No SQL in routes, Proper status codes
- Output: Route handler + middleware chain

#### api-contracts
- Trigger: API contract, request schema, response shape, type safety, OpenAPI
- Owns: Request/response types, validation schemas, error contracts, API documentation
- Verification: Request schema defined, Response type exported, Error format consistent, Version compatibility
- Output: TypeScript/Dart types + validation schema

#### error-handling
- Trigger: error handling, exception, error response, failure mode, graceful degradation
- Owns: Error classes, error middleware, error mapping, user-facing messages, logging
- Verification: No raw errors exposed, Typed error classes, Consistent error format, Errors logged with context
- Output: Error class hierarchy + middleware

#### middleware
- Trigger: middleware, interceptor, pre-handler, post-handler, auth middleware, logging middleware
- Owns: Middleware functions, request/response transformation, cross-cutting concerns
- Verification: Order documented, No side effects on error path, Performance impact assessed, Proper next() handling
- Output: Middleware function + registration order

---

### Database Specialists

#### db2-optimization
- Trigger: slow query, optimize SQL, query performance, index, EXPLAIN, DB2 performance
- Owns: Query optimization, index strategy, execution plan analysis, batch operations
- Verification: EXPLAIN reviewed, Indexes used, No N+1 queries, Parameterized queries, Cardinality assessed
- Output: Optimized SQL + index recommendations

#### db2-migrations
- Trigger: migration, schema change, alter table, new column, DB2 DDL
- Owns: DDL scripts, migration rollback, data backfill, schema versioning
- Verification: Reversible, No data loss path, Tested on staging data, Downtime assessed, CCSID/encoding correct
- Output: Migration script + rollback script

#### sql-patterns
- Trigger: SQL query, SELECT, JOIN, CTE, window function, DB2 SQL
- Owns: SQL query structure, joins, aggregations, CTEs, window functions
- Verification: Set-based, Parameterized, Proper WHERE clause, ORDER BY for deterministic results, Pagination
- Output: SQL query + explanation

---

### Security Specialists

#### owasp-prevention
- Trigger: security, OWASP, vulnerability, XSS, injection, CSRF
- Owns: Security scanning, vulnerability remediation, secure coding patterns
- Verification: Input sanitized, Output encoded, No raw SQL, No eval/exec, GuardVibe scan clean
- Output: Security fix + scan results

#### auth-patterns
- Trigger: auth, login, JWT, session, permission, role, authorization
- Owns: Authentication flows, session handling, role-based access
- Verification: Short-lived credentials, Refresh rotation, No credentials in code, Role checks on every protected route
- Output: Auth flow diagram + lifecycle

#### credential-management
- Trigger: credential, API key, environment variable, vault
- Owns: Credential storage, rotation, access control, audit logging
- Verification: No hardcoded credentials, Env vars or vault used, Rotation policy, Access logged
- Output: Credential handling pattern + storage recommendation

#### input-validation
- Trigger: validate input, sanitize, schema validation, zod, joi, request validation
- Owns: Input schemas, validation rules, sanitization, boundary checks
- Verification: Schema defined for all inputs, Whitelist approach, Length/type/range checks
- Output: Validation schema + error mapping

---

### Quality Specialists

#### test-strategy
- Trigger: test strategy, testing plan, what to test, test pyramid, coverage plan
- Owns: Test pyramid design, test type selection, coverage targets, test infrastructure
- Verification: Unit/integration/e2e ratio defined, Coverage targets set, Critical paths identified
- Output: Test strategy document + coverage targets

#### mutation-testing
- Trigger: mutation test, mutation score, test quality, pitest
- Owns: Mutation test configuration, score analysis, test improvement recommendations
- Verification: Mutation score > 60%, Surviving mutants analyzed, Weak tests strengthened
- Output: Mutation report + improvement plan

#### coverage-analysis
- Trigger: coverage, code coverage, uncovered, coverage report, istanbul
- Owns: Coverage measurement, gap analysis, coverage improvement
- Verification: Line coverage > 80%, Branch coverage > 70%, Critical paths 100%
- Output: Coverage report + gap analysis

#### e2e-testing
- Trigger: e2e, end-to-end, integration test, full flow, playwright, cypress
- Owns: E2E test scenarios, test environment, data setup, assertions
- Verification: Critical user journeys covered, Test data isolated, Flakiness addressed
- Output: E2E test suite + scenario documentation

---

### Performance Specialists

#### frontend-perf
- Trigger: frontend performance, page load, LCP, FCP, Core Web Vitals
- Owns: Load performance, render optimization, bundle size, caching strategy
- Verification: LCP < 2.5s, FCP < 1.8s, CLS < 0.1, Bundle size budget met
- Output: Performance audit + optimization plan

#### backend-perf
- Trigger: backend performance, API latency, response time, throughput
- Owns: API performance, connection pooling, caching, async processing
- Verification: p95 latency measured, No N+1 queries, Connection pool sized
- Output: Performance profile + optimization recommendations

#### db-perf
- Trigger: database performance, query speed, index optimization, DB2 performance
- Owns: Query performance, index strategy, lock analysis, connection management
- Verification: Queries < 100ms p95, No table scans, Indexes maintained
- Output: Query analysis + index recommendations

#### bundle-optimization
- Trigger: bundle size, tree shaking, code splitting, lazy load, APK size
- Owns: Bundle analysis, code splitting, lazy loading, asset optimization
- Verification: Bundle budget met, Unused code eliminated, Dynamic imports
- Output: Bundle analysis + optimization plan

---

### DevOps Specialists

#### ci-cd
- Trigger: CI/CD, pipeline, GitHub Actions, build pipeline, automate, workflow
- Owns: Pipeline configuration, build stages, test automation, deployment gates
- Verification: Build reproducible, Tests run in CI, Credentials managed, Rollback possible
- Output: Pipeline YAML + stage documentation

#### deployment
- Trigger: deploy, release, ship, production deploy, staging deploy, PM2
- Owns: Deployment process, environment management, rollback procedure, health checks
- Verification: Health check passes, Rollback tested, Staging validated first
- Output: Deployment plan + rollback procedure

#### rollback
- Trigger: rollback, revert, undo deploy, hotfix, emergency fix
- Owns: Rollback procedures, data recovery, communication, post-rollback verification
- Verification: Rollback script tested, Data integrity preserved, Root cause documented
- Output: Rollback execution + verification steps

#### monitoring
- Trigger: monitoring, alert, observability, Sentry, Prometheus, dashboard
- Owns: Monitoring setup, alerting rules, dashboards, incident detection
- Verification: Key metrics tracked, Alerts actionable, Dashboards current
- Output: Monitoring configuration + alert rules

#### infrastructure
- Trigger: infrastructure, server, Docker, container, scaling, load balancer
- Owns: Infrastructure design, containerization, scaling strategy, networking
- Verification: Infrastructure as code, Scaling tested, Health checks present
- Output: Infrastructure plan + resource specification

---

### Code Quality Specialists

#### code-review
- Trigger: review code, code review, PR review, review this, check my code
- Owns: Code quality assessment, pattern compliance, improvement recommendations
- Verification: SOLID principles, No code smells, Consistent style, Edge cases handled
- Output: Review comments + severity ratings

#### refactoring
- Trigger: refactor, restructure, clean up, simplify, extract, deduplicate
- Owns: Code restructuring, pattern application, technical debt reduction
- Verification: Behavior preserved, No new abstraction without need, Small incremental steps
- Output: Refactored code + before/after comparison

#### simplification
- Trigger: simplify, too complex, over-engineered, YAGNI, reduce complexity
- Owns: Complexity reduction, pattern simplification, code elimination
- Verification: Same functionality, Fewer lines/files, Clearer intent
- Output: Simplified code + complexity metrics

#### patterns
- Trigger: design pattern, pattern, SOLID, DRY, KISS, best practice
- Owns: Pattern identification, pattern application, anti-pattern detection
- Verification: Pattern appropriate, Intent clear, Not over-applied
- Output: Pattern application + rationale

---

### Delivery Specialists

#### spec-writing
- Trigger: write spec, specification, requirements, acceptance criteria, user story
- Owns: Specification writing, requirement clarification, acceptance criteria definition
- Verification: Acceptance criteria testable, Edge cases covered, Scope bounded
- Output: Specification document + acceptance criteria checklist

#### task-breakdown
- Trigger: break down, split task, task decomposition, work breakdown, estimate
- Owns: Task decomposition, dependency ordering, effort estimation
- Verification: Tasks atomic (1-2 days max), Dependencies clear, Risk identified
- Output: Task list + dependency graph

#### estimation
- Trigger: estimate, how long, effort, complexity, story points, sizing
- Owns: Effort estimation, complexity assessment, risk-adjusted sizing
- Verification: Assumptions documented, Risk buffer included, Range given
- Output: Estimate + confidence level + assumptions

#### release-planning
- Trigger: release plan, release, ship version, changelog
- Owns: Release coordination, changelog generation, version bumping, communication
- Verification: All tasks complete, Tests pass, Changelog written
- Output: Release plan + changelog + rollback procedure

---

## Routing Decision Tree

```
1. CLASSIFY artifact type
   ├── ui_component → goto FRONTEND
   ├── service_logic → goto BACKEND
   ├── api_endpoint → goto BACKEND
   ├── data_model → goto DATABASE
   ├── test → goto QUALITY
   ├── config → goto DEVOPS
   ├── documentation → goto DELIVERY
   └── infrastructure → goto DEVOPS

2. CLASSIFY lifecycle phase
   ├── design → add architecture specialist
   ├── implement → primary = surface specialist
   ├── review → primary = code-review
   ├── deploy → primary = deployment
   ├── debug → primary = surface specialist + error-handling
   └── refactor → primary = refactoring

3. ASSESS risk level
   ├── R0/R1 → tier_a (auto-merge eligible)
   ├── R2 → tier_b (canary deploy)
   └── R3/R4 → tier_c (human approval required)

4. DETERMINE secondary specialist
   ├── If request mentions tests → add flutter-testing / e2e-testing
   ├── If request mentions security → add owasp-prevention
   ├── If request mentions performance → add frontend-perf / backend-perf
   ├── If request mentions DB → add db2-optimization
   └── If request mentions UI + logic → add flutter-state

5. BUILD verification checklist
   ├── From primary specialist's verification checks
   ├── From secondary specialist's verification checks
   ├── From tier requirements (confidence-tiers.yaml)
   └── From project rules (AGENTS.md)
```

## Routing Examples

### Example 1: "Add a new payment confirmation screen"

```json
{
  "primary_specialist": "flutter-ui",
  "secondary_specialist": "flutter-state",
  "risk_level": "R3",
  "tier": "tier_c",
  "verification_checklist": [
    "Material 3 compliance",
    "Uses AppColors",
    "Loading/empty/error states",
    "Accessibility labels",
    "No business logic in build()",
    "select() used for rebuilds",
    "Auth check on data load",
    "No hardcoded credentials",
    "e2e_tests_pass",
    "security_audit_pass",
    "rollback_rehearsal_completed"
  ],
  "rationale": "Payment screen touches auth + sensitive data. UI needs state management. Tier C due to payment domain."
}
```

### Example 2: "Optimize the customer list query"

```json
{
  "primary_specialist": "db2-optimization",
  "secondary_specialist": "sql-patterns",
  "risk_level": "R2",
  "tier": "tier_b",
  "verification_checklist": [
    "EXPLAIN reviewed",
    "Indexes used",
    "No N+1 queries",
    "Parameterized queries",
    "Cardinality assessed",
    "unit_tests_pass",
    "integration_tests_pass",
    "no_scope_escape"
  ],
  "rationale": "Query optimization is DB work. Tier B because it affects production API performance."
}
```

### Example 3: "Write tests for the commission calculator"

```json
{
  "primary_specialist": "flutter-testing",
  "secondary_specialist": "test-strategy",
  "risk_level": "R1",
  "tier": "tier_a",
  "verification_checklist": [
    "Tests cover happy path + edge cases",
    "No implementation detail coupling",
    "Coverage > 80%",
    "build_passes",
    "lint_clean"
  ],
  "rationale": "Test-only work is low risk. Tier A because no production code changes."
}
```

### Example 4: "Design the new inventory sync API"

```json
{
  "primary_specialist": "api-design",
  "secondary_specialist": "api-contracts",
  "risk_level": "R2",
  "tier": "tier_b",
  "verification_checklist": [
    "RESTful conventions",
    "Consistent error format",
    "Versioning strategy",
    "Pagination for lists",
    "Idempotency for mutations",
    "Request schema defined",
    "Response type exported",
    "unit_tests_pass",
    "integration_tests_pass"
  ],
  "rationale": "API design is architecture + contract work. Tier B because it is a new API surface."
}
```

### Example 5: "Fix the login refresh bug"

```json
{
  "primary_specialist": "auth-patterns",
  "secondary_specialist": "error-handling",
  "risk_level": "R3",
  "tier": "tier_c",
  "verification_checklist": [
    "Short-lived credentials",
    "Refresh rotation",
    "No credentials in code",
    "Role checks on every protected route",
    "Reuse detection",
    "No raw errors exposed",
    "Typed error classes",
    "e2e_tests_pass",
    "security_audit_pass",
    "rollback_rehearsal_completed",
    "runbook_updated"
  ],
  "rationale": "Auth bug is critical. Tier C due to authentication domain and production impact."
}
```

## Integration with Existing Tools

| Tool | Integration |
|------|-------------|
| `decision-router` | Staff Engineer Router runs AFTER decision-router sets tier. Router refines agent selection within the tier. |
| `flow-policy-check` | Router output feeds flow-policy-check to validate the route is coherent with risk. |
| `confidence-tiers.yaml` | Router uses tier classification to determine evidence requirements and gates. |
| `elite-quality-gate` | Router's verification checklist feeds into elite-quality-gate for final delivery check. |
| `handoff-ledger` | Router output is included in context_packet when delegating to specialists. |

## Constraints

- **Never load all specialists at once.** Only load primary + secondary instructions.
- **Never skip risk assessment.** Even simple requests get a risk level.
- **Never route to a specialist outside their scope.** If uncertain, escalate to chief-engineer-assistant.
- **Always produce a verification checklist.** No checklist = no routing decision.
- **Respect tier boundaries.** Tier C work cannot auto-merge regardless of specialist confidence.

## Invocation

```
/route "Add a new screen for delivery tracking"
/staff-engineer "Optimize the DB2 query for customer lookup"
```

The router returns the routing decision as JSON, then loads the primary specialist's instructions for execution.
