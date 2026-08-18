---
name: security-audit
description: OWASP Top 10 security audit. READ ONLY — never modifies code. Reports vulnerabilities with location, CVSS severity, and remediation.
---

# Security Audit — OWASP Top 10 Guide

## Overview

This is a **READ ONLY** skill. The security auditor reads, analyzes, and reports. It never modifies, refactors, or "fixes" code. All findings are documented in a structured format: Vulnerability → Location → CVSS Severity → Remediation. Modifications are made by the developer in a separate session after review.

## When to Use

- Before any production deployment or major release
- When integrating a new third-party dependency or service
- After a security incident to assess blast radius
- During code review of authentication, authorization, or data handling code

## When NOT to Use

- As a substitute for a professional penetration test on high-value targets
- On code you are actively implementing — audit after the feature is complete

---

## OWASP Top 10 — Audit Checklist

### A01 — Broken Access Control

**What to look for:**
- Routes missing authentication middleware
- Authorization checks based on user-supplied data without server-side verification (IDOR)
- Horizontal privilege escalation: user A accessing user B's resources
- Missing `role` checks on admin endpoints
- Direct object references in URLs (`/api/invoices/1234`) without ownership check

**Audit pattern:**
```
For every route: does it verify (1) authenticated? (2) authorized for this specific resource?
Search for: findById(req.params.id) without WHERE userId = req.user.id
```

**Report format:**
```
VULNERABILITY: IDOR on invoice endpoint
LOCATION: routes/invoices.ts:47 — GET /api/invoices/:id
CVSS: 8.1 HIGH
REMEDIATION: Add WHERE clause: db.invoice.findFirst({ where: { id, userId: req.user.id } })
              Return 404 (not 403) when record belongs to another user
```

---

### A02 — Cryptographic Failures

**What to look for:**
- Hardcoded secrets, API keys, or passwords in source code or `.env` committed to git
- Weak hashing algorithms: MD5, SHA-1 for passwords (must be bcrypt/argon2/scrypt)
- Sensitive data stored or logged in plaintext (passwords, credit cards, SSNs, tokens)
- HTTP (not HTTPS) used for any data transmission
- JWT with weak secret (< 256 bits) or `alg: none`
- Unencrypted PII in database columns

**Audit pattern:**
```bash
# Search for hardcoded secrets
grep -rn "password\s*=" src/ --include="*.ts"
grep -rn "apiKey\s*=" src/ --include="*.ts"
grep -rn "secret\s*=" src/ --include="*.ts"
# Check git history for accidental commits
git log --all --full-history -- "*.env"
```

---

### A03 — Injection

**What to look for:**
- String concatenation in SQL queries (SQL injection)
- Dynamic `$where` or `$expr` in MongoDB queries from user input (NoSQL injection)
- `child_process.exec()` with user-supplied strings (command injection)
- Unescaped user content rendered as HTML (XSS — stored or reflected)
- LDAP injection, XPath injection in enterprise environments

**Vulnerable patterns:**
```ts
// SQL injection — VULNERABLE
db.query(`SELECT * FROM users WHERE email = '${req.body.email}'`);

// Command injection — VULNERABLE
exec(`convert ${req.query.filename} output.png`);

// NoSQL injection — VULNERABLE (if attacker sends {$gt: ""})
User.findOne({ email: req.body.email });
```

**Safe alternatives:**
```ts
// Parameterized query — SAFE
db.query('SELECT * FROM users WHERE email = $1', [req.body.email]);

// Validated input — SAFE
const filename = path.basename(req.query.filename as string); // strips path traversal
execFile('convert', [filename, 'output.png']); // array args, no shell interpolation
```

---

### A04 — Insecure Design

**What to look for:**
- No rate limiting on authentication endpoints (brute force vulnerability)
- No input validation before business logic (missing schema validation)
- Enumerable user IDs (sequential integers allow scraping)
- Missing anti-automation on registration/password reset
- Business logic that can be manipulated by replaying or reordering requests

**Report format:**
```
VULNERABILITY: No rate limiting on POST /auth/login
LOCATION: routes/auth.ts:12
CVSS: 7.5 HIGH
REMEDIATION: Apply express-rate-limit: max 5 attempts per IP per 15 minutes
              Add exponential backoff. Consider CAPTCHA after 3 failures.
```

---

### A05 — Security Misconfiguration

**What to look for:**
- `CORS origin: '*'` with `credentials: true` (impossible combination, but also just wildcard CORS)
- Debug endpoints exposed in production (`/debug`, `/__admin`, `/actuator`)
- Default credentials unchanged (admin/admin, postgres/postgres)
- Verbose error messages exposing stack traces, file paths, or SQL
- Missing security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`
- Directory listing enabled on static file servers

**Audit commands:**
```bash
curl -I https://api.example.com/health
# Check for: X-Powered-By (should be removed), Server header, missing security headers
```

---

### A06 — Vulnerable and Outdated Components

**What to look for:**
- Dependencies with known CVEs in `npm audit` or `yarn audit` output
- Unpinned dependency versions allowing unexpected upgrades
- End-of-life runtime versions (Node.js 16, Python 3.8)
- Transitive dependencies with high-severity CVEs

```bash
npm audit --audit-level=high
npx snyk test
```

**Report format:**
```
VULNERABILITY: lodash < 4.17.21 — Prototype pollution (CVE-2021-23337)
LOCATION: package.json (transitive via some-library)
CVSS: 7.2 HIGH
REMEDIATION: Upgrade some-library to version >= 2.1.0 which uses lodash 4.17.21+
```

---

### A07 — Authentication Failures

**What to look for:**
- Passwords stored without bcrypt/argon2 (or with MD5/SHA1)
- No account lockout or rate limiting on login
- JWT `algorithm: none` accepted
- Short-lived session tokens not invalidated on logout
- Password reset tokens that don't expire or can be reused
- Missing MFA on privileged accounts

```ts
// Check JWT verification for algorithm enforcement
jwt.verify(token, secret); // VULNERABLE — doesn't restrict algorithm
jwt.verify(token, secret, { algorithms: ['RS256'] }); // SAFE
```

---

### A08 — Software and Data Integrity Failures

**What to look for:**
- Deserializing untrusted data without validation (e.g., JSON with `__proto__` pollution)
- Using unsigned or unverified packages (`npm install` from untrusted registries)
- CI/CD pipeline that executes code from PRs without sandboxing
- Auto-update mechanisms that don't verify signatures

---

### A09 — Security Logging and Monitoring Failures

**What to look for:**
- No audit log for authentication events (login, logout, failed attempts)
- No logging of authorization failures (403s)
- Sensitive data (passwords, tokens, PII) written to logs
- Logs not persisted or rotated (lost on container restart)
- No alerting on repeated authentication failures

**Report format:**
```
VULNERABILITY: Passwords logged on failed login
LOCATION: services/auth.ts:88 — logger.error(`Login failed for ${email}:${password}`)
CVSS: 6.5 MEDIUM
REMEDIATION: Never log passwords or tokens. Log only: userId, timestamp, IP, action.
```

---

### A10 — Server-Side Request Forgery (SSRF)

**What to look for:**
- `fetch()`, `axios.get()`, or `http.request()` with a URL from user input
- Webhooks or import-by-URL features without URL validation
- Cloud metadata endpoint accessible (`http://169.254.169.254/`)
- Missing allowlist of permitted target domains/IP ranges

```ts
// VULNERABLE — attacker can send http://169.254.169.254/latest/meta-data/
const data = await fetch(req.body.webhookUrl);

// SAFE — validate against allowlist before fetching
const ALLOWED_DOMAINS = new Set(['api.trusted.com', 'webhook.partner.com']);
const url = new URL(req.body.webhookUrl);
if (!ALLOWED_DOMAINS.has(url.hostname)) throw new AppError('SSRF_BLOCKED', 'URL not allowed', 400);
```

---

## Output Format Template

```
=== SECURITY AUDIT REPORT ===
Date: YYYY-MM-DD
Auditor: @security-sentinel
Scope: [repository/service name]

FINDING #N
----------
Vulnerability : [OWASP category + name]
Location      : [file:line — endpoint or function]
CVSS Score    : [0.0–10.0] [CRITICAL/HIGH/MEDIUM/LOW]
Description   : [What the vulnerability is and why it's exploitable]
Evidence      : [Code snippet or curl command demonstrating the issue]
Remediation   : [Specific fix with code example]
References    : [CVE ID or OWASP link if applicable]
```

---

## Verification Checklist (Audit Completeness)

- [ ] All authenticated routes verified for missing `authenticate` middleware
- [ ] All resource-fetching routes verified for ownership/authorization check (IDOR)
- [ ] No string-concatenated SQL queries in codebase
- [ ] No hardcoded secrets found in source (`.env.example` is acceptable)
- [ ] `npm audit` run; no HIGH or CRITICAL unaddressed CVEs
- [ ] CORS configuration uses explicit origin allowlist
- [ ] JWT `verify()` calls include explicit `algorithms` array
- [ ] No stack traces in production error responses
- [ ] All `fetch`/`axios` calls with user-supplied URLs validated against allowlist
- [ ] Audit log exists for: login, logout, failed auth, permission denied
- [ ] Security headers present: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`
- [ ] **No code was modified during this audit** — all findings reported only
