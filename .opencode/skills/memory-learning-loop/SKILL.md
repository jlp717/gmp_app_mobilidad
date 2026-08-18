---
name: memory-learning-loop
description: Persist lessons, corrections, glossary terms, session summaries, and RLHF-style feedback so the team improves across sessions.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  memory: chromadb-jsonl
---

## When To Use

Use this at the start and end of every non-trivial task, and whenever Javier corrects an assumption.

## Start Of Task

1. Read project memory files under `.opencode/memory/` when relevant.
2. Read `.opencode/rules.json`.
3. Read `.opencode/probe-results.json`.
4. Query ChromaDB when available; fall back to keyword search.
5. Add only relevant memory to the handoff.

## Correction Capture

When Javier says "no", "eso esta mal", "cuando digo X me refiero a Y", or corrects a table/IP/file:

1. Classify the error: `nombre_incorrecto`, `logica_incorrecta`, `ip_incorrecta`, `convencion_desconocida`, `jerga_nueva`, `alucinacion`.
2. Append to `corrections.jsonl`.
3. Add glossary entry if it is recurring project language.
4. Add a prompt-improvement proposal if the same class repeats.

## End Of Task

Write a compact session record with:

- task description
- files modified
- DB tables touched
- agents used
- models used
- errors and resolution
- lessons learned
- tests run
- RLHF signal

If ChromaDB is unavailable, store JSONL/MD only and mark semantic memory degraded.
