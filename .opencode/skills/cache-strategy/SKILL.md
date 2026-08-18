---
name: cache-strategy
description: Reference checklist for cache strategy workflows in the OpenCode team.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  converted_from: cache-strategy.md
---

# Cache Strategy Skill

## Purpose
Guide agents in implementing effective caching strategies across all layers of the stack — HTTP, application, database, and CDN.

## When to Use
- User mentions cache, Redis, CDN, performance optimization, slow queries
- Response times exceed acceptable thresholds
- Database load is high due to repeated identical queries
- Need to implement offline support or stale content serving

## Key Patterns

### 1. Cache-Aside (Lazy Loading)
- Check cache ? hit ? return
- Miss ? query source ? store ? return
- Best for: read-heavy workloads, unpredictable access patterns

### 2. Write-Through
- Write to cache AND source simultaneously
- Cache always fresh
- Best for: data consistency critical, write latency acceptable

### 3. Write-Behind (Write-Back)
- Write to cache first, async flush to source
- Best for: write-heavy workloads, eventual consistency OK

### 4. Stale-While-Revalidate
- Serve stale content while fetching fresh in background
- HTTP: Cache-Control: public, max-age=3600, stale-while-revalidate=60
- Best for: content that tolerates brief staleness

### 5. Cache Stampede Prevention
- Mutex/lock on cache miss (only one request fetches)
- Probabilistic early expiration (randomize TTL)
- Background refresh before expiration

## Rules
1. ALWAYS define TTL based on data volatility
2. ALWAYS have invalidation strategy before caching
3. NEVER cache sensitive data without encryption
4. NEVER use cache as primary data source
5. ALWAYS monitor hit ratio and evictions
6. ALWAYS implement cache warming for critical paths

## Anti-Patrons
- Cache without TTL ? stale data forever
- Cache without invalidation ? inconsistency
- Cache everything ? memory exhaustion
- No hit ratio monitoring ? blind cache
- Cache as single source of truth ? data loss risk

## Implementation Checklist
- [ ] TTL defined per cache key pattern
- [ ] Invalidation strategy documented
- [ ] Cache stampede prevention implemented
- [ ] Hit ratio monitoring in place
- [ ] Memory limits configured
- [ ] Fallback on cache miss verified

