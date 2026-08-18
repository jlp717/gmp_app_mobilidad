---
name: implementation-strategy
description: Force design decisions before implementing. Five steps — define I/O, choose patterns, map dependencies, estimate complexity, identify risks — before touching code.
---

# Implementation Strategy

## Overview

Starting to code while the design is still fuzzy is the single biggest cause of rework. This skill enforces a short but rigorous design phase before any implementation begins. The output is a one-paragraph implementation brief that every team member can read and agree on before a single line of code is written.

**Rule:** You may not open a code file until all five steps are complete.

## When to Use

- Before implementing any feature larger than a one-line fix
- Before starting a new module, service, or component
- When a requirement feels ambiguous or "we'll figure it out as we go"
- Before writing the first test in a TDD cycle
- After receiving a vague ticket with no acceptance criteria

## When NOT to Use

- Pure bug fixes with a known, isolated root cause
- Scaffolding (generating boilerplate, initializing a project)
- Trivial changes (renaming, moving files, updating constants)

---

## Step-by-Step Process

### Step 1 — Define Inputs and Outputs

Write down the exact data types flowing in and out. No "whatever makes sense." No "an object with user info."

```typescript
// BAD — fuzzy
// Input: user data
// Output: result

// GOOD — precise
// Input:
interface CreateUserCommand {
  email: string;          // validated, lowercase, max 254 chars
  displayName: string;    // 1–50 chars, sanitized
  role: 'admin' | 'member' | 'viewer';
}

// Output:
interface CreateUserResult {
  userId: string;         // UUID v4
  createdAt: Date;
}

// Errors:
// - DuplicateEmailError if email already exists
// - ValidationError if constraints violated
```

If you cannot write this in 5 minutes, the requirement is not understood yet. Clarify before proceeding.

### Step 2 — Choose Design Patterns

Identify which pattern fits the problem and articulate WHY — not just "I'll use a repository."

| Problem Shape | Pattern | Why |
|---|---|---|
| Interchangeable algorithms | Strategy | Swap behavior at runtime without conditionals |
| One-to-many state change notifications | Observer / EventEmitter | Decouple producers from consumers |
| Family of related objects | Factory / Abstract Factory | Centralize construction logic |
| Data access abstraction | Repository | Swap DB implementations, easy to mock in tests |
| Cross-cutting concerns (logging, auth) | Middleware / Decorator | Don't pollute domain logic |
| Complex object construction | Builder | Readable multi-step construction |

Document your choice:

```
Pattern: Repository + Strategy
Why: The data source (Postgres vs. mock) needs to be swappable for tests.
     The pricing calculation varies by customer tier — Strategy lets us add tiers without modifying existing code.
```

### Step 3 — Map Dependencies

List every external dependency the implementation will touch:

```
External dependencies:
- PostgreSQL (via Prisma ORM) — read/write users table
- Redis — session store, TTL 24h
- SendGrid API — send welcome email
- Auth middleware — validates JWT, injects req.user

Mock boundaries (for unit tests):
- UserRepository interface (mocks the DB)
- EmailService interface (mocks SendGrid)

Shared state concerns:
- users.email must be unique — requires DB-level constraint + app-level check
```

Identify which dependencies need **interfaces defined before implementation** so they can be mocked in tests.

### Step 4 — Estimate Complexity

| Size | Effort | Action |
|---|---|---|
| S | < 2 hours | Implement directly |
| M | 2 hours – 1 day | Implement, but flag blockers at standup |
| L | > 1 day | **Decompose further** — an L task is a sign the design is not granular enough |

If the estimate is L, break it into subtasks that are each M or S. Repeat Steps 1–3 for each subtask.

### Step 5 — Identify Risks

Answer these before writing code:

1. **What could go wrong?** (race condition on the unique constraint, SendGrid rate limit, token expiry edge case)
2. **What is unknown?** (Does the auth middleware inject the user before or after body parsing? Check the middleware order)
3. **What needs a spike first?** (Never used Prisma's `createMany` — test it in isolation before relying on it)
4. **What is the rollback plan?** (If the migration fails mid-way, can we revert without data loss?)

Write risks as specific statements, not vague concerns:

```
Risk: Concurrent registrations with the same email will both pass the app-level uniqueness check
      before either hits the DB unique constraint — causing one to fail with an unhandled DB error.
Mitigation: Wrap Prisma error code P2002 and rethrow as DuplicateEmailError. Add test for this race.
```

### Step 6 — Write the Implementation Brief

One paragraph. If you can't summarize it in a paragraph, the design is not ready.

```
IMPLEMENTATION BRIEF — CreateUser feature

We will implement a CreateUserUseCase that accepts a CreateUserCommand (email, displayName, role),
validates it via a UserValidator (Strategy pattern), persists via UserRepository (Repository pattern
backed by Prisma), and triggers a WelcomeEmailJob via an EmailService interface. The repository and
email service will be injected as constructor dependencies for testability. The happy path returns
CreateUserResult{userId, createdAt}. Duplicate email errors from Prisma (P2002) are caught and
rethrown as DuplicateEmailError. Complexity: M (estimated 4h). Risk: concurrent duplicate email —
mitigated by catching P2002. Spike needed: verify Prisma transaction behavior when email unique
constraint fails mid-transaction.
```

### Anti-Patterns

| Anti-Pattern | Consequence |
|---|---|
| Starting to code while design is fuzzy | First implementation becomes the design; rework is expensive |
| "We'll figure out the interface later" | Parallel work becomes incompatible; painful merge |
| Skipping risk identification | Unknowns surface mid-implementation, causing scope creep |
| Estimating L without decomposing | Large tasks block PRs for days, risk integration conflicts |
| Choosing a pattern by habit, not by fit | Overengineered or mismatched design baked in early |

---

## Verification Checklist

- [ ] Input and output types are written down with exact TypeScript/Dart types
- [ ] Design pattern chosen with a written justification (not just the name)
- [ ] All external dependencies listed; mock boundaries identified
- [ ] Complexity estimated: S / M / L — if L, decomposed into smaller tasks
- [ ] At least two specific risks identified with concrete mitigations
- [ ] One-paragraph implementation brief written and agreed upon
- [ ] Implementation started with the hardest or riskiest part first
