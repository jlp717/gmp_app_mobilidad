---
name: dependency-management
description: Gestión de dependencias — auditorías de seguridad, actualizaciones seguras, licencias y limpieza de deps no utilizadas.
---

## Overview

Dependencies are the largest attack surface in modern applications. This skill covers the full lifecycle: auditing for vulnerabilities, updating safely, enforcing license compliance, removing unused packages, and maintaining lockfile hygiene. The goal is a lean, secure, well-understood dependency graph.

---

## When to Use

- Weekly dependency maintenance sprint task
- Before any production release
- After a security advisory is published for a package you use
- When onboarding a new project to understand its risk profile

## When NOT to Use

- As a substitute for writing your own tests after updating — always run the full test suite
- To mass-update all dependencies at once — update incrementally (patch → minor → major)

---

## Step-by-Step Process

### 1. Security Audit

```bash
# npm / pnpm
npm audit --audit-level=moderate
pnpm audit --audit-level=moderate

# yarn
yarn audit

# Output JSON for CI
npm audit --json | jq '.metadata.vulnerabilities'
```

**Interpreting CVSS scores:**

| CVSS | Severity | Action |
|------|----------|--------|
| 9.0–10.0 | Critical | Block deploy, fix immediately |
| 7.0–8.9 | High | Fix within 24 hours |
| 4.0–6.9 | Moderate | Fix within sprint |
| 0.1–3.9 | Low | Fix at next maintenance window |

**Overriding unfixable vulnerabilities (last resort):**
```json
// package.json
{
  "overrides": {
    "vulnerable-transitive-dep": "^2.1.0"
  }
}
```

Document every override with the CVE number and a review date comment.

### 2. Updating Dependencies

```bash
# See what's outdated
npm outdated
npx npm-check-updates   # shows all, including major

# ncu config — interactive update
npx npm-check-updates --interactive --format group
```

**Safe update strategy:**
1. **Patch** (`1.2.3 → 1.2.4`): Apply automatically in CI with Dependabot/Renovate
2. **Minor** (`1.2.x → 1.3.0`): Update + run full test suite, review changelog
3. **Major** (`1.x → 2.0.0`): Manual — read migration guide, update usage, full regression test

```bash
# Update only patch versions safely
npm update  # respects semver ranges in package.json

# Update a specific package to latest
npm install react@latest react-dom@latest
```

**`.ncurc.json` config:**
```json
{
  "target": "minor",
  "reject": ["react", "react-dom", "next"],
  "upgrade": true
}
```

Reject major framework versions from automated updates — update these manually with proper testing.

### 3. Lockfile Hygiene

```bash
# Regenerate after resolving merge conflicts
rm pnpm-lock.yaml
pnpm install

# Verify lockfile is consistent (CI check)
pnpm install --frozen-lockfile
# npm ci equivalent — fails if lockfile is out of sync
```

**Rules:**
- Always commit `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`
- Never hand-edit a lockfile
- Use `npm ci` (not `npm install`) in CI — it enforces the lockfile
- If two branches modify `package.json`, resolve the conflict in `package.json` then regenerate the lockfile — do not manually merge lockfile changes

### 4. License Compliance

```bash
npm install -D license-checker
npx license-checker --summary
npx license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-3.0" --excludePrivatePackages
```

**License risk matrix:**

| License | Commercial use | Risk |
|---------|---------------|------|
| MIT, BSD-2, BSD-3, ISC | ✅ Safe | None |
| Apache-2.0 | ✅ Safe | Patent clause — fine |
| MPL-2.0 | ⚠️ Copyleft (file-level) | Review |
| GPL-2.0 / GPL-3.0 | ❌ Copyleft (project-level) | Block |
| AGPL-3.0 | ❌ Network copyleft | Block |
| UNLICENSED | ❌ No rights granted | Block |

**CI license check:**
```yaml
# .github/workflows/license-check.yml
- name: Check licenses
  run: |
    npx license-checker \
      --failOn "GPL-2.0;GPL-3.0;AGPL-3.0;UNLICENSED" \
      --excludePrivatePackages \
      --production
```

### 5. Remove Unused Dependencies

```bash
npm install -D depcheck
npx depcheck

# Output example:
# Unused dependencies
# * lodash
# * moment
# Missing dependencies (used but not declared)
# * date-fns
```

```bash
npm uninstall lodash moment
npm install date-fns
```

Also check bundle size impact before adding a new dependency:
```bash
npx bundlephobia <package-name>
# or check https://bundlephobia.com
```

Rule of thumb: if a dependency adds > 10 kB gzip to the client bundle, evaluate if it can be replaced with a smaller alternative or native browser API.

### 6. Private Registry Configuration

```ini
# .npmrc — scoped package from private registry
@mycompany:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}

# Fallback to public registry for everything else
registry=https://registry.npmjs.org
```

Never commit tokens to `.npmrc`. Use environment variables and CI secrets.

### 7. Flutter / Dart

```bash
# Check outdated packages
flutter pub outdated

# Upgrade to latest compatible versions
flutter pub upgrade

# Upgrade breaking changes (major)
flutter pub upgrade --major-versions

# Check for security advisories
dart pub audit
```

**`dependency_overrides` — use only for patching transitive deps temporarily:**
```yaml
# pubspec.yaml
dependency_overrides:
  # Temporary: remove after pkg_name releases v2.1.1 with the fix
  # CVE-2024-XXXXX — remove by 2026-06-01
  pkg_name: ^2.1.0
```

### 8. Automation with Renovate / Dependabot

```json
// renovate.json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:base"],
  "packageRules": [
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true
    },
    {
      "matchDepNames": ["react", "react-dom", "next"],
      "enabled": false
    }
  ],
  "schedule": ["every weekend"]
}
```

---

## Verification Checklist

- [ ] `npm audit` (or `pnpm audit`) shows zero High/Critical vulnerabilities
- [ ] All audit overrides have a CVE reference and review date comment
- [ ] `npm ci --frozen-lockfile` passes in CI — lockfile matches `package.json`
- [ ] Lockfile is committed and has no manual edits
- [ ] `license-checker --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"` passes
- [ ] `depcheck` shows zero unused production dependencies
- [ ] No dependency adds > 10 kB gzip without deliberate review
- [ ] Private registry tokens are in env vars, not in committed `.npmrc`
- [ ] Renovate or Dependabot configured for automated patch updates
- [ ] Major version updates documented in CHANGELOG with migration notes
