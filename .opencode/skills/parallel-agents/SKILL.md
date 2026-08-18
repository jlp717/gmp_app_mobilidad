---
name: parallel-agents
description: Divide independent tasks across parallel agents. Covers task decomposition, contract definition, agent assignment, coordination, merging, and anti-patterns.
---

# Parallel Agents

## Overview

When a task has two or more independent subtasks — no shared mutable state, no sequential dependency — spawning parallel agents cuts wall-clock time dramatically. Each agent works in isolation with a well-defined input/output contract; the orchestrator merges results and runs the full test suite. This skill defines when, how, and how NOT to parallelize.

## When to Use

- Two or more features can be built independently (e.g., feature A touches `auth/`, feature B touches `billing/`)
- Frontend and backend work is clearly separated by a stable API contract
- Tests can be written in parallel with implementation when the interface is already defined
- Multiple independent bug fixes in different modules

## When NOT to Use

- Tasks share mutable state (same DB schema change, same config file, same global store)
- The output of Task A is the input to Task B — that is sequential, not parallel
- The shared interface/contract is not yet defined — parallelizing before contracts causes merge conflicts
- More than 4 agents — beyond that, coordination overhead exceeds the time saved

---

## Step-by-Step Process

### Step 1 — Identify Natural Seams

Decompose the work along boundaries that minimize coupling:

| Seam Type | Example |
|---|---|
| Feature boundary | Auth module vs. Notifications module |
| Layer boundary | API routes vs. React components |
| Phase boundary | Implementation vs. Tests (when interface is locked) |
| Domain boundary | User service vs. Payment service |

Ask: *"Can these two tasks proceed to completion without needing each other's output?"*  
If no → sequential. If yes → candidate for parallel.

### Step 2 — Define Contracts Before Spawning

Every parallel agent must receive a contract that defines exactly:
- **Input**: data types, function signatures, API request/response shapes
- **Output**: what the agent must produce (files, exports, passing tests)
- **Assumptions**: what is already done, what is out of scope

```typescript
// Shared contract defined BEFORE agents start — shared/types.ts
export interface CreateOrderRequest {
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface CreateOrderResponse {
  orderId: string;
  total: number;
  status: 'pending' | 'confirmed' | 'failed';
}
```

Agent A (backend) implements `POST /orders` using this contract.  
Agent B (frontend) builds the checkout form using this contract.  
Neither needs to wait for the other.

### Step 3 — Assign Agents to Specialists

Match tasks to agent roles:

| Task Type | Assign To |
|---|---|
| Implementation | `@developer` |
| Tests | `@developer` (TDD) or dedicated test agent |
| API design | `@oracle` review first, then `@developer` |
| Security review | `@security-sentinel` |
| UI/UX | `@frontend-designer` |

### Step 4 — Spawn with Explicit Prompts

Each agent prompt must include:
1. The shared contract (paste the type definitions)
2. Exactly what files to create or modify
3. Acceptance criteria (how the agent knows it's done)
4. What NOT to touch (out of scope)

**Template:**

```
You are working on [task name].

SHARED CONTRACT:
[paste interface/type definitions]

YOUR TASK:
Implement [specific thing]. Create/modify: [list files].

ACCEPTANCE CRITERIA:
- [ ] [criterion 1]
- [ ] [criterion 2]

OUT OF SCOPE — DO NOT TOUCH:
- [file or module]
- [file or module]
```

### Step 5 — Merge and Integrate

After all agents complete:

1. Review each agent's output **independently** — check for contract compliance
2. Merge outputs into the main branch (resolve conflicts if any)
3. Run the **full test suite** — not just the affected modules
4. Run type checking (`tsc --noEmit`) and linting
5. Manually verify the integrated behavior end-to-end

```bash
# After merging all agent outputs
npm run type-check
npm run lint
npm test
```

### Step 6 — Anti-Patterns to Avoid

| Anti-Pattern | Why It Fails |
|---|---|
| Parallel agents sharing a config file | Both agents will overwrite each other's changes |
| Spawning agents before contracts are defined | Agents make incompatible assumptions, painful merge |
| More than 4 parallel agents | Context fragments, merge conflicts multiply |
| Agent A depends on Agent B's output | That's sequential work disguised as parallel |
| No acceptance criteria in the prompt | Agent delivers incomplete or misaligned work |
| Parallelizing a DB migration with feature work | Schema changes are irreversible; never parallelize |

### Capacity Guideline

- **2 agents**: ideal for frontend/backend split
- **3 agents**: feature A / feature B / tests
- **4 agents**: max — frontend / backend / tests / docs
- **5+ agents**: do not parallelize; decompose the problem differently

---

## Verification Checklist

- [ ] Shared contracts (types, interfaces, API shapes) defined before any agent started
- [ ] Each agent had an explicit scope: files to create, files NOT to touch
- [ ] No two agents were assigned to modify the same file
- [ ] Full test suite passes after merging all agent outputs
- [ ] Type check (`tsc --noEmit`) passes after merge
- [ ] Integrated behavior verified end-to-end, not just per-agent
- [ ] No more than 4 parallel agents were active simultaneously
- [ ] Each agent's output reviewed independently before integration
