---
name: git-commit-discipline
description: Conventional Commits, commits atómicos, hooks con Husky + lint-staged y commitlint.
---

## Overview

Git history is team documentation. A well-disciplined history makes bisecting bugs, generating changelogs, and reviewing PRs dramatically faster. This skill enforces Conventional Commits, atomic commit hygiene, pre-commit automation, and branch naming standards.

---

## When to Use

- Setting up a new repository's commit standards
- Onboarding a team member to the project's git conventions
- When a PR has messy commits that need to be reviewed before merge
- Before enabling automated CHANGELOG generation

## When NOT to Use

- For solo throwaway prototypes where history does not matter (but document this exception)

---

## Step-by-Step Process

### 1. Conventional Commits Spec

Format: `type(scope): description`

```
feat(auth): add OAuth 2.0 login with Google
fix(cart): correct total when discount code applied
docs(api): document pagination parameters
style(button): align icon spacing with design token
refactor(users): extract email validation into shared util
perf(images): lazy-load below-fold product thumbnails
test(checkout): add E2E test for failed payment flow
chore(deps): update eslint to v9
ci(github): cache pnpm store in build workflow
revert: feat(auth): add OAuth 2.0 login with Google
```

**Rules:**
- `type` is lowercase, from the fixed list above
- `scope` is optional but highly recommended — use the module/feature name
- `description` is imperative mood, present tense: "add" not "added" or "adds"
- First letter lowercase, no period at end
- Maximum 72 characters on the subject line

### 2. Commit Message Body

The body explains **WHY**, not what (the diff shows what):

```
feat(billing): switch from Stripe v2 to v3 SDK

Stripe is deprecating v2 in January 2025. v3 improves webhook
signature verification and adds native idempotency key support,
which resolves intermittent duplicate charge errors (see #482).

Co-authored-by: Jane Smith <jane@example.com>
```

- Separate subject from body with a blank line
- Wrap body at 72 characters
- Reference issues: `Closes #123`, `Fixes #456`, `Relates to #789`

### 3. Breaking Changes

```
feat(api)!: require authentication on all endpoints

BREAKING CHANGE: Public endpoints /api/products and /api/search now
require a valid Bearer token. Update clients before deploying.
Clients that relied on unauthenticated access will receive 401.

Migration guide: docs/migration/v2-auth.md
```

The `!` after `type(scope)` and the `BREAKING CHANGE:` footer both trigger a major version bump in semantic-release.

### 4. Atomic Commits

One commit = one logical change. The test proving that change lives in the same commit as the code.

```bash
# BAD — mixed concerns in one commit
git add .
git commit -m "add user profile page and fix login bug and update deps"

# GOOD — staged selectively
git add src/features/profile/
git add src/features/profile/__tests__/
git commit -m "feat(profile): add user profile page with avatar upload"

git add src/features/auth/login.tsx
git commit -m "fix(auth): preserve redirect URL after successful login"

git add package.json pnpm-lock.yaml
git commit -m "chore(deps): update zod to v3.23"
```

Use `git add -p` (patch mode) to stage individual hunks when multiple changes share a file.

### 5. Branch Naming

```
feat/oauth-google-login
fix/issue-482-duplicate-charges
chore/update-eslint-v9
docs/api-pagination
release/v2.3.0
hotfix/critical-payment-failure
```

- Prefix matches the commit type
- Issue number in fix/hotfix branches for traceability
- Lowercase, hyphens only, no special characters

### 6. Husky + lint-staged + commitlint

```bash
npm install -D husky lint-staged @commitlint/cli @commitlint/config-conventional
npx husky init
```

**`.husky/pre-commit`:**
```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
npx lint-staged
```

**`.husky/commit-msg`:**
```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
npx --no -- commitlint --edit $1
```

**`package.json` — lint-staged config:**
```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix --max-warnings 0",
      "prettier --write"
    ],
    "*.{ts,tsx,js,jsx}": "vitest related --run"
  }
}
```

**`commitlint.config.ts`:**
```ts
import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-case": [2, "always", "lower-case"],
    "subject-max-length": [2, "always", 72],
    "body-max-line-length": [2, "always", 72],
  },
};
export default config;
```

### 7. Patterns to Avoid

| Bad commit message | Why it fails |
|--------------------|-------------|
| `WIP` | No information; squash before merging |
| `fix stuff` | No type, no scope, no description |
| `LGTM` | Not a commit message |
| `update` | No context; what was updated and why? |
| `feat: add login, fix cart, update docs, refactor utils` | Multiple concerns — split it |

**Never commit:**
- Generated files (`dist/`, `.next/`, `build/`) — add to `.gitignore`
- Lock files from a different package manager than the project uses
- `.env` or any file containing secrets
- Merge conflict markers left in source files

### 8. Amend and Rebase Rules

```bash
# Amend ONLY the most recent commit, ONLY if not yet pushed
git add forgotten-file.ts
git commit --amend --no-edit

# Interactive rebase to clean up before PR — ONLY on unshared branches
git rebase -i origin/main
# squash WIP commits, reword messages, reorder for clarity
```

Never rewrite history on `main`, `develop`, or any branch others have checked out.

---

## Verification Checklist

- [ ] Husky pre-commit hook runs lint-staged — confirmed by checking `.husky/pre-commit`
- [ ] Husky commit-msg hook runs commitlint — rejects invalid messages
- [ ] `commitlint.config.ts` extends `@commitlint/config-conventional`
- [ ] All commits in the PR follow `type(scope): description` format
- [ ] No commit mixes unrelated changes (audit with `git log --oneline`)
- [ ] Breaking changes have `!` suffix and `BREAKING CHANGE:` footer
- [ ] Issue references present in fix/feat commits (`Closes #N`)
- [ ] Branch name follows `type/description` convention
- [ ] No generated files, secrets, or lock file conflicts committed
- [ ] `git log --oneline main..HEAD` reads as a coherent change narrative
