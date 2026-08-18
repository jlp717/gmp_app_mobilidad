---
name: qa-checklist
description: Pre-deploy QA checklist — tests, Lighthouse, seguridad, rendimiento y criterios de salida.
---

## Overview

This checklist is the gate between development and production. Every item must be green before a deploy is approved. No exceptions without a documented, time-bounded risk acceptance from the tech lead.

---

## When to Use

- Before every production deployment
- Before merging a release branch or cutting a release tag
- When a hotfix bypasses the normal sprint QA cycle

## When NOT to Use

- As a substitute for proper testing during development — run these checks continuously, not only at deploy time
- For deploy of infrastructure-only changes with no application code change (use a shorter infra checklist)

---

## Step-by-Step Process

### 1. Automated Tests

```bash
# Run full test suite with coverage
pnpm test --coverage

# Confirm thresholds (vitest.config.ts or jest.config.ts)
# coverage: { lines: 80, functions: 80, branches: 70 }
```

- [ ] All **unit tests** pass (`pnpm test`)
- [ ] All **integration tests** pass (DB, API contracts)
- [ ] All **E2E critical paths** pass (Playwright/Cypress — login, checkout, main CRUD flow)
- [ ] Coverage thresholds met — no regressions below configured minimums

### 2. Build Quality

```bash
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint with --max-warnings 0
pnpm build            # production build must succeed cleanly
```

- [ ] Zero TypeScript errors (`tsc --noEmit`)
- [ ] Zero lint errors (`eslint --max-warnings 0`)
- [ ] Production build succeeds without warnings
- [ ] Bundle size within budget (set in `next.config.ts` or `bundlesize` config)

```js
// next.config.ts — fail build if bundle exceeds budget
experimental: {
  bundlePagesRouterDependencies: true,
},
// Or use bundlesize: "main-*.js": "< 250 kB gzip"
```

### 3. Lighthouse Audit

```bash
npx lighthouse https://staging.example.com \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json --output-path=./lighthouse.json
```

Minimum scores required:

| Category | Minimum |
|----------|---------|
| Performance | ≥ 90 |
| Accessibility | ≥ 90 |
| Best Practices | ≥ 90 |
| SEO | ≥ 90 |

- [ ] Performance ≥ 90 on mobile preset
- [ ] Accessibility ≥ 90 (supplement with axe-core)
- [ ] Best Practices ≥ 90
- [ ] SEO ≥ 90

### 4. Security Checks

```bash
# Secret scanning
git secrets --scan
# or
trufflehog git file://. --only-verified

# Dependency vulnerabilities
npm audit --audit-level=high
# Flutter
flutter pub outdated
flutter pub deps | grep "SECURITY"

# OWASP basic — check security headers
curl -I https://staging.example.com | grep -i "content-security-policy\|x-frame-options\|strict-transport"
```

- [ ] No hardcoded secrets in any committed file (`git secrets --scan` clean)
- [ ] `npm audit` reports zero high/critical vulnerabilities (or all have documented overrides)
- [ ] `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security` headers present
- [ ] Environment variables are NOT logged or exposed in client bundles

### 5. Functionality Smoke Tests

Manual verification on staging environment:

- [ ] Critical user journey 1: **Registration / Login / Logout** works end-to-end
- [ ] Critical user journey 2: **Core feature** (define per project) works correctly
- [ ] Critical user journey 3: **Payment / Checkout** (if applicable) succeeds with test card
- [ ] 404 and 500 error pages render correctly with friendly message and retry action
- [ ] Mobile viewport (375px) tested on real device or BrowserStack
- [ ] Chrome, Firefox, Safari — no layout breaks or JS errors in console
- [ ] All external integrations (email, webhooks, third-party APIs) confirmed working on staging

### 6. Performance

```bash
# Check for N+1 queries — enable query logging on staging
# PostgreSQL: log_min_duration_statement = 0

# API response time check
for i in {1..10}; do curl -o /dev/null -s -w "%{time_total}\n" https://staging.example.com/api/health; done
```

- [ ] No N+1 database queries detected on main pages (verified via query logs)
- [ ] API p95 response time < 200ms for read endpoints, < 500ms for write endpoints
- [ ] No memory leak — application memory stable after 100 requests (check with `clinic.js` or Datadog)
- [ ] Images are optimized and served in next-gen formats (WebP/AVIF)

### 7. Rollback Plan

- [ ] Deployment rollback procedure documented and tested (`fly deploy --strategy rolling`, Vercel instant rollback, or `kubectl rollout undo`)
- [ ] All database migrations are reversible (down migration tested on staging)
- [ ] Feature flags can disable the new feature without a deploy
- [ ] On-call engineer notified of deploy window and rollback owner assigned

---

## Exit Criteria

**ALL checkboxes must be green.** If any item fails:

1. Block the deploy
2. File an issue with severity label
3. Fix and re-run the full checklist from the beginning — do not re-run only the failing section

Any exception requires written approval from the tech lead in the deploy PR, with a documented remediation deadline no longer than 24 hours post-deploy.
