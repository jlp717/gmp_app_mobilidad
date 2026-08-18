---
name: performance-profiling
description: Performance profiling — Lighthouse CLI, React Profiler, SQL EXPLAIN ANALYZE, Flutter DevTools, Node.js clinic.js.
---

# Performance Profiling — Professional Guide

## Overview

Performance problems are measured, not guessed. This guide provides a systematic approach to profiling web apps, React components, databases, Flutter UIs, and Node.js servers using the right tool for each layer.

## When to Use

- Before and after any optimization to measure real impact
- When LCP > 2.5s, CLS > 0.1, or INP > 200ms in field data
- When React renders feel sluggish or cause visible jank
- When a database query takes > 100ms
- When Flutter reports frames > 16ms in release mode

## When NOT to Use

- Do not optimize before profiling — measure first, fix second
- Do not use Lighthouse on localhost for final scores — use a staging/production URL or throttled environment
- Do not fix one metric at the expense of another without re-measuring all

---

## Step-by-Step Process

### 1. Lighthouse — Web Performance Audit

**Install and run headless:**

```bash
npm install -g lighthouse
lighthouse https://your-app.com \
  --output=html \
  --output-path=./lighthouse-report.html \
  --chrome-flags="--headless" \
  --throttling-method=simulate \
  --preset=desktop
```

**Key metrics and thresholds:**

| Metric | Good | Needs Work | Poor |
|---|---|---|---|
| FCP (First Contentful Paint) | < 1.8s | 1.8–3s | > 3s |
| LCP (Largest Contentful Paint) | < 2.5s | 2.5–4s | > 4s |
| TBT (Total Blocking Time) | < 200ms | 200–600ms | > 600ms |
| CLS (Cumulative Layout Shift) | < 0.1 | 0.1–0.25 | > 0.25 |
| INP (Interaction to Next Paint) | < 200ms | 200–500ms | > 500ms |

**Common fixes:**

```tsx
// LCP fix: preload hero image with next/image
import Image from 'next/image';
<Image src="/hero.jpg" alt="Hero" width={1200} height={600} priority />
// priority adds <link rel="preload"> automatically

// CLS fix: always declare explicit dimensions on images/embeds
<Image src="/avatar.png" alt="Avatar" width={48} height={48} />

// TBT fix: defer non-critical third-party scripts
<Script src="https://analytics.example.com/script.js" strategy="lazyOnload" />
```

### 2. React Profiler — Identify Wasted Renders

**Enable in Chrome DevTools**: React DevTools → Profiler tab → Record.

**Reading the flamegraph:**
- Gray bars = component did not re-render (good)
- Yellow/orange bars = component re-rendered, took significant time
- Sort by "Render duration" to find the most expensive components

**Fixing wasted renders:**

```tsx
// Problem: parent re-render causes ExpensiveChild to re-render even when props unchanged
function ParentComponent({ user, count }: Props) {
  return (
    <>
      <ExpensiveChild data={user.profile} />  {/* re-renders every time count changes */}
      <Counter value={count} />
    </>
  );
}

// Fix 1: React.memo — skips re-render if props are shallowly equal
const ExpensiveChild = React.memo(function ExpensiveChild({ data }: { data: Profile }) {
  return <ProfileCard data={data} />;
});

// Fix 2: useCallback — stable function reference for event handlers
function ParentComponent({ onSave }: Props) {
  const handleSave = useCallback((id: string) => {
    onSave(id);
  }, [onSave]); // only recreated when onSave changes

  return <ExpensiveChild onSave={handleSave} />;
}

// Fix 3: useMemo — expensive derived data
function ReportPage({ transactions }: Props) {
  const totals = useMemo(
    () => transactions.reduce((acc, t) => acc + t.amount, 0),
    [transactions]
  );
  return <SummaryCard total={totals} />;
}
```

### 3. SQL EXPLAIN ANALYZE — PostgreSQL Query Optimization

Always use `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` on slow queries:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.id, u.email, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id;
```

**Reading the plan — warning signs:**

| Node type | What it means | Action |
|---|---|---|
| `Seq Scan` on large table | Full table scan | Add an index on the filter column |
| `Hash Join` with large `rows` estimate | Missing FK index | Index the foreign key column |
| `Sort` with high cost | No index for ORDER BY | Add index on sort column |
| Rows estimated << actual | Stale statistics | Run `ANALYZE table_name` |

**Adding indexes:**

```sql
-- Single column index for WHERE clause filter
CREATE INDEX CONCURRENTLY idx_users_created_at ON users (created_at);

-- Composite index for filter + sort
CREATE INDEX CONCURRENTLY idx_orders_user_created ON orders (user_id, created_at DESC);

-- Partial index for hot subset of data
CREATE INDEX CONCURRENTLY idx_orders_pending ON orders (created_at) WHERE status = 'pending';

-- CONCURRENTLY avoids locking the table during index build (production safe)
```

### 4. Flutter DevTools — Identify Frame Jank

```bash
# Run app in profile mode (not debug — debug has extra overhead)
flutter run --profile

# Open DevTools
flutter pub global activate devtools
flutter pub global run devtools
```

**Reading the Timeline:**
- Green frames < 16ms = 60 FPS (good)
- Yellow frames 16–32ms = dropped to 30 FPS (warning)
- Red frames > 32ms = severe jank

**Common Flutter fixes:**

```dart
// Problem: rebuilding expensive subtree on every parent setState
class ExpensiveList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: 1000,
      itemBuilder: (_, i) => ExpensiveItem(index: i), // rebuilds all on parent change
    );
  }
}

// Fix: RepaintBoundary — isolates subtree from parent repaints
RepaintBoundary(
  child: ExpensiveChart(data: data),
)

// Fix: const constructors — compile-time constant widgets skip rebuild entirely
const SizedBox(height: 16)
const Icon(Icons.check, color: Colors.green)

// Fix: Use ListView.builder (lazy) not ListView(children: [...]) (eager)
ListView.builder(
  itemCount: items.length,
  itemBuilder: (context, index) => ItemTile(item: items[index]),
)
```

### 5. Node.js — Heap Snapshots and Event Loop Lag

```bash
npm install -g clinic
clinic doctor -- node server.js   # Detects event loop lag, CPU, memory issues
clinic flame -- node server.js    # Flamegraph for CPU profiling
clinic bubbleprof -- node server.js  # Async operation profiling
```

**Measure event loop lag:**

```ts
import { monitorEventLoopDelay } from 'perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

setInterval(() => {
  const lagMs = histogram.mean / 1e6; // nanoseconds to milliseconds
  if (lagMs > 10) {
    // Log warning: event loop is blocked
    logger.warn({ eventLoopLagMs: lagMs }, 'High event loop lag detected');
  }
  histogram.reset();
}, 5000);
```

**Heap snapshot for memory leaks:**

```ts
import v8 from 'v8';
import { writeFileSync } from 'fs';

// Take snapshot before and after suspected leak
// Load both in Chrome DevTools → Memory → Load snapshot
writeFileSync('/tmp/heap-before.heapsnapshot', v8.writeHeapSnapshot());
```

---

## Verification Checklist

- [ ] Lighthouse run against deployed URL (not localhost) with CPU throttling enabled
- [ ] LCP < 2.5s; TBT < 200ms; CLS < 0.1; INP < 200ms
- [ ] Hero/LCP image has `priority` prop (next/image) or `<link rel="preload">`
- [ ] All images have explicit `width` and `height` to prevent CLS
- [ ] React Profiler flamegraph recorded; no component re-renders more than necessary
- [ ] `React.memo` applied only where profiler shows a real benefit (not preemptively)
- [ ] Slow SQL queries identified with `EXPLAIN ANALYZE`; no `Seq Scan` on large tables
- [ ] Indexes created with `CONCURRENTLY` in production
- [ ] Flutter profiled in `--profile` mode (not `--debug`)
- [ ] No red frames (> 32ms) in Flutter Timeline view
- [ ] `RepaintBoundary` wraps expensive, independently-updating subtrees
- [ ] Node.js event loop lag measured and < 10ms under normal load
