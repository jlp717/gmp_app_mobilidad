---
name: anti-rationalization
description: Zero-Trust Delivery — prevents agents from skipping quality steps via rationalization patterns. Invocable as /anti-rationalization. Covers 20+ documented excuses with counter-arguments, evidence requirements, and escalation paths.
triggers:
  - /anti-rationalization
  - "skip verification"
  - "tests later"
  - "just a small change"
  - "it works on my machine"
  - "passed CI"
  - "prototype"
  - "config change only"
version: 1.0
---

# Anti-Rationalization System

Zero-Trust Delivery: agents do not self-certify. Every skill step requires evidence. No exceptions.

## Rationalization Table

### Pattern 1: "I'll add tests later"

| Field | Value |
|---|---|
| **Excuse** | "I'll add tests later / after this ships / in the next PR" |
| **Why it's wrong** | "Later" is a black hole. PRs with "add tests later" have a <15% test-addition rate. Untested code is technical debt with compound interest. |
| **Do instead** | Write the test BEFORE or ALONGSIDE the implementation. If the task is T2+, tests are a required evidence item. T1 bugs need a regression test. |
| **Evidence required** | Test file exists, runs, and passes. Coverage shows the changed lines are hit. No evidence = BLOCK. |

### Pattern 2: "It's just a small change"

| Field | Value |
|---|---|
| **Excuse** | "It's just a small change / one line / trivial / minor tweak" |
| **Why it's wrong** | Small changes in auth, DB, API contracts, and state management have caused 60%+ of production incidents. Size != risk. A one-line JWT validation skip is catastrophic. |
| **Do instead** | Classify the change by IMPACT, not lines. Touching auth/DB/API boundary? Full verification. Touching UI widget? Analyze + widget test. |
| **Evidence required** | Risk classification (R0-R4) matches verification depth. If R2+, full verification loop runs regardless of diff size. |

### Pattern 3: "The tests already cover this"

| Field | Value |
|---|---|
| **Excuse** | "Existing tests cover this / we have tests / coverage is good" |
| **Why it's wrong** | Coverage != protection. A test that hits a line does not assert its behavior. "Covered" tests often miss edge cases, error paths, and integration boundaries. |
| **Do instead** | Run `flutter analyze` / `npx jest` and check: (a) does a test assert the new behavior? (b) does it test error paths? (c) does it test the DB/API boundary? |
| **Evidence required** | Specific test name + assertion that proves the changed behavior is verified. "Tests pass" is insufficient. |

### Pattern 4: "It works on my machine"

| Field | Value |
|---|---|
| **Excuse** | "It works locally / passes on my branch / dev environment is fine" |
| **Why it's wrong** | Local dev != staging != production. DB data, network, auth state, feature flags, and OS-specific behavior differ. "Works locally" is the #1 prelude to production incidents. |
| **Do instead** | Verify in staging (Docker 192.168.1.230) or run the CI-equivalent locally. Backend: hit the actual API with production-like data. Flutter: run on device/emulator with release config. |
| **Evidence required** | Staging deployment passes OR CI pipeline green OR explicit production-like test evidence with documented assumptions. |

### Pattern 5: "I'll refactor it later"

| Field | Value |
|---|---|
| **Excuse** | "I'll refactor it later / clean it up after / tech debt for next sprint" |
| **Why it's wrong** | "Refactor later" is how 3,500-line files happen (see `rutero_detail_modal.dart`). Each "later" adds complexity on top of complexity, making future refactors exponentially harder. |
| **Do instead** | If you see a refactor need: (a) document it as a beads issue, (b) do the refactor NOW if it's within the task scope, (c) never leave the codebase worse than you found it. |
| **Evidence required** | No new ponytail markers added without upgrade triggers. No new files >500 lines. If refactor deferred: beads issue created with concrete trigger. |

### Pattern 6: "It's just a prototype"

| Field | Value |
|---|---|
| **Excuse** | "It's just a prototype / proof of concept / throwaway code / MVP" |
| **Why it's wrong** | Prototypes ship. MVPs become production. "Throwaway" code lives for years. Every prototype that reaches users needs the same verification as production code. |
| **Do instead** | Treat all code that compiles and runs as production-bound. Prototypes need: type safety, error handling, and a path to either delete or harden. |
| **Evidence required** | If prototype: explicit expiration plan (delete date or harden PR). If shipped: full verification loop. No "prototype" bypasses verification. |

### Pattern 7: "We don't need docs for this"

| Field | Value |
|---|---|
| **Excuse** | "No docs needed / self-documenting / it's obvious / no one reads docs anyway" |
| **Why it's wrong** | "Self-documenting" is what every developer believes about their own code. Six months later, no one (including you) remembers why. APIs, DB schemas, and auth rules MUST be documented. |
| **Do instead** | API changes: update OpenAPI/contract comments. DB changes: document schema change in migration. New feature: add brief entry to docs/. UI changes: screenshot in PR. |
| **Evidence required** | API route: JSDoc with params/returns. DB change: migration comment. UI change: visual evidence (screenshot). If truly internal-only: code comment explaining WHY. |

### Pattern 8: "Security isn't critical here"

| Field | Value |
|---|---|
| **Excuse** | "Security isn't critical / it's internal / low-risk endpoint / just a UI field" |
| **Why it's wrong** | Internal != safe. Lateral movement, privilege escalation, and data exfiltration all start from "low-risk" endpoints. Every input is a trust boundary. |
| **Do instead** | Run GuardVibe scan on every file. Validate inputs at every boundary. Auth check before DB access. Parameterized queries only. No exceptions for "internal" code. |
| **Evidence required** | GuardVibe scan clean (no HIGH/CRITICAL). Input validation present. Auth check before data access. Parameterized queries (no string concat SQL). |

### Pattern 9: "Performance is good enough"

| Field | Value |
|---|---|
| **Excuse** | "Performance is fine / fast enough / no one will notice the lag / it's not a bottleneck" |
| **Why it's wrong** | "Good enough" today is unacceptable tomorrow when data grows 10x. N+1 queries, unpaginated lists, and missing indexes compound silently until they cause outages. |
| **Do instead** | DB queries: check EXPLAIN plan, add indexes, paginate. Lists: virtualize or paginate. API: batch requests, avoid N+1. Measure before declaring "good enough." |
| **Evidence required** | Query plan reviewed OR pagination present OR batch loading used OR explicit benchmark with documented ceiling. |

### Pattern 10: "No one will notice"

| Field | Value |
|---|---|
| **Excuse** | "No one will notice / edge case / unlikely scenario / won't happen in practice" |
| **Why it's wrong** | Edge cases are where bugs live. "Unlikely" events happen daily at scale. Users find every edge case within hours of release. |
| **Do instead** | Handle the edge case explicitly. If truly impossible: document the invariant with an assertion. Never silently ignore. |
| **Evidence required** | Edge case handled OR invariant asserted OR explicit documented assumption with trigger condition. |

### Pattern 11: "It's behind a feature flag"

| Field | Value |
|---|---|
| **Excuse** | "It's behind a feature flag / can be rolled back / dark launch / gradual rollout" |
| **Why it's wrong** | Feature flags don't prevent bugs — they delay them. A broken feature behind a flag still breaks when enabled. Flags also add complexity and testing surface. |
| **Do instead** | Verify the code as if the flag is always ON. Test both ON and OFF paths. Feature flags are a deployment strategy, not a quality bypass. |
| **Evidence required** | Both flag states tested. Flag cleanup plan documented. No permanent flags without expiration. |

### Pattern 12: "We can fix it in the next sprint"

| Field | Value |
|---|---|
| **Excuse** | "Fix it next sprint / backlog item / known issue / tech debt ticket" |
| **Why it's wrong** | Next sprint never comes. Known issues compound. Every sprint adds new features while debt grows. The cost of fixing doubles every sprint it waits. |
| **Do instead** | Fix it now if it's in scope. If out of scope: create beads issue with severity, assign it, and document the risk. Never silently ship known bugs. |
| **Evidence required** | Fix applied OR beads issue created with: severity, impact, trigger condition, and assignee. |

### Pattern 13: "The old code was worse"

| Field | Value |
|---|---|
| **Excuse** | "The old code was worse / at least I improved it / better than before / legacy mess" |
| **Why it's wrong** | "Better than the worst part" is not a quality bar. Improving one area while leaving another broken is not progress. The baseline is the quality rubric, not the previous mess. |
| **Do instead** | Measure against the quality rubric (`.opencode/config/quality-rubric.yaml`), not against the old code. If old code is broken: fix it or file an issue. |
| **Evidence required** | Current code meets quality rubric standards. Old issues either fixed or tracked in beads. |

### Pattern 14: "It passed CI, so it's fine"

| Field | Value |
|---|---|
| **Excuse** | "CI is green / pipeline passed / all checks OK / lint clean" |
| **Why it's wrong** | CI checks syntax and basic tests. It does not check: logic correctness, security vulnerabilities, performance regressions, UX quality, or integration behavior. CI is a floor, not a ceiling. |
| **Do instead** | CI is necessary but not sufficient. After CI: run verification loop, check security, verify UX, test integration paths. |
| **Evidence required** | CI green AND verification loop PASS AND security scan clean AND (for UI) visual evidence. |

### Pattern 15: "It's just a config change"

| Field | Value |
|---|---|
| **Excuse** | "Just a config change / env var tweak / settings update / no code changed" |
| **Why it's wrong** | Config changes are production changes. Wrong env vars, misconfigured timeouts, incorrect feature flags, and bad DB connection strings cause outages. Config is code. |
| **Do instead** | Treat config changes as R3. Verify the config loads correctly, validate values, test with the new config in staging, and document the change. |
| **Evidence required** | Config validated (type, range, required). Staging tested with new config. Rollback plan documented. |

### Pattern 16: "The user won't do that"

| Field | Value |
|---|---|
| **Excuse** | "The user won't do that / no one would click that / unrealistic input / can't happen via UI" |
| **Why it's wrong** | Users do everything. APIs are called directly. Network retries cause double-submissions. Race conditions happen. "Can't happen" is the most common prelude to incidents. |
| **Do instead** | Validate at the boundary regardless of UI constraints. Assume direct API calls. Handle race conditions. Defensive programming is not paranoia. |
| **Evidence required** | Input validation at API boundary. Idempotency for mutations. Race condition handling where applicable. |

### Pattern 17: "I tested it manually"

| Field | Value |
|---|---|
| **Excuse** | "I tested it manually / clicked through it / verified in the browser / tried it out" |
| **Why it's wrong** | Manual testing is not reproducible, not comprehensive, and not regression-proof. What you tested manually today will be broken silently next week. |
| **Do instead** | Automated tests for behavior. Manual testing for UX feel only. Every manually-tested path needs an automated regression test. |
| **Evidence required** | Automated test covers the behavior. Manual testing notes are supplementary, not primary evidence. |

### Pattern 18: "It's a hotfix, we don't have time"

| Field | Value |
|---|---|
| **Excuse** | "Hotfix / emergency / production is down / no time for full process" |
| **Why it's wrong** | Hotfixes bypassing verification cause 40% of follow-up incidents. The pressure to ship fast is exactly when quality matters most. |
| **Do instead** | Minimum viable verification: (a) the fix addresses the root cause, (b) no regression in the affected path, (c) rollback plan exists. Full verification within 24h. |
| **Evidence required** | Root cause identified. Fix verified in staging. Rollback plan documented. Full verification scheduled within 24h. |

### Pattern 19: "The AI generated it, so it's correct"

| Field | Value |
|---|---|
| **Excuse** | "The model generated it / AI wrote it / it came from the assistant / looks correct" |
| **Why it's wrong** | AI generates plausible code, not correct code. Hallucinated APIs, wrong assumptions, and subtle bugs are common. AI output is a draft, not a deliverable. |
| **Do instead** | Verify AI output as if written by a junior developer. Check every assumption. Run tests. Review against patterns. Never trust without verification. |
| **Evidence required** | Same as human-written code: tests pass, analyze clean, security scan clean, behavior verified. |

### Pattern 20: "It's not in the acceptance criteria"

| Field | Value |
|---|---|
| **Excuse** | "Not in acceptance criteria / not in the spec / not requested / out of scope" |
| **Why it's wrong** | Acceptance criteria are a minimum, not a maximum. Security, error handling, and basic quality are always in scope. "Not requested" doesn't mean "not needed." |
| **Do instead** | Security, error handling, type safety, and basic testing are ALWAYS in scope. If something is broken or insecure, fix it regardless of acceptance criteria. |
| **Evidence required** | Quality rubric items met regardless of explicit acceptance criteria. |

---

## Enforcement Protocol

### Step 1: Detection
At the end of every skill execution, the agent MUST run the rationalization checklist:
- [ ] Did I skip any verification step? If yes: which one and why?
- [ ] Did I use any phrase from the rationalization table? If yes: which pattern?
- [ ] Do I have evidence for every claim I made?

### Step 2: Counter-Argument
If a rationalization is detected, the agent MUST:
1. Identify the pattern number
2. Read the counter-argument aloud (in the response)
3. Apply the "Do instead" action
4. Produce the required evidence

### Step 3: Evidence Lock
No task can be marked complete without evidence for each step. Evidence types:
- **Test**: test file path + pass output
- **Security**: GuardVibe scan result
- **Performance**: query plan or benchmark
- **UI**: screenshot or visual verification
- **API**: contract test or integration test
- **DB**: migration test or query plan

### Step 4: Verification Loop Integration
This skill integrates with `.opencode/config/verification-loop.yaml`:
- Every T2+ task: anti-rationalization check is mandatory
- Maker/Checker split: the checker explicitly looks for rationalization patterns
- Evidence schema: must include anti-rationalization sign-off

---

## Escalation Path

### Borderline Cases
When an agent believes a step can be skipped for legitimate reasons:

1. **Document the exception**: Write the specific reason with evidence
2. **Risk assessment**: Classify the risk of skipping (R0-R4)
3. **Escalate if R2+**: Any R2+ exception requires Chief approval
4. **Log the decision**: Record in handoff-ledger with rationale

### Exception Template
```
EXCEPTION REQUEST
Pattern: [pattern number and phrase]
Reason: [specific justification]
Risk: [R0-R4]
Mitigation: [what reduces the risk]
Evidence: [what proves it's safe]
Approved by: [Chief / Tech Lead / auto-approved for R0-R1]
```

### Auto-Approved Exceptions (R0-R1 only)
- Pure documentation edits (no code)
- Comment-only changes
- Whitespace/formatting changes (with lint pass)
- Adding `// ponytail:` markers

### Chief Approval Required (R2+)
- Skipping tests for any code change
- Bypassing security scan
- Deploying without staging verification
- Modifying auth/DB/API without full verification

---

## Integration Points

### With verification-loop.yaml
```yaml
anti_rationalization:
  enabled: true
  mandatory_for_tiers: [T2, T3]
  mandatory_for_risks: [R2, R3, R4]
  patterns_file: ".opencode/skills/anti-rationalization/SKILL.md"
  enforcement: BLOCK  # Cannot complete task without sign-off
```

### With handoff-ledger
Every handoff includes:
```json
{
  "anti_rationalization_check": "PASS",
  "patterns_checked": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  "exceptions": [],
  "evidence_summary": "All steps verified with evidence"
}
```

### With elite-quality-gate
The quality gate checks:
- No rationalization patterns detected in agent output
- Evidence present for all claims
- No skipped steps without documented exception

---

## Usage

### Manual Invocation
```
/anti-rationalization
```
Lists all patterns and runs the enforcement checklist on the current task.

### Automatic Invocation
The Chief automatically invokes this skill:
- Before marking any T2+ task complete
- When an agent claims "done" without evidence
- During verification loop (checker phase)
- When a rationalization phrase is detected in agent output

### Integration in Agent Prompts
Add to any skill or agent:
```
Before completing this task, run /anti-rationalization.
If any pattern matches your reasoning, apply the counter-argument and produce evidence.
```
