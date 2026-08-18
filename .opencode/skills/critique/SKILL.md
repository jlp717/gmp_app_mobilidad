---
name: critique
description: Constructive critique for code, design, and architecture. Five-dimension framework with specificity rules, tone standards, and a prioritized output format.
---

# Constructive Critique

## Overview

A critique is not a code review checklist — it is a structured argument about what will fail, why, and what to do instead. Every finding must include a location, evidence, and a concrete alternative. Vague criticism ("this is bad") is noise; specific critique ("this will cause a race condition under concurrent writes because X is not atomic — use a DB transaction instead") is actionable signal.

## When to Use

- Before merging a significant feature or architectural change
- When reviewing a design document or ADR (Architecture Decision Record)
- When asked "does this look good?" about code you haven't written
- During a post-mortem to identify root causes in design decisions
- Before a system goes to production and defects become expensive

## When NOT to Use

- Style and formatting issues — use a linter, not a critique
- Trivially correct code that just needs a second pair of eyes — use a quick review instead
- When the author needs encouragement more than rigor — calibrate to context
- When you don't have enough context to have an informed opinion — ask questions first

---

## The Five-Dimension Framework

### Dimension 1 — What Works (Anchor Positives)

Start by identifying what is genuinely correct and well-designed. This is not flattery — it establishes shared ground and signals that the critique is calibrated, not adversarial.

Be specific:

```
✅ The repository pattern correctly isolates the DB from domain logic.
   Swapping the data source in tests is straightforward as a result.
```

### Dimension 2 — What Could Fail (Specific Failure Modes)

For every failure mode, provide: **location + mechanism + trigger condition**.

Template: *"This will fail when [condition] because [mechanism]. Consider [alternative]."*

```
⚠️ src/services/order.service.ts:47 — The stock check and order creation are two separate DB calls
   with no transaction. Under concurrent load, two users can both pass the stock check and both
   create orders, overselling inventory. Use a Prisma transaction with SELECT FOR UPDATE or
   optimistic locking with a version field.
```

### Dimension 3 — Edge Cases (Enumerate Them)

List specific inputs or states the code does not handle:

```
Edge cases not handled:
- Empty array input to calculateTotal() → NaN result (line 23)
- User with no assigned role → falls through all role checks, gets admin access (auth.guard.ts:81)
- Timezone offset for users in UTC-12 → date comparison on line 94 uses server local time
- Concurrent password reset requests → both tokens valid simultaneously (no invalidation of prior token)
```

### Dimension 4 — Scalability (10x Load / Data / Users)

Ask: what breaks first when this grows by 10x?

```
Scalability concerns:
- The notification loop (notifications.service.ts:120) sends emails synchronously inside
  the request handler. At 10x users, registration becomes a 30s operation. Move to a job queue
  (BullMQ, SQS) and return 202 Accepted.
- The dashboard query loads all orders for the user with no pagination. At 10x data,
  this is an OOM risk. Add cursor-based pagination and a DB index on (user_id, created_at DESC).
- The in-memory session store (MemoryStore) cannot be shared across multiple Node instances.
  Replace with Redis before adding a second pod.
```

### Dimension 5 — Maintainability (Onboarding Time / Change Surface)

Ask: how hard is it to change this in 6 months?

```
Maintainability concerns:
- The pricing logic is duplicated in three places: cart.service.ts, order.service.ts, and
  invoice.service.ts. A pricing rule change requires three coordinated edits. Extract a
  PricingCalculator service with a single source of truth.
- Magic number 86400 appears 5 times across the codebase with no named constant.
  It represents session TTL in seconds — define SESSION_TTL_SECONDS = 86400 once.
- The UserController is 420 lines and handles auth, profile, preferences, and billing.
  It violates SRP. A new developer cannot reason about it as a unit. Split into focused controllers.
```

---

## Specificity Rule

Every critique finding must have all three:

| Component | Bad Example | Good Example |
|---|---|---|
| **Location** | "somewhere in auth" | `src/auth/jwt.strategy.ts:34` |
| **Evidence** | "this is insecure" | "RS256 algorithm not enforced — any algorithm the token claims is accepted" |
| **Alternative** | "fix it" | "Pass `algorithms: ['RS256']` to `jwt.verify()` to reject algorithm substitution attacks" |

A finding missing any of these three components is incomplete. Do not submit it.

---

## Output Format

```
## Critique Report — [Component / PR / Design]

### What Works
- [Positive finding 1]
- [Positive finding 2]

### Findings

| Priority | Location | Finding | Evidence | Suggestion |
|---|---|---|---|---|
| Critical | file:line | [finding] | [evidence] | [suggestion] |
| High | file:line | [finding] | [evidence] | [suggestion] |
| Medium | file:line | [finding] | [evidence] | [suggestion] |
| Low | file:line | [finding] | [evidence] | [suggestion] |

### Edge Cases Not Handled
- [edge case 1]
- [edge case 2]

### Scalability Risks
- [risk 1]
- [risk 2]

### Maintainability Concerns
- [concern 1]
- [concern 2]
```

**Priority definitions:**

| Priority | Meaning |
|---|---|
| Critical | Will cause data loss, security breach, or crash in production. Block merge. |
| High | Will cause incorrect behavior or degrade reliability under normal use. Should fix before merge. |
| Medium | Technical debt that will cause problems at scale or after multiple changes. Fix in next iteration. |
| Low | Style, naming, or minor structural improvement. Fix opportunistically. |

---

## Architecture Critique — Mandatory Questions

When critiquing an architecture or system design, always answer:

1. **What happens when [dependency X] is down?** Is there a fallback? Does it fail open or closed?
2. **What is the rollback plan?** If this is deployed and broken, how long to revert?
3. **How do we debug this in production?** Are there logs, traces, metrics, and alerts?
4. **What is the blast radius?** If this component fails, what else fails with it?
5. **What are the consistency guarantees?** Is eventual consistency acceptable here?

---

## Verification Checklist

- [ ] Every finding includes location, evidence, and a concrete alternative
- [ ] At least one positive finding anchors the critique (no pure negativity)
- [ ] Edge cases enumerated as specific inputs, not general categories
- [ ] Scalability analysis covers 10x load AND 10x data size
- [ ] Maintainability includes change surface and onboarding cost
- [ ] Architecture critique answers the five mandatory questions
- [ ] Findings are prioritized Critical / High / Medium / Low
- [ ] Tone is specific and impersonal ("this will fail when X") not personal ("you made a mistake")
