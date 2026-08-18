---
name: webhook-patterns
description: Reference checklist for webhook patterns workflows in the OpenCode team.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  converted_from: webhook-patterns.md
---

# Webhook Patterns Skill

## Purpose
Guide agents in implementing reliable webhook delivery, consumption, and management systems.

## When to Use
- User mentions webhooks, event delivery, third-party integrations
- Need to implement event-driven architecture
- Building payment integrations (Stripe, PayPal)
- Need reliable async communication between services

## Key Patterns

### 1. Delivery with Exponential Backoff
- retry_delay = min(base_delay * 2^attempt, max_delay) + random(0, jitter)
- base_delay: 1s, max_delay: 1h, jitter: 0-1s
- Max retries: 10-15 before dead letter queue

### 2. Idempotency
- Every webhook has unique ID (X-Webhook-Idempotency-Key)
- Receiver checks if ID already processed ? skip duplicate
- Store processed IDs with TTL (24-48 hours)

### 3. HMAC Signature Verification
- signature = HMAC-SHA256(payload + timestamp, secret)
- Compare with constant-time comparison
- Reject if timestamp > 5 minutes old (replay prevention)

### 4. Dead Letter Queue
- After N failed attempts ? move to DLQ
- DLQ events: manual review, alert, or auto-retry with different strategy
- Monitor DLQ size and age

### 5. Event Versioning
- Include version in event payload: { "version": "v1", "type": "order.created", ... }
- Additive changes only within same version
- New version for breaking changes

## Rules
1. ALWAYS implement idempotency for webhook receivers
2. ALWAYS verify HMAC signatures
3. ALWAYS use exponential backoff with jitter for retries
4. ALWAYS implement dead letter queue
5. NEVER block main thread with webhook delivery
6. ALWAYS log delivery attempts with timestamps and status codes

## Anti-Patterns
- Webhooks without idempotency ? duplicate processing
- Retries without limit ? infinite loop
- No signature verification ? spoofing attacks
- Sync delivery ? blocks main thread
- No monitoring ? silent failures
- Events without version ? breaking changes

## Implementation Checklist
- [ ] Idempotency key handling implemented
- [ ] HMAC signature verification in place
- [ ] Retry strategy with backoff + jitter
- [ ] Dead letter queue configured
- [ ] Event schema versioned
- [ ] Delivery logging enabled
- [ ] Alerting on delivery failures

