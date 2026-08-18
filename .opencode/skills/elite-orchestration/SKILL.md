---
name: elite-orchestration
description: Run GMP or Granja work as a senior multi-agent software team with state, delegation, debate, verification, and evidence gates.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
---

## Purpose

Use this skill whenever the request is complex, multi-file, DB/API/auth/deploy related, or Javier expresses doubt about agent coordination.

## Required Flow

1. Create or read the task StateGraph before acting.
2. Load memory through Context-Manager.
3. Ask Repo-Explorer to verify real files and entities before specialists plan or edit.
4. Classify the work:
   - Tier 1: one safe file, no DB/API/auth/deploy.
   - Tier 2: bounded multi-file or DB/API touched.
   - Tier 3: cross-module, migration, deploy, or production risk.
5. For Tier 2/3, use Architect-Planner before implementation.
6. Delegate implementation only to specialists. Orchestrators do not edit code.
7. Require Check-Reviewer and Simplify-Reviewer for DB/API/auth/UI-complex changes.
8. Deliver only after tests or an explicit "could not run" reason with evidence.

## Handoff Contract

Every subagent handoff must include:

```json
{
  "task_id": "string",
  "context": {
    "project": "gmp|granja",
    "tier": 1,
    "memory_context": "string",
    "files_to_read_first": [],
    "files_to_modify": [],
    "entities_to_verify": []
  },
  "instructions": "bounded task",
  "expected_output": {
    "format": "{status, output, files_modified, errors, warnings, requires_followup, followup_details}",
    "done_criteria": "verifiable condition"
  },
  "constraints": []
}
```

## Stop Conditions

Stop and report instead of guessing when:

- A file, table, column, endpoint, or command cannot be verified.
- A specialist returns malformed output.
- The same error repeats three times.
- A deployment or DB migration is requested without explicit approval.
