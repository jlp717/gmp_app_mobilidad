---
name: semantica-integration
description: Semantica graph-native infrastructure for Context Graphs, Decision Intelligence, W3C PROV-O provenance, and deterministic reasoning. Use when recording/querying agent decisions, tracing decision chains, checking policy compliance, exporting audit trails, or finding similar precedents.
---

# Semantica Integration

Semantica provides graph-native context infrastructure for accountable AI. This skill integrates Semantica with OpenCode V4's multi-agent system.

**Config:** `.opencode/config/semantica-config.yaml`
**MCP Server:** `semantica-mcp` (port 3336)
**Storage:** `.semantica/` (Oxigraph RDF + FAISS vectors)

## Prerequisites

```bash
pip install semantica==0.6.0
```

Verify installation:
```python
import semantica
print(semantica.__version__)
```

## Operations

### 1. Initialize Context Graph

```python
from semantica import ContextGraph, ProvenanceManager

graph = ContextGraph(
    storage_path=".semantica/graph",
    backend="oxigraph"
)

prov = ProvenanceManager(
    standard="w3c-prov-o",
    export_formats=["json", "rdf", "csv"]
)

graph.initialize()
prov.attach(graph)
```

### 2. Record Decision with Provenance

```python
from semantica import Decision, Agent

agent = Agent(
    id="chief-engineer-assistant",
    role="orchestrator"
)

decision = Decision(
    category="architecture",
    description="Migrate commissions module to Riverpod",
    confidence=0.85,
    context={
        "task_id": "20260810-120000-gmp-0001",
        "evidence": ["rag-query: 3 similar precedents found"]
    },
    agent=agent
)

recorded = graph.record_decision(decision)
prov.log(
    activity="decision_recorded",
    agent=agent,
    entity=recorded,
    metadata={"confidence": 0.85}
)

print(f"Decision recorded: {recorded.id}")
```

### 3. Query Decision History

```python
from semantica import Query

query = Query("""
    SELECT ?decision ?date ?confidence
    WHERE {
        ?decision a sem:Decision ;
                  sem:category "architecture" ;
                  sem:date ?date ;
                  sem:confidence ?confidence .
    }
    ORDER BY DESC(?date)
    LIMIT 20
""")

results = graph.execute(query)
for r in results:
    print(f"{r['date']}: {r['decision']} (confidence: {r['confidence']})")
```

### 4. Trace Decision Chain

```python
from semantica import Tracer

tracer = Tracer(graph)
chain = tracer.trace(decision_id="dec-20260810-001")

for link in chain.links:
    print(f"{link.activity} -> {link.entity} by {link.agent}")
    if link.metadata:
        print(f"  metadata: {link.metadata}")
```

### 5. Check Policy Compliance

```python
from semantica import PolicyEngine, Policy

engine = PolicyEngine(graph)

policy = Policy(
    name="prod-deploy-requires-approval",
    rule="deployment decisions require production-approval-gate token",
    severity="blocker"
)

engine.register(policy)
violations = engine.check_compliance(decision_id="dec-20260810-001")

for v in violations:
    print(f"VIOLATION: {v.policy.name} - {v.details}")
```

### 6. Export Audit Trail

```python
from semantica import AuditExporter

exporter = AuditExporter(prov)
exporter.export(
    start_date="2026-08-01",
    end_date="2026-08-10",
    format="json",
    output_path=".semantica/audit/trail-2026-08.json"
)

# Also export RDF for W3C PROV-O compliance
exporter.export(
    start_date="2026-08-01",
    end_date="2026-08-10",
    format="rdf",
    output_path=".semantica/audit/trail-2026-08.rdf"
)
```

### 7. Find Similar Precedents

```python
from semantica import SimilaritySearch

searcher = SimilaritySearch(
    graph=graph,
    vector_backend="faiss",
    threshold=0.7
)

precedents = searcher.find_similar(
    query="migrate module state management",
    category="architecture",
    top_k=5
)

for p in precedents:
    print(f"{p.score:.2f}: {p.decision.description}")
    print(f"  Outcome: {p.decision.outcome}")
```

## MCP Integration

When `semantica-mcp` is running (port 3336), OpenCode agents can call Semantica via MCP tools:

```
Tool: semantica/record_decision
Tool: semantica/query_decisions
Tool: semantica/trace_chain
Tool: semantica/check_compliance
Tool: semantica/export_audit
Tool: semantica/find_precedents
```

### Start MCP Server

```bash
python -m semantica.mcp --port 3336 --config .opencode/config/semantica-config.yaml
```

## Audit Trail Workflow

1. Agent makes decision → `record_decision()` called automatically via hook
2. Provenance logged → W3C PROV-O compliant chain
3. Policy engine checks → violations flagged before execution
4. Periodic export → `.semantica/audit/` with retention policy
5. Query anytime → full decision history with evidence

## Retention

- Retention: 365 days (configurable in semantica-config.yaml)
- Auto-cleanup: `graph.cleanup_expired(retention_days=365)`
- Audit exports: archived by month in `.semantica/audit/`

## ⚠️ API Verification Note

The Semantica Python API shown above is based on the described functionality in semantica-config.yaml. Before production use, verify against actual package documentation:

```bash
python -c "import semantica; help(semantica.ContextGraph)"
```

Adjust method signatures as needed to match the installed version.
